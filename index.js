const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const multer = require('multer');
const upload = multer();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://news-paper-91c56.web.app",
  ],
}));

app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rq93w.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const newsCollection = client.db("newsDb").collection("allNews");
    const userCollection = client.db("newsDb").collection("users");
    const publisherCollection = client.db("newsDb").collection("publishers");
    const pendingArticles = client.db("newsDb").collection("pendingArticles");

    // JWT related API
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    // Middleware to verify token
    const verifyToken = (req, res, next) => {
      const authorization = req.headers.authorization;
      if (!authorization) {
        return res.status(401).send({ message: 'Authorization header missing, forbidden access' });
      }

      // console.log("Authorization header:", authorization);
      // console.log("Headers:", req.headers);

      const token = authorization.split(' ')[1];

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'Invalid token, forbidden access' });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Middleware to verify if the user is an admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });
      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      next();
    };

    // User related API


    app.get('/users', async (req, res) => {
      try {
        const { page = 1, limit = 10 } = req.query;

        // Convert page and limit to numbers
        const pageNumber = parseInt(page, 10);
        const limitNumber = parseInt(limit, 10);

        if (isNaN(pageNumber) || isNaN(limitNumber)) {
          return res.status(400).json({ message: 'Invalid pagination parameters' });
        }

        // Calculate the number of users to skip
        const skip = (pageNumber - 1) * limitNumber;



        // Fetch the users with pagination
        const users = await userCollection
          .find()
          .skip(skip)
          .limit(limitNumber)
          .toArray();

        // Get the total number of users
        const totalUsers = await userCollection.countDocuments();

        // Send response with paginated users and total users count
        res.json({
          users,
          totalUsers,
        });
      } catch (err) {
        console.error('Error in fetching users:', err);
        res.status(500).json({ message: 'Server Error' });
      }
    });




    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'Unauthorized access' });
      }
      const user = await userCollection.findOne({ email });
      res.send({ admin: user?.role === 'admin' });
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: 'User already exists' });
      }

      const userInfo = {
        ...user,
        premiumTaken: null,
      };

      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });



    // Endpoint to update subscription
    app.post('/subscribe', verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const { subscriptionPeriod } = req.body; // 1 minute, 5 days, or 10 days

      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      let expiryTime;
      const currentTime = new Date();


      if (subscriptionPeriod === '1 minute') {
        expiryTime = new Date(currentTime.getTime() + 1 * 60000); // Add 1 minute
      } else if (subscriptionPeriod === '5 days') {
        expiryTime = new Date(currentTime.getTime() + 5 * 24 * 60 * 60000); // Add 5 days
      } else if (subscriptionPeriod === '10 days') {
        expiryTime = new Date(currentTime.getTime() + 10 * 24 * 60 * 60000); // Add 10 days
      }


      const expiryTimeGMT = expiryTime.toGMTString(); // Convert to GMT string

      // Update the premiumTaken field
      await userCollection.updateOne(
        { email },
        { $set: { premiumTaken: expiryTimeGMT } }
      );

      res.send({ message: 'Subscription successful', premiumTaken: expiryTimeGMT });
    });


    // Endpoint to check user's subscription status
    app.get('/user-status', verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      const currentTime = new Date();
      if (user.premiumTaken) {
        const expiryDate = new Date(user.premiumTaken);

        if (currentTime > expiryDate) {
          // Subscription expired
          await userCollection.updateOne(
            { email },
            { $set: { premiumTaken: null } } // Reset premiumTaken if expired
          );
          return res.send({ message: 'Your subscription has expired' });
        } else {
          // Calculate remaining time correctly
          const remainingTime = expiryDate - currentTime;
          const remainingMilliseconds = remainingTime % (1000 * 3600 * 24);
          const remainingDays = Math.floor(remainingTime / (1000 * 3600 * 24));
          const remainingHours = Math.floor(remainingMilliseconds / (1000 * 3600)); // Convert to hours
          return res.send({
            message: 'User has an active subscription',
            remainingDays,
            remainingHours
          });
        }
      }

      return res.send({ message: 'User has no active subscription' });
    });


// Route to handle decline
app.post('/articles/:id/decline', async (req, res) => {
  const { reason } = req.body;
  await newsCollection.updateOne(
    { _id: req.params.id },
    { status: 'declined', declineReason: reason }
  );
  res.sendStatus(200);
});
app.get('/articles/:id', async (req, res) => {
  const article = await newsCollection.findById(req.params.id);
  res.json(article);
});
    // Endpoint to update subscription
    app.patch('/update-subscription', verifyToken, async (req, res) => {
      const { subscriptionPeriod } = req.body;
      const email = req.decoded.email;

      let expirationTime;
      const currentTime = new Date();  // Default current time is in UTC

      if (subscriptionPeriod === '1') {
        expirationTime = new Date(currentTime.getTime() + 1 * 60000); // 1 minute in ms
      } else if (subscriptionPeriod === '5') {
        expirationTime = new Date(currentTime.getTime() + 5 * 24 * 60 * 60000); // 5 days in ms
      } else if (subscriptionPeriod === '10') {
        expirationTime = new Date(currentTime.getTime() + 10 * 24 * 60 * 60000); // 10 days in ms
      }

      try {
        // Update the user's premiumTaken field
        const result = await userCollection.updateOne(
          { email },
          { $set: { premiumTaken: expirationTime.toGMTString() } }
        );

        if (result.modifiedCount > 0) {
          res.status(200).json({ message: 'Subscription updated successfully' });
        } else {
          res.status(400).json({ message: 'Failed to update subscription' });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Something went wrong' });
      }
    });

    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Make user admin
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: 'admin' } }
      );
      res.send(result);
    });

    // Fetch news by ID
    app.get('/newsId/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ObjectId format" });
      }
      const result = await newsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Get all news with filters (publisher, tags, title)
    app.get('/news', async (req, res) => {
      const { publisher, tags, title } = req.query;

      try {
        const query = { isApproved: true }; // Only fetch approved articles

        // Add additional filters for publisher, tags, and title (search)
        if (publisher) query.publisher = publisher;
        if (tags) query.tags = { $in: tags.split(',') }; // Assuming tags are comma-separated
        if (title) query.title = { $regex: title, $options: 'i' }; // Case-insensitive title search

        const articles = await newsCollection.find(query).toArray();
        res.status(200).send(articles);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching articles', error: error.message });
      }
    });


    // Update view count
    app.post('/update-view/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ObjectId format" });
      }
      const result = await newsCollection.updateOne({ _id: new ObjectId(id) }, { $inc: { viewCount: 1 } });
      result.modifiedCount > 0
        ? res.send({ message: 'View count updated successfully' })
        : res.status(404).send({ message: 'Article not found' });
    });

    // Fetch trending articles (top 6 by view count)
    app.get('/trending', async (req, res) => {
      const trendingArticles = await newsCollection
        .find()
        .sort({ viewCount: -1 })
        .limit(6)
        .toArray();
      res.send(trendingArticles);
    });


   

    // Get all news with filters (publisher, tags, title)
    app.get('/news', async (req, res) => {
      const { publisher, tags, title } = req.query;

      try {
        const query = { isApproved: true }; // Only fetch approved articles

        // Add additional filters for publisher, tags, and title (search)
        if (publisher) query.publisher = publisher;
        if (tags) query.tags = { $in: tags.split(',') }; // Assuming tags are comma-separated
        if (title) query.title = { $regex: title, $options: 'i' }; // Case-insensitive title search

        const articles = await newsCollection.find(query).toArray();
        res.status(200).send(articles);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching articles', error: error.message });
      }
    });

 // Add article to the news collection with isApproved set to false
 app.post('/articles', async (req, res) => {
  const { title, description, publisher, tags, image, createdAt, email, name, userImg } = req.body;

  if (!title || !description || !publisher) {
    return res.status(400).send({ message: 'Missing required fields' });
  }

  const newArticle = {
    title,
    description,
    publisher,
    tags,
    image,
    name,
    email,
    userImg,
    isApproved: false,  // Not approved yet
    status: 'pending',  // Optional status
    createdAt: createdAt || new Date(),
  };

  try {
    const result = await newsCollection.insertOne(newArticle);
    res.status(201).send({ insertedId: result.insertedId });
  } catch (err) {
    res.status(500).send({ message: 'Error while adding article', error: err.message });
  }
});
    // Admin approves an article by updating isApproved to true
    app.put('/approve-article/:id', verifyToken, verifyAdmin, async (req, res) => {
      const articleId = req.params.id;

      try {
        const result = await newsCollection.updateOne(
          { _id: new ObjectId(articleId) },
          { $set: { isApproved: true, status: 'approved' } }  // Update approval status
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Article not found' });
        }

        res.status(200).send({ message: 'Article approved' });
      } catch (err) {
        res.status(500).send({ message: 'Error while approving article', error: err.message });
      }
    });

   

    // Get Publishers API
    app.get('/publishers', async (req, res) => {
      const result = await publisherCollection.find().toArray();
      res.send(result);
    });
     // Add Publisher API
     app.post('/publishers', async (req, res) => {
      const publisher = req.body;
      try {
        const result = await publisherCollection.insertOne(publisher);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to add publisher" });
      }
    });


   

    // Mark article as premium
    app.patch('/articles/premium/:id', async (req, res) => {
      const { id } = req.params;
      const result = await newsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isPremium: true } }
      );
      result.modifiedCount > 0
        ? res.send({ message: 'Article marked as premium' })
        : res.status(404).send({ error: 'Article not found' });
    });
     // Fetch premium articles
     app.get('/premium-articles', async (req, res) => {
      try {
        const premiumArticles = await newsCollection
          .find({ isPremium: true }) // Filter only premium articles
          .sort({ viewCount: -1 }) // Optional: Sort by view count or other criteria
          .limit(5) // Optional: Limit to top 5
          .toArray();
        res.send(premiumArticles);
      } catch (err) {
        res.status(500).send({ message: 'Error fetching premium articles', error: err.message });
      }
    });

    // Decline an article with a reason
    app.patch('/articles/decline/:id', verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { reason } = req.body; // Reason for decline

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ObjectId format" });
      }

      const article = await newsCollection.findOne({ _id: new ObjectId(id) });
      if (!article) return res.status(404).send({ error: 'Article not found' });

      await newsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { declinedReason: reason, isApproved: false } });
      res.send({ message: 'Article declined successfully' });
    });

    // Get all pending (unapproved) articles for the admin dashboard
    app.get('/pending-articles', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const pendingArticlesList = await newsCollection.find({ isApproved: false }).toArray();
        res.status(200).send(pendingArticlesList);
      } catch (err) {
        res.status(500).send({ message: 'Error while fetching pending articles', error: err.message });
      }
    });
    // Fetch user's articles
    app.get('/my-articles', verifyToken, async (req, res) => {
      const email = req.decoded.email;
      try {
        const userArticles = await newsCollection.find({ email }).toArray();
        res.send(userArticles);
      } catch (err) {
        res.status(500).send({ message: 'Error fetching articles', error: err.message });
      }
    });

    app.patch('/articles/:id', upload.single('image'), async (req, res) => {
      const { id } = req.params;
      const updatedFields = req.body;
      // Image processing should be done here if needed
    
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid article ID' });
      }
    
      try {
        const result = await newsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFields }
        );
    
        if (result.matchedCount > 0) {
          res.status(200).send({ message: 'Article updated successfully' });
        } else {
          res.status(400).send({ message: 'No changes were made or article not found' });
        }
      } catch (err) {
        res.status(500).send({ message: 'Error while updating article', error: err.message });
      }
    });
    
// Delete article
app.delete('/articles/:id', verifyToken,async (req, res) => {
  const { id } = req.params;

  try {
    const result = await newsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount > 0) {
      res.status(200).send({ message: 'Article deleted successfully' });
    } else {
      res.status(404).send({ message: 'Article not found' });
    }
  } catch (err) {
    res.status(500).send({ message: 'Error while deleting article', error: err.message });
  }
});

// Get article by ID
app.get('/articles/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const article = await newsCollection.findOne({ _id: new ObjectId(id) });

    if (article) {
      res.status(200).json(article);
    } else {
      res.status(404).send({ message: 'Article not found' });
    }
  } catch (err) {
    res.status(500).send({ message: 'Error while fetching article', error: err.message });
  }
});

app.put('/reject-article/:id', verifyToken, verifyAdmin, async (req, res) => {
  const articleId = req.params.id;
  const { reason } = req.body; // Expecting a reason in the request body

  if (!reason) {
    return res.status(400).send({ message: 'Rejection reason is required' });
  }

  try {
    await newsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { declinedReason: reason, isApproved: false } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'Article not found' });
    }

    res.status(200).send({ message: 'Article rejected', reason: reason });
  } catch (err) {
    res.status(500).send({ message: 'Error rejecting article', error: err.message });
  }
});
app.get('/pending-article/:id', async (req, res) => {
  const articleId = req.params.id;

  try {
    const article = await newsCollection.findOne({ _id: new ObjectId(articleId) });

    if (!article) {
      return res.status(404).send({ message: 'Article not found' });
    }

    // Check if the article was rejected and include the rejection reason
    if (article.status === 'rejected') {
      return res.status(200).send({ reason: article.reason });
    }

    res.status(200).send({ message: 'Article not rejected yet' });
  } catch (err) {
    res.status(500).send({ message: 'Error fetching article', error: err.message });
  }
});

    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { amount } = req.body; // The amount will come from the frontend (in cents)

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount, // Amount in cents
          currency: 'usd', // Change this as per your currency
          payment_method_types: ['card'],
        });

        // Send the client secret to the frontend
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({ message: 'Error creating payment intent' });
      }
    });
    app.get('/get-premium-status', verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      const currentTime = new Date();
      const premiumTakenDate = user.premiumTaken ? new Date(user.premiumTaken) : null;

      let isPremium = false;
      let expiryDate = null;

      if (premiumTakenDate && premiumTakenDate > currentTime) {
        isPremium = true;
        expiryDate = premiumTakenDate;
      }

      res.send({
        isPremium,
        expiryDate,
      });
    });




    // Start the server
    app.get('/', (req, res) => {
      res.send('Server is running');
    });
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error(err);
  }
}

run();
