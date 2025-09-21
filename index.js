require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


async function startServer() {
    try {
        const client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        const db = client.db(process.env.DB_NAME);

        const usersCollection = db.collection("users");
        const tagsCollection = db.collection("tags");
        const postsCollection = db.collection("posts");
        const announcementsCollection = db.collection("announcements");

        console.log("✅ MongoDB Connected");

        // Seed default tags
        const defaultTags = [
            "fix", "solve", "confusing", "bug", "stack", "efficient",
            "code", "refresh", "errors", "time", "loop", "beautiful",
            "quick", "slow", "crash", "render"
        ];
        const count = await tagsCollection.countDocuments();
        if (count === 0) {
            await tagsCollection.insertMany(defaultTags.map(name => ({ name })));
            console.log("✅ Default tags inserted");
        }

        // ------------------ ROUTES ------------------

        // Get all tags
        app.get("/tags", async (req, res) => {
            try {
                const tags = await tagsCollection.find().toArray();
                res.status(200).json(tags);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // Insert new user
        app.post("/users", async (req, res) => {
            const { name, email, avatar, role, membership = "no", userStatus = "bronze" } = req.body;
            if (!name || !email || !avatar) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            try {
                const existingUser = await usersCollection.findOne({ email });
                if (existingUser) return res.status(409).json({ message: "User already exists" });

                const newUser = { name, email, avatar, role, membership, userStatus, posts: 0 };
                const result = await usersCollection.insertOne(newUser);
                res.status(201).json({ message: "User created successfully", data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Internal server error" });
            }
        });


        // POST /posts - add a new post
        app.post("/posts", async (req, res) => {
            const post = req.body;

            if (!post.authorEmail || !post.authorName || !post.postTitle || !post.postDescription || !post.tag) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            const newPost = {
                authorName: post.authorName,
                authorEmail: post.authorEmail,
                authorImage: post.authorImage || "",
                postTitle: post.postTitle,
                postDescription: post.postDescription,
                tag: post.tag,
                upVote: post.upVote || 0,
                downVote: post.downVote || 0,
                creation_time: post.creation_time || new Date(),
            };

            try {
                // Insert the post
                const result = await postsCollection.insertOne(newPost);

                // Increment the user's posts count
                const userUpdate = await usersCollection.updateOne(
                    { email: post.authorEmail },
                    { $inc: { posts: 1 } }
                );

                res.status(201).json({
                    message: "Post added successfully",
                    post: result,
                    userUpdated: userUpdate.modifiedCount
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add post" });
            }
        });

        app.get("/users/email/:email", async (req, res) => {
            const { email } = req.params;
            const user = await usersCollection.findOne({ email });
            if (!user) return res.status(404).json({ message: "User not found" });
            res.json(user);
        });

        // POST /announcements - add a new announcement
        app.post("/announcements", async (req, res) => {
            try {
                const announcement = req.body;

                // Validate required fields
                if (!announcement.authorName || !announcement.authorEmail || !announcement.title || !announcement.description) {
                    return res.status(400).json({ message: "Missing required fields" });
                }

                const newAnnouncement = {
                    authorName: announcement.authorName,
                    authorEmail: announcement.authorEmail,
                    authorImage: announcement.authorImage || "", // default empty string if not uploaded
                    title: announcement.title,
                    description: announcement.description,
                    creation_time: announcement.creation_time || new Date(),
                };

                const result = await announcementsCollection.insertOne(newAnnouncement);

                res.status(201).json({
                    message: "Announcement added successfully",
                    data: result,
                });
            } catch (err) {
                console.error("Error adding announcement:", err);
                res.status(500).json({ message: "Failed to add announcement" });
            }
        });





        // Root
        app.get("/", (req, res) => res.send("Server is running!"));

        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    } catch (err) {
        console.error("MongoDB error:", err);
    }
}

startServer();
