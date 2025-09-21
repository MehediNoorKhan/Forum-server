require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 5000;

// ----------------- Firebase Admin -----------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Middleware to verify Firebase token
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // attach user info
        next();
    } catch (err) {
        console.error("Firebase token error:", err);
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }
};

const verifyAdmin = async (req, res, next) => {
    if (!req.user?.email) {
        return res.status(401).json({ message: "Unauthorized: No user email" });
    }

    try {
        const user = await usersCollection.findOne({ email: req.user.email });
        if (!user || user.role !== "admin") {
            // Forbidden, frontend can redirect to /forbidden
            return res.status(403).json({ message: "Forbidden: Admins only" });
        }
        next();
    } catch (err) {
        console.error("Admin verification failed:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

const verifyUser = async (req, res, next) => {
    if (!req.user?.email) {
        return res.status(401).json({ message: "Unauthorized: No user email" });
    }

    try {
        const user = await usersCollection.findOne({ email: req.user.email });

        if (!user || user.role !== "user") {
            // Forbidden: only users with role 'user' allowed
            return res.status(403).json({ message: "Forbidden: Users only" });
        }

        next(); // user verified
    } catch (err) {
        console.error("User verification failed:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};


// ----------------- Express Middlewares -----------------
app.use(cors());
app.use(express.json());

// ----------------- MongoDB Setup -----------------
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

        // ----------------- Routes -----------------

        // Root
        app.get("/", (req, res) => res.send("Server is running!"));

        // Get all tags (public)
        app.get("/tags", async (req, res) => {
            try {
                const tags = await tagsCollection.find().toArray();
                res.status(200).json(tags);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // Create user (public)
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

        // Get user by email (protected)
        app.get("/users/email/:email", verifyToken, async (req, res) => {
            const { email } = req.params;

            // Only allow access if token email matches
            if (req.user.email !== email) {
                return res.status(403).json({ message: "Forbidden" });
            }

            const user = await usersCollection.findOne({ email });
            if (!user) return res.status(404).json({ message: "User not found" });

            res.json(user);
        });

        // Add post (protected)
        app.post("/posts", verifyToken, async (req, res) => {
            const post = req.body;

            if (!post.authorEmail || !post.authorName || !post.postTitle || !post.postDescription || !post.tag) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            // Ensure user cannot post as another user
            if (req.user.email !== post.authorEmail) {
                return res.status(403).json({ message: "Forbidden: Cannot post as another user" });
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
                const result = await postsCollection.insertOne(newPost);
                await usersCollection.updateOne({ email: post.authorEmail }, { $inc: { posts: 1 } });

                res.status(201).json({
                    message: "Post added successfully",
                    post: result,
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add post" });
            }
        });

        // Add announcement (protected)
        app.post("/announcements", verifyToken, async (req, res) => {
            const announcement = req.body;

            if (!announcement.authorName || !announcement.authorEmail || !announcement.title || !announcement.description) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            // Only allow user to post as themselves
            if (req.user.email !== announcement.authorEmail) {
                return res.status(403).json({ message: "Forbidden: Cannot announce as another user" });
            }

            const newAnnouncement = {
                authorName: announcement.authorName,
                authorEmail: announcement.authorEmail,
                authorImage: announcement.authorImage || "",
                title: announcement.title,
                description: announcement.description,
                creation_time: announcement.creation_time || new Date(),
            };

            try {
                const result = await announcementsCollection.insertOne(newAnnouncement);
                res.status(201).json({ message: "Announcement added successfully", data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add announcement" });
            }
        });

        // ----------------- Start Server -----------------
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

    } catch (err) {
        console.error("MongoDB error:", err);
    }
}

startServer();
