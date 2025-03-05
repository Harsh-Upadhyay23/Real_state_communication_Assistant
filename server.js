const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const { Server } = require("socket.io");
const http = require("http");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Database Connection
const db = mysql.createPool({
    connectionLimit: 10,
    host: "localhost",
    user: "root",
    password: "Harshu267",
    database: "chatapp1"
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: true
}));
app.set("view engine", "ejs");

// Store Online Users
const onlineUsers = {};

// Routes
app.get("/", (req, res) => {
    req.session.user ? res.redirect("/chat") : res.redirect("/login");
});

app.get("/chat", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    res.render("chat", { 
        username: req.session.user.username,
        language: req.session.user.language 
    });
});

app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));

// Registration
app.post("/register", (req, res) => {
    const { username, password, language } = req.body;
    
    db.query("SELECT * FROM users WHERE username = ?", [username], (err, results) => {
        if (err) return res.send("Database error!");
        if (results.length > 0) return res.send("Username exists!");
        
        bcrypt.hash(password, 10, (err, hash) => {
            db.query("INSERT INTO users (username, password, language) VALUES (?, ?, ?)", 
            [username, hash, language], 
            (err) => {
                if (err) return res.send("Registration failed!");
                res.redirect("/login");
            });
        });
    });
});

// Login
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    db.query("SELECT * FROM users WHERE username = ?", [username], (err, results) => {
        if (err || results.length === 0) return res.send("Invalid credentials!");
        
        bcrypt.compare(password, results[0].password, (err, match) => {
            if (!match) return res.send("Invalid credentials!");
            
            req.session.user = {
                id: results[0].id,
                username: results[0].username,
                language: results[0].language
            };
            res.redirect("/chat");
        });
    });
});

// Logout
app.get("/logout", async (req, res) => {
    try {
        // Fetch messages from the database
        const [messages] = await db.promise().execute("SELECT sender, receiver, message, timestamp FROM messages");

        console.log("Fetched Messages:", messages); // Debugging output

        // Destroy session and render summary view
        req.session.destroy(() => {
            res.render("summary", { messages });
            
        });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).send("Internal Server Error");
    }
});




// Translation Function (Fixed with explicit source/target)
async function translateMessage(text, sourceLang, targetLang) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
    try {
        const response = await axios.get(url);
        return response.data.responseData.translatedText || text;
    } catch (error) {
        console.log(`Translation error (${sourceLang}→${targetLang}):`, error.message);
        return text;
    }
}

// Socket.io Implementation
io.on("connection", (socket) => {
    console.log("User connected");

    socket.on("user connected", (userData) => {
        onlineUsers[userData.username] = {
            socketId: socket.id,
            language: userData.language || 'en'
        };
        io.emit("update users", Object.keys(onlineUsers));
    });

    socket.on("chat message", async ({ sender, message }) => {
        const senderData = onlineUsers[sender];
        if (!senderData) return;

        db.query(
            "INSERT INTO messages (sender, receiver, message, source_lang) VALUES (?, ?, ?, ?)", 
            [sender, "all", message, senderData.language],
            async (err) => {
                if (err) return console.error("Message save error:", err);
                
                for (const [username, userData] of Object.entries(onlineUsers)) {
                    try {
                        let finalMessage = message;
                        
                        if (userData.language !== senderData.language) {
                            finalMessage = await translateMessage(
                                message, 
                                senderData.language, 
                                userData.language
                            );
                        }

                        io.to(userData.socketId).emit("chat message", {
                            sender: sender,
                            message: finalMessage
                        });
                    } catch (error) {
                        io.to(userData.socketId).emit("chat message", {
                            sender: sender,
                            message: message
                        });
                    }
                }
            }
        );
    });

    socket.on("typing", (username) => {
        socket.broadcast.emit("typing", username);
    });

    socket.on("stop typing", (username) => {
        socket.broadcast.emit("stop typing", username);
    });

    socket.on("disconnect", () => {
        const user = Object.keys(onlineUsers).find(u => onlineUsers[u].socketId === socket.id);
        if (user) {
            delete onlineUsers[user];
            io.emit("update users", Object.keys(onlineUsers));
        }
        console.log("User disconnected");
    });
});

// server.listen(3000, '192.168.109.237', () => 
//     console.log("Server running on http://192.168.109.237:3000")
// );
server.listen(3000, '10.125.80.131', () => 
    console.log("Server running on http://10.125.80.131:3000")
);


