const express = require('express');
const app = express();
const cors = require('cors');
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


    const newsCollection = client.db("newsDb").collection("allNews")

   
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