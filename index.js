import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import path, { dirname } from "path";
import fs from "fs";
import axios from "axios";
import { fileURLToPath } from "url";

const app = express();
const port = 3000;
const saltRounds = 10;
const __dirname = dirname(fileURLToPath(import.meta.url));

env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie:{
      maxAge: 1000 * 60 * 60 * 24,
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
db.connect();

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect("/login");
}

function formatData(data) {
  if (!data || data.length === 0) {
    return [];
  }

  data.forEach((item) => {
    if (item.description) {
      item.description = item.description.replace(/<br>/g, "");
      item.description = item.description.split("\n").join("<br>");
    }
    if (item.review) {
      item.review = item.review.replace(/<br>/g, "");
      item.review = item.review.split("\n").join("<br>");
    }
    if (item.note) {
      item.note = item.note.replace(/<br>/g, "");
      item.note = item.note.split("\n").join("<br>");
    }
  });

  return data;
}

// ---------------- Routes ----------------

app.get("/", ensureAuthenticated, async (req, res) => {
  const currentSortOption = req.query.sort;
  let result = null;

  try {
    if (!currentSortOption || currentSortOption === "title") {
      result = await db.query(
        "SELECT * FROM books WHERE user_id = $1 ORDER BY title ASC",
        [req.user.id]
      );
    } else if (currentSortOption === "date") {
      result = await db.query(
        "SELECT * FROM books WHERE user_id = $1 ORDER BY date_read DESC",
        [req.user.id]
      );
    } else if (currentSortOption === "rating") {
      result = await db.query(
        "SELECT * FROM books WHERE user_id = $1 ORDER BY rating DESC",
        [req.user.id]
      );
    }

    const formattedDetails = formatData(result.rows);
    res.render("index.ejs", {
      data: formattedDetails,
      sortOption: currentSortOption,
    });
  } catch (error) {
    console.log(error);
  }
});


app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/register",
  })
);

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            res.redirect("/");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

app.get("/new-entry", ensureAuthenticated, (req, res) => {
  res.render("new.ejs");
});

app.post("/logout", (req,res) =>{
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
})

app.post("/new-entry/add", ensureAuthenticated, async (req, res) => {
  const isbn = req.body.isbn;
  const fileName = `${isbn}.jpg`;
  const imageSavePath = path.join(__dirname, "public", "assets", "covers", fileName);
  const imagePath = `assets/covers/${fileName}`;
  const timeStamp = new Date();

  try {
    const result = await axios.get(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`, {
      responseType: "stream",
    });

    const fileStream = fs.createWriteStream(imageSavePath);
    result.data.pipe(fileStream);

    fileStream.on("finish", async () => {
      try {
        await db.query(
          "INSERT INTO books (isbn, title, author, description, review, rating, image_path, date_read, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [
            req.body.isbn,
            req.body.title,
            req.body.author,
            req.body.description,
            req.body.review,
            req.body.rating,
            imagePath,
            timeStamp,
            req.user.id,
          ]
        );
        res.redirect("/");
      } catch (dbError) {
        console.error("Error inserting into DB:", dbError);
        res.status(500).send("Database error");
      }
    });

    fileStream.on("error", (err) => {
      console.error("Error writing file:", err);
      res.status(500).send("File writing error");
    });
  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).send("Image fetch error");
  }
});

app.post("/books/:bookId/delete", ensureAuthenticated, async (req, res) => {
  const deleteBookId = req.params.bookId;
  try {
    await db.query("DELETE FROM notes WHERE book_id=$1", [deleteBookId]);
    await db.query("DELETE FROM books WHERE id=$1", [deleteBookId]);
    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
});

app.get("/notes/:bookId", ensureAuthenticated, async (req, res) => {
  const bookid = req.params.bookId;
  try {
    const result = await db.query(
      "SELECT notes.id, notes.book_id, title, author, image_path, date_read, notes.note FROM books LEFT JOIN notes ON books.id = notes.book_id WHERE books.id = $1 ORDER BY notes.id DESC",
      [bookid]
    );

    const formattedNotes = formatData(result.rows);
    res.render("notes.ejs", { data: formattedNotes, bookId: bookid });
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).send("Server error while fetching notes.");
  }
});

app.post("/notes/:bookId/add", ensureAuthenticated, async (req, res) => {
  const bookid = req.params.bookId;
  const note = req.body.newNote;
  try {
    await db.query("INSERT INTO notes (note, book_id) VALUES ($1, $2)", [note, bookid]);
    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
});

app.post("/notes/:noteId/delete", ensureAuthenticated, async (req, res) => {
  const bookid = req.body.bookId;
  const noteId = req.params.noteId;
  try {
    await db.query("DELETE FROM notes WHERE id=$1", [noteId]);
    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
});

app.post("/notes/:noteId/update", ensureAuthenticated, async (req, res) => {
  const bookid = req.body.bookId;
  const noteId = req.params.noteId;
  const newNotes = req.body.noteToUpdate;
  try {
    await db.query("UPDATE notes SET note = ($1) WHERE id=$2", [newNotes, noteId]);
    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
});

app.post("/reviews/:bookId/update", ensureAuthenticated, async (req, res) => {
  const bookid = req.params.bookId;
  const updatedReview = req.body.reviewToUpdate;
  try {
    await db.query("UPDATE books SET review= ($1) WHERE id=$2", [updatedReview, bookid]);
    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
});

// ---------------- Passport Strategies ----------------

passport.use(
  "local",
  new Strategy(async (username, password, cb) => {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [username]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb(null, false);
      }
    } catch (err) {
      console.log(err);
      return cb(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [profile.email]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
