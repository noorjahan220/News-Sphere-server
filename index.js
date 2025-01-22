const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
// const jwt = require('jsonwebtoken')
require('dotenv').config();
const port = process.env.PORT || 3000;

app.use(cors(
  {
    origin: [
      "http://localhost:5173",
      "https://news-paper-91c56.web.app",

    ],
    // credentials: true
  }
));
app.use(express.json());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rq93w.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();


    const newsCollection = client.db("newsDb").collection("allNews");
    const userCollection = client.db("newsDb").collection("users");
    const publisherCollection = client.db("newsDb").collection("publishers");

    // jwt related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      res.send({ token });
    })

    // middleware
    const verifyToken = (req, res, next) => {
      console.log('inside verify token', req.headers.authorization);

      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Authorization header missing, forbidden access' });
      }

      const token = req.headers.authorization.split(' ')[1]; // Fix: Split by space to get the token

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'Invalid token, forbidden access' });
        }
        req.decoded = decoded; // Attach decoded token payload to the request object
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query)
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }

    // user related api
    app.get('/users', verifyToken, async (req, res) => {
      console.log(req.headers)
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'unauthorized access' })
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;

      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin })
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      // insert Email if user doesn't exists
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null })
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query);
      res.send(result);
    })

    // make admin
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }

      }
      const result = await userCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })


    app.get('/newsId/:id', async (req, res) => {
      const id = req.params.id
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ObjectId format" });
      }
      const query = { _id: new ObjectId(id) }
      const result = await newsCollection.findOne(query);
      res.send(result);

    })


    // get all news and filter and implement the search option
    app.get('/news', async (req, res) => {
      const { publisher, tags, title } = req.query;

      // Build a query object based on provided filters
      const query = {};


      if (publisher) {
        query.publisher = publisher;
      }

      if (tags) {
        const tagsArray = tags.split(',');
        query.tags = { $in: tagsArray }; tags
      }


      if (title) {
        query.title = { $regex: new RegExp(title, 'i') };
      }

      try {

        const result = await newsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Error fetching articles' });
      }
    });


    // update view count
    app.post('/update-view/:id', async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ObjectId format" });
      }

      const query = { _id: new ObjectId(id) };
      const update = { $inc: { viewCount: 1 } };

      try {
        const result = await newsCollection.updateOne(query, update);
        if (result.modifiedCount > 0) {
          res.send({ message: 'View count updated successfully' });
        } else {
          res.status(404).send({ message: 'Article not found' });
        }
      } catch (error) {
        res.status(500).send({ error: 'Error updating view count' });
      }
    });
    // trending card
    app.get('/trending', async (req, res) => {
      try {
        const trendingArticles = await newsCollection
          .find()
          .sort({ viewCount: -1 })
          .limit(6)
          .toArray();

        res.send(trendingArticles);
      } catch (error) {
        res.status(500).send({ error: 'Error fetching trending articles' });
      }
    });

    // adding article 
    // app.post('/articles', async (req, res) => {
    //   const article = req.body;
    //   try {
    //     const result = await newsCollection.insertOne(article);
    //     res.send(result);
    //   } catch (error) {
    //     res.status(500).send({ error: 'Failed to add article' });
    //   }
    // });




    // Add Publisher API
    app.post('/publishers', async (req, res) => {
      const publisher = req.body;
      try {
        const result = await publisherCollection.insertOne(publisher);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to add publisher" });
      }
    });


    // Get Publishers API (for dropdowns)
    app.get('/publishers', async (req, res) => {
      try {
        const result = await
          publisherCollection.find()
            .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch publishers" });
      }
    });





    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('news and news')
})
app.listen(port, () => {
  console.log(`news is showing on port: ${port}`);
})