const express = require('express');
const app = express();
const cors = require('cors');
// const jwt = require('jsonwebtoken')
require('dotenv').config();
const port = process.env.PORT || 3000;

app.use(cors());
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

    app.get('/news', async (req, res) => {
      const result = await newsCollection.find().toArray();
      res.send(result)
    });

app.get('/news/:id',async(req,res)=>{
  const id = req.params.id;
 if (id.length !== 24) {
    return res.status(400).send({ message: 'Invalid ID format' });
  }

  try {
    const query = { _id: id }; 
    const result = await newsCollection.findOne(query);

    if (!result) {
      
      return res.status(404).send({ message: 'News not found' });
    }

    res.send(result);
  } catch (error) {
    
    res.status(500).send({ message: 'Internal server error' });
  }
  
})

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