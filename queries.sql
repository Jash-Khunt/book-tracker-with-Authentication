-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL
);

-- Books table
CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  isbn VARCHAR(20),
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  description TEXT,
  review TEXT,
  rating INTEGER,
  image_path VARCHAR(255),
  date_read TIMESTAMP,
  user_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notes table
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  note TEXT,
  book_id INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
