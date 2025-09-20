require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

let usersCollection, tagsCollection;

async function startServer() {
    try {
        const client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        const db = client.db(process.env.DB_NAME);
        usersCollection = db.collection("users");
        tagsCollection = db.collection("tags");
        console.log("✅ MongoDB Connected");

        // 👉 Seed tags automatically
        const defaultTags = [
            "fix", "solve", "confusing", "bug", "stack", "efficient",
            "code", "refresh", "errors", "time", "loop", "beautiful",
            "quick", "slow", "crash", "render"
        ];

        const count = await tagsCollection.countDocuments();
        if (count === 0) {
            await tagsCollection.insertMany(defaultTags.map(name => ({ name })));
            console.log("✅ Default tags inserted");
        } else {
            console.log("ℹ️ Tags already exist in DB");
        }

        // 👉 Get all tags
        app.get("/tags", async (req, res) => {
            try {
                const tags = await tagsCollection.find().toArray();
                res.status(200).json(tags);
            } catch (err) {
                console.error("❌ Failed to fetch tags:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // 👉 Root
        app.get("/", (req, res) => {
            res.send("Server is running!");
        });

        // Start server only after DB is ready
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    } catch (err) {
        console.error("❌ MongoDB Error:", err);
    }
}

startServer();
