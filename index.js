const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@binarybard.9ppt338.mongodb.net/?retryWrites=true&w=majority&appName=BinaryBard`;

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
    console.log("✅ Connected to MongoDB");

    const database = client.db("petAdoptionDB");
    const petsCollection = database.collection("pets");
    const donationCampaigns = database.collection("donation");
    const adoptionCollection = database.collection("adoptions");

    // 🧾 Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create payment intent" });
      }
    });

    // 📌 Create Donation Campaign (with creatorEmail required)
    app.post("/donation-campaigns", async (req, res) => {
      try {
        const campaign = req.body;

        if (!campaign.creatorEmail) {
          return res.status(400).send({ error: "creatorEmail is required" });
        }

        campaign.date = new Date();
        const result = await donationCampaigns.insertOne(campaign);
        res.status(201).send(result);
      } catch (err) {
        console.error("❌ Error creating campaign:", err);
        res.status(500).send({ error: "Failed to create campaign" });
      }
    });

    // 📌 Get All Campaigns (with pagination & infinite scroll)
    app.get("/donation-campaigns", async (req, res) => {
      try {
        const { email, page = 0, limit = 6 } = req.query;
        const query = email ? { creatorEmail: email } : {};

        const total = await donationCampaigns.countDocuments(query);

        const campaigns = await donationCampaigns
          .find(query)
          .sort({ date: -1 })
          .skip(page * limit)
          .limit(parseInt(limit))
          .toArray();

        res.send({
          campaigns,
          hasMore: (parseInt(page) + 1) * parseInt(limit) < total,
        });
      } catch (err) {
        console.error("❌ Error fetching donation campaigns:", err);
        res.status(500).send({ error: "Failed to fetch campaigns" });
      }
    });

    // 📌 Get Campaign by ID
    app.get("/donation-campaigns/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const campaign = await donationCampaigns.findOne({ _id: new ObjectId(id) });
        if (!campaign) {
          return res.status(404).send({ error: "Donation campaign not found" });
        }
        res.send(campaign);
      } catch (err) {
        console.error("Error fetching donation details:", err);
        res.status(500).send({ error: "Failed to fetch donation details" });
      }
    });

    // 📌 Get My Campaigns (by email)
    app.get("/my-campaigns", async (req, res) => {
      try {
        const email = req.query.email;
        console.log("Received email query:", email);
        if (!email) return res.status(400).send({ error: "Email is required" });

        const myCampaigns = await donationCampaigns
          .find({ creatorEmail: email })
          .sort({ date: -1 })
          .toArray();

        console.log(`Found ${myCampaigns.length} campaigns for ${email}`);
        res.send(myCampaigns);
      } catch (err) {
        console.error("❌ Error fetching my campaigns:", err);
        res.status(500).send({ error: "Failed to fetch campaigns" });
      }
    });

    // 🐾 Add a Pet
    app.post('/pets', async (req, res) => {
      try {
        const pet = req.body;

        if (!pet.creatorEmail) {
          return res.status(400).send({ error: 'creatorEmail is required' });
        }

        // Add timestamp and default values
        pet.createdAt = new Date();
        pet.adopted = false;

        const result = await petsCollection.insertOne(pet);
        res.status(201).send({
          message: 'Pet added successfully',
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("❌ Failed to add pet:", err);
        res.status(500).send({ error: "Failed to add pet" });
      }
    });

    // 🐾 Get My Pets (by creatorEmail)
    app.get('/my-pets', async (req, res) => {
      try {
        const email = req.query.email;
        console.log('GET /my-pets called with email:', email);

        if (!email) return res.status(400).send({ error: 'Email is required' });

        const pets = await petsCollection.find({ creatorEmail: email }).sort({ createdAt: -1 }).toArray();

        console.log(`Found ${pets.length} pets for email: ${email}`);
        res.send(pets);
      } catch (err) {
        console.error("❌ Failed to fetch my pets:", err);
        res.status(500).send({ error: 'Failed to fetch pets' });
      }
    });

    // 💰 Save Donation Record (after payment)
    app.post("/donations", async (req, res) => {
      try {
        const donation = req.body;
        donation.date = new Date();
        const result = await database.collection("donations").insertOne(donation);
        res.send(result);
      } catch (err) {
        console.error("❌ Error saving donation:", err);
        res.status(500).send({ error: "Failed to save donation" });
      }
    });

    // 🐾 Submit Adoption Request
    app.post('/adoptions', async (req, res) => {
      try {
        const adoptionData = req.body;
        const result = await adoptionCollection.insertOne(adoptionData);
        res.send(result);
      } catch (err) {
        console.error("❌ Adoption insert error:", err);
        res.status(500).send({ error: "Failed to submit adoption request" });
      }
    });

    // 🐶 Get Single Pet by ID
    app.get('/pets/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
        if (!pet) return res.status(404).send({ error: "Pet not found" });
        res.send(pet);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch pet" });
      }
    });

    // 🐕 Get All Pets (with filters + pagination + infinite scroll)
    app.get('/pets', async (req, res) => {
      try {
        const {
          search = '',
          category,
          page = 1,
          limit = 6
        } = req.query;

        const query = { adopted: false };

        if (search) {
          query.name = { $regex: search, $options: 'i' };
        }

        if (category) {
          query.category = category;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const pets = await petsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const total = await petsCollection.countDocuments(query);

        res.send({
          pets,
          hasMore: skip + pets.length < total,
        });
      } catch (err) {
        console.error("❌ Error fetching pets:", err);
        res.status(500).send({ error: "Failed to fetch pets" });
      }
    });

  } catch (err) {
    console.error("❌ Connection error:", err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('🐶 Pet Adoption Server is running');
});

app.listen(port, () => {
  console.log(`🚀 Server listening at http://localhost:${port}`);
});
