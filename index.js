// ----------------- Dependencies -----------------
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// ----------------- App Setup -----------------
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ----------------- Firebase Admin -----------------
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccount = JSON.parse(
    fs.readFileSync(path.resolve(serviceAccountPath), "utf8")
);

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
        req.user = decodedToken;
        next();
    } catch (err) {
        console.error("Firebase token error:", err);
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }
};

// Verify normal user
const verifyUser = async (req, res, next) => {
    try {
        const email = req.user.email;
        if (!email) {
            return res.status(403).json({ message: "Forbidden: No email found in token" });
        }

        const user = await usersCollection.findOne({ email: email });
        if (!user) {
            return res.status(403).json({ message: "Forbidden: User not found" });
        }

        if (user.role !== "user") {
            return res.status(403).json({ message: "Forbidden: Not a user" });
        }

        next();
    } catch (err) {
        console.error("verifyUser error:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
};

// Verify admin
const verifyAdmin = async (req, res, next) => {
    try {
        const email = req.user.email;
        if (!email) {
            return res.status(403).json({ message: "Forbidden: No email found in token" });
        }

        const user = await usersCollection.findOne({ email: email });
        if (!user) {
            return res.status(403).json({ message: "Forbidden: User not found" });
        }

        if (user.role !== "admin") {
            return res.status(403).json({ message: "Forbidden: Admins only" });
        }

        next();
    } catch (err) {
        console.error("verifyAdmin error:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
};


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
        const commentsCollection = db.collection("comments");

        console.log("✅ MongoDB Connected");

        // ----------------- Seed Default Tags -----------------
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

        // Health check
        app.get("/", (req, res) => res.send("Server is running!"));

        // Tags
        app.get("/tags", async (req, res) => {
            try {
                const tags = await tagsCollection.find().toArray();
                res.status(200).json(tags);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // Create user
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
            if (req.user.email !== email) return res.status(403).json({ message: "Forbidden" });
            const user = await usersCollection.findOne({ email });
            if (!user) return res.status(404).json({ message: "User not found" });
            res.json(user);
        });

        // ----------------- Posts -----------------

        // ----------------- Posts -----------------

        // Create post
        app.post("/posts", verifyToken, async (req, res) => {
            const post = req.body;
            if (!post.authorName || !post.authorEmail || !post.postTitle || !post.postDescription || !post.tag) {
                return res.status(400).json({ message: "Missing required fields" });
            }

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
                upvoteBy: [],
                downvoteBy: [],
                creation_time: new Date(),
            };

            try {
                const result = await postsCollection.insertOne(newPost);

                // Increment user's post count
                await usersCollection.updateOne(
                    { email: post.authorEmail },
                    { $inc: { posts: 1 } }
                );

                res.status(201).json({ message: "Post added successfully", data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add post" });
            }
        });

        // Fetch all posts (with pagination & sorting)
        app.get("/posts", async (req, res) => {
            try {
                const { page = 1, limit = 5, sortBy = "newest" } = req.query;

                const pageNumber = parseInt(page);
                const limitNumber = parseInt(limit);

                let sortQuery = {};
                if (sortBy === "newest") sortQuery = { creation_time: -1 };
                else if (sortBy === "popularity") sortQuery = { popularityScore: -1 };

                const pipeline = [
                    {
                        $lookup: {
                            from: "comments",
                            localField: "_id",
                            foreignField: "postId",
                            as: "comments"
                        }
                    },
                    {
                        $addFields: {
                            upvoteBy: { $ifNull: ["$upvoteBy", []] },
                            downvoteBy: { $ifNull: ["$downvoteBy", []] },
                            commentsCount: { $size: "$comments" },
                            popularityScore: { $subtract: [{ $size: { $ifNull: ["$upvoteBy", []] } }, { $size: { $ifNull: ["$downvoteBy", []] } }] },
                        }
                    },
                    { $sort: sortQuery },
                    { $skip: (pageNumber - 1) * limitNumber },
                    { $limit: limitNumber }
                ];

                const posts = await postsCollection.aggregate(pipeline).toArray();
                const totalPosts = await postsCollection.countDocuments();

                res.json({
                    posts,
                    currentPage: pageNumber,
                    totalPages: Math.ceil(totalPosts / limitNumber),
                    totalPosts
                });
            } catch (err) {
                console.error("Error fetching posts:", err);
                res.status(500).json({ message: "Failed to fetch posts" });
            }
        });


        // Get single post with comments
        app.get("/posts/:id", async (req, res) => {
            try {
                const post = await postsCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!post) return res.status(404).json({ message: "Post not found" });

                const comments = await commentsCollection
                    .find({ postId: req.params.id })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.json({ post, comments });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        app.post("/posts/:id/comment", verifyToken, async (req, res) => {
            const { comment } = req.body;
            const postId = req.params.id;

            const post = await postsCollection.findOne({ _id: new ObjectId(postId) });
            if (!post) return res.status(404).json({ message: "Post not found" });

            const newComment = {
                postId,
                postTitle: post.postTitle,
                comment,
                commenterName: req.user.name || "Unknown",
                commenterEmail: req.user.email,
                commenterImage: req.user.picture || "",
                createdAt: new Date(),
            };

            await commentsCollection.insertOne(newComment);

            // Count updated comments
            const commentsCount = await commentsCollection.countDocuments({ postId });

            res.status(201).json({ ...newComment, commentsCount });
        });


        app.patch("/posts/:id/vote", verifyToken, async (req, res) => {
            const { type } = req.body;
            const userEmail = req.user.email;

            if (!["upvote", "downvote"].includes(type)) {
                return res.status(400).json({ message: "Invalid vote type" });
            }

            try {
                const postId = new ObjectId(req.params.id);
                const post = await postsCollection.findOne({ _id: postId });
                if (!post) return res.status(404).json({ message: "Post not found" });

                let upvoteBy = post.upvoteBy || [];
                let downvoteBy = post.downvoteBy || [];

                if (type === "upvote") {
                    if (upvoteBy.includes(userEmail)) upvoteBy = upvoteBy.filter(e => e !== userEmail); // toggle off
                    else {
                        upvoteBy.push(userEmail);
                        downvoteBy = downvoteBy.filter(e => e !== userEmail);
                    }
                } else {
                    if (downvoteBy.includes(userEmail)) downvoteBy = downvoteBy.filter(e => e !== userEmail); // toggle off
                    else {
                        downvoteBy.push(userEmail);
                        upvoteBy = upvoteBy.filter(e => e !== userEmail);
                    }
                }

                const updatedPost = await postsCollection.findOneAndUpdate(
                    { _id: postId },
                    { $set: { upvoteBy, downvoteBy } },
                    { returnDocument: "after" }
                );

                res.json(updatedPost.value); // return full post with actual arrays
            } catch (err) {
                console.error("Vote error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // Get user role by email
        app.get("/users/role", verifyToken, async (req, res) => {
            const email = req.query.email;
            if (!email) return res.status(400).json({ message: "Email is required" });

            try {
                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).json({ message: "User not found" });

                res.json({ role: user.role || "user" });
            } catch (err) {
                console.error("Error fetching user role:", err);
                res.status(500).json({ message: "Failed to fetch user role" });
            }
        });




        // ----------------- Announcements -----------------
        app.post("/announcements", verifyToken, async (req, res) => {
            const announcement = req.body;
            if (!announcement.authorName || !announcement.authorEmail || !announcement.title || !announcement.description) {
                return res.status(400).json({ message: "Missing required fields" });
            }
            if (req.user.email !== announcement.authorEmail) {
                console.log(req.user.email);
                console.log(announcement.authorEmail);
                return res.status(403).json({ message: "Forbidden: Cannot announce as another user" });
            }
            const newAnnouncement = {
                authorName: announcement.authorName,
                authorEmail: announcement.authorEmail,
                authorImage: announcement.authorImage || "",
                title: announcement.title,
                description: announcement.description,
                creation_time: new Date(),
            };
            try {
                const result = await announcementsCollection.insertOne(newAnnouncement);
                res.status(201).json({ message: "Announcement added successfully", data: result });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add announcement" });
            }
        });

        // GET all announcements
        app.get("/announcements", verifyToken, verifyAdmin, async (req, res) => {
            try {
                const announcements = await announcementsCollection
                    .find({})
                    .sort({ creation_time: -1 }) // newest first
                    .toArray();

                res.status(200).json({
                    announcements: announcements,
                    count: announcements.length,
                });
            } catch (err) {
                console.error("Failed to fetch announcements:", err);
                res.status(500).json({ message: "Failed to fetch announcements" });
            }
        });

        // ✅ Get unseen announcements count
        app.get("/announcements/unseen/count", verifyToken, async (req, res) => {
            try {
                const email = req.user.email;

                // Find announcements the user hasn't seen yet
                const unseenCount = await announcementsCollection.countDocuments({
                    seenBy: { $ne: email }
                });

                res.json({ count: unseenCount });
            } catch (err) {
                console.error("Error fetching unseen announcements:", err);
                res.status(500).json({ message: "Failed to fetch unseen count" });
            }
        });

        // ✅ Mark all announcements as seen (optional, call this when user opens announcements page)
        app.patch("/announcements/mark-seen", verifyToken, async (req, res) => {
            try {
                const email = req.user.email;
                await announcementsCollection.updateMany(
                    { seenBy: { $ne: email } },
                    { $push: { seenBy: email } }
                );
                res.json({ message: "Marked all announcements as seen" });
            } catch (err) {
                console.error("Error marking announcements:", err);
                res.status(500).json({ message: "Failed to mark as seen" });
            }
        });


        // ----------------- Start Server -----------------
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

    } catch (err) {
        console.error("MongoDB error:", err);
    }
}

startServer();
