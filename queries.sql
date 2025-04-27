-- books table
CREATE TABLE books(
	id SERIAL PRIMARY KEY,
	isbn TEXT,
	title TEXT NOT NULL,
	author TEXT,
	description TEXT,
	review TEXT,
	rating INTEGER CHECK (rating >= 0 AND rating <= 5),
	image_path TEXT,
	date_read DATE
)

-- notes table
CREATE TABLE notes(
	id SERIAL PRIMARY KEY,
	note TEXT NOT NULL,
	book_id INTEGER REFERENCES books(id) ON DELETE CASCADE
);