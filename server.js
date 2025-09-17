const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Database setup - supports both SQLite (dev) and PostgreSQL (production)
let db;

if (isProduction && process.env.DATABASE_URL) {
  // Production - PostgreSQL
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  console.log('Using PostgreSQL database in production');
  
  // Wrapper to make PostgreSQL work like SQLite
  db = {
    serialize: (callback) => callback(),
    run: (query, params = [], callback) => {
      // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
      let pgQuery = query;
      let paramIndex = 1;
      pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
      
      // Handle CREATE TABLE IF NOT EXISTS for PostgreSQL
      pgQuery = pgQuery.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
      pgQuery = pgQuery.replace(/AUTOINCREMENT/g, '');
      
      // Handle ALTER TABLE ADD COLUMN errors gracefully
      if (pgQuery.includes('ALTER TABLE') && pgQuery.includes('ADD COLUMN')) {
        return pool.query(pgQuery, params)
          .then(result => {
            if (callback) callback.call({ 
              lastID: result.rows && result.rows[0] ? result.rows[0].id : null,
              changes: result.rowCount || 0
            }, null);
          })
          .catch(err => {
            // Ignore column already exists errors
            if (err.code === '42701' || err.message.includes('already exists')) {
              if (callback) callback.call({ lastID: null, changes: 0 }, null);
            } else {
              console.error('Database error:', err);
              if (callback) callback.call({ lastID: null, changes: 0 }, err);
            }
          });
      } else {
        return pool.query(pgQuery, params)
          .then(result => {
            if (callback) callback.call({ 
              lastID: result.rows && result.rows[0] ? result.rows[0].id : null,
              changes: result.rowCount || 0
            }, null);
          })
          .catch(err => {
            console.error('Database error:', err);
            if (callback) callback.call({ lastID: null, changes: 0 }, err);
          });
      }
    },
    get: (query, params = [], callback) => {
      let pgQuery = query;
      let paramIndex = 1;
      pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
      
      return pool.query(pgQuery, params)
        .then(result => callback(null, result.rows[0] || null))
        .catch(err => {
          console.error('Database error:', err);
          callback(err, null);
        });
    },
    all: (query, params = [], callback) => {
      let pgQuery = query;
      let paramIndex = 1;
      pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
      
      return pool.query(pgQuery, params)
        .then(result => callback(null, result.rows || []))
        .catch(err => {
          console.error('Database error:', err);
          callback(err, []);
        });
    }
  };
} else {
  // Development - SQLite
  const sqlite3 = require("sqlite3").verbose();
  db = new sqlite3.Database("app.db");
  console.log('Using SQLite database in development');
}

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Database initialization
db.serialize(() => {
  // ===================== BASE TABLES =====================
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)"
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      owner_email TEXT,
      colleagues TEXT DEFAULT '[]',
      project_title TEXT,
      notes TEXT,
      colleague_name TEXT,
      colleague_phone TEXT,
      colleague_email TEXT,
      colleague_address1 TEXT,
      colleague_address2 TEXT,
      colleague_address3 TEXT,
      your_name TEXT,
      your_phone TEXT,
      your_email TEXT,
      your_address1 TEXT,
      your_address2 TEXT,
      your_address3 TEXT,
      objectives TEXT,
      timeline TEXT,
      primary_audience TEXT,
      secondary_audience TEXT,
      call_action TEXT,
      competition TEXT,
      graphics TEXT,
      photography TEXT,
      multimedia TEXT,
      other_info TEXT,
      client_name TEXT,
      client_comments TEXT,
      approval_date TEXT,
      approval_signature TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS colleagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      name TEXT,
      email TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      colleague_email TEXT,
      date TEXT,
      description TEXT
    )`
  );

  // ===================== ADDITIONAL TABLES =====================
  db.run(`CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    content TEXT,
    category TEXT DEFAULT 'general',
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    content TEXT,
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS career_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    description TEXT,
    progress INTEGER DEFAULT 0,
    goal_type TEXT DEFAULT 'general',
    target_date TEXT,
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS future_work (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    timeline TEXT,
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    description TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    title TEXT,
    description TEXT,
    event_date TEXT,
    start_time TEXT,
    end_time TEXT,
    repeat_weekly INTEGER DEFAULT 0,
    created_date TEXT,
    FOREIGN KEY(user_email) REFERENCES users(email)
  )`);

  // ===================== PROJECT DESCRIPTION EXTRA COLUMNS =====================
  const descriptionColumns = [
    "idea",
    "notes", 
    "career_goals",
    "future_work",
    "deadlines",
  ];

  descriptionColumns.forEach((column) => {
    db.run(
      `ALTER TABLE projects ADD COLUMN ${column} TEXT`,
      (err) => {
        // Ignore "duplicate column" errors - this is expected behavior
        if (err && !err.message.includes('duplicate') && err.code !== '42701') {
          console.error(`Error adding column ${column}:`, err);
        }
      }
    );
  });
});

// ===================== AUTH API WITH PASSWORD HASHING =====================
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
 
  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
 
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  try {
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
   
    db.run(
      "INSERT INTO users (email, password) VALUES (?, ?)",
      [email.toLowerCase().trim(), hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed') || err.code === '23505') {
            return res.status(400).json({ error: "User already exists." });
          }
          return res.status(500).json({ error: "Failed to create user." });
        }
        res.json({
          id: this.lastID,
          email: email.toLowerCase().trim(),
          message: "Account created successfully!"
        });
      }
    );
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: "Server error during signup." });
  }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
 
  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  db.get(
    "SELECT * FROM users WHERE email = ?",
    [email.toLowerCase().trim()],
    async (err, row) => {
      if (err) {
        console.error('Login database error:', err);
        return res.status(500).json({ error: "Login failed." });
      }
     
      if (!row) {
        return res.status(400).json({ error: "Invalid credentials." });
      }

      try {
        // Compare the provided password with the hashed password
        const passwordMatch = await bcrypt.compare(password, row.password);
       
        if (!passwordMatch) {
          return res.status(400).json({ error: "Invalid credentials." });
        }
       
        res.json({
          email: row.email,
          message: "Login successful!"
        });
      } catch (error) {
        console.error('Password comparison error:', error);
        res.status(500).json({ error: "Login failed." });
      }
    }
  );
});

// ===================== PROJECTS API =====================
app.post("/projects", (req, res) => {
  const { name, owner_email, colleagues } = req.body;
 
  if (!name || !owner_email) {
    return res.status(400).json({ error: "Project name and owner email are required." });
  }
 
  db.run(
    "INSERT INTO projects (name, owner_email, colleagues) VALUES (?, ?, ?)",
    [name, owner_email, colleagues || "[]"],
    function (err) {
      if (err) {
        console.error('Project creation error:', err);
        return res.status(500).json({ error: "Error creating project." });
      }
      res.json({ id: this.lastID, name, owner_email, colleagues });
    }
  );
});

app.get("/projects/:email", (req, res) => {
  db.all(
    "SELECT * FROM projects WHERE owner_email = ?",
    [req.params.email],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error fetching projects." });
      res.json(rows);
    }
  );
});

app.put("/projects/:id", (req, res) => {
  const { name, colleagues } = req.body;
  db.run(
    "UPDATE projects SET name = ?, colleagues = ? WHERE id = ?",
    [name, colleagues, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating project." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/projects/:id", (req, res) => {
  db.run("DELETE FROM projects WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting project." });
    res.json({ deleted: this.changes });
  });
});

// ===================== MEETINGS API =====================
app.post("/meetings", (req, res) => {
  const { colleague_email, date, description } = req.body;
  db.run(
    "INSERT INTO meetings (colleague_email, date, description) VALUES (?, ?, ?)",
    [colleague_email, date, description],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating meeting." });
      res.json({ id: this.lastID, colleague_email, date, description });
    }
  );
});

app.get("/meetings/:email", (req, res) => {
  db.all(
    "SELECT * FROM meetings WHERE colleague_email = ?",
    [req.params.email],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error fetching meetings." });
      res.json(rows);
    }
  );
});

// ===================== PROJECT DESCRIPTION API =====================
app.get("/projects/:id/description", (req, res) => {
  db.get(
    "SELECT idea, notes, career_goals, future_work, deadlines, project_title, colleague_name, colleague_phone, colleague_email, colleague_address1, colleague_address2, colleague_address3, your_name, your_phone, your_email, your_address1, your_address2, your_address3, objectives, timeline, primary_audience, secondary_audience, call_action, competition, graphics, photography, multimedia, other_info, client_name, client_comments, approval_date, approval_signature FROM projects WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error fetching description." });
      res.json(row || {});
    }
  );
});

app.put("/projects/:id/description", (req, res) => {
  const { projectTitle, notes, colleagueName, colleaguePhone, colleagueEmail, colleagueAddress1, colleagueAddress2, colleagueAddress3, yourName, yourPhone, yourEmail, yourAddress1, yourAddress2, yourAddress3, objectives, timeline, primaryAudience, secondaryAudience, callAction, competition, graphics, photography, multimedia, otherInfo, clientName, clientComments, approvalDate, approvalSignature } = req.body;
 
  db.run(
    `UPDATE projects SET
      project_title = ?, notes = ?, colleague_name = ?, colleague_phone = ?, colleague_email = ?,
      colleague_address1 = ?, colleague_address2 = ?, colleague_address3 = ?,
      your_name = ?, your_phone = ?, your_email = ?, your_address1 = ?, your_address2 = ?, your_address3 = ?,
      objectives = ?, timeline = ?, primary_audience = ?, secondary_audience = ?, call_action = ?,
      competition = ?, graphics = ?, photography = ?, multimedia = ?, other_info = ?,
      client_name = ?, client_comments = ?, approval_date = ?, approval_signature = ?
      WHERE id = ?`,
    [projectTitle, notes, colleagueName, colleaguePhone, colleagueEmail, colleagueAddress1, colleagueAddress2, colleagueAddress3, yourName, yourPhone, yourEmail, yourAddress1, yourAddress2, yourAddress3, objectives, timeline, primaryAudience, secondaryAudience, callAction, competition, graphics, photography, multimedia, otherInfo, clientName, clientComments, approvalDate, approvalSignature, req.params.id],
    function (err) {
      if (err) {
        console.error('Update error:', err);
        return res.status(500).json({ error: "Error updating description." });
      }
      res.json({ updated: this.changes });
    }
  );
});

// ===================== IDEAS API =====================
app.get("/ideas/:email", (req, res) => {
  db.all("SELECT * FROM ideas WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching ideas." });
    res.json(rows);
  });
});

app.post("/ideas", (req, res) => {
  const { user_email, title, content, category, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO ideas (user_email, title, content, category, created_date) VALUES (?, ?, ?, ?, ?)",
    [user_email, title, content, category || 'general', date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating idea." });
      res.json({ id: this.lastID, user_email, title, content, category, created_date: date });
    }
  );
});

app.put("/ideas/:id", (req, res) => {
  const { title, content, category } = req.body;
  db.run(
    "UPDATE ideas SET title = ?, content = ?, category = ? WHERE id = ?",
    [title, content, category, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating idea." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/ideas/:id", (req, res) => {
  db.run("DELETE FROM ideas WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting idea." });
    res.json({ deleted: this.changes });
  });
});

// ===================== NOTES API =====================
app.get("/notes/:email", (req, res) => {
  db.all("SELECT * FROM notes WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching notes." });
    res.json(rows);
  });
});

app.post("/notes", (req, res) => {
  const { user_email, title, content, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO notes (user_email, title, content, created_date) VALUES (?, ?, ?, ?)",
    [user_email, title, content, date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating note." });
      res.json({ id: this.lastID, user_email, title, content, created_date: date });
    }
  );
});

app.put("/notes/:id", (req, res) => {
  const { title, content } = req.body;
  db.run(
    "UPDATE notes SET title = ?, content = ? WHERE id = ?",
    [title, content, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating note." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/notes/:id", (req, res) => {
  db.run("DELETE FROM notes WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting note." });
    res.json({ deleted: this.changes });
  });
});

// ===================== CAREER GOALS API =====================
app.get("/career_goals/:email", (req, res) => {
  db.all("SELECT * FROM career_goals WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching career goals." });
    res.json(rows);
  });
});

// Alias for career goals (dashboard uses this)
app.get("/career/:email", (req, res) => {
  db.all("SELECT * FROM career_goals WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching career goals." });
    res.json(rows);
  });
});

app.post("/career_goals", (req, res) => {
  const { user_email, title, description, progress, goal_type, target_date, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO career_goals (user_email, title, description, progress, goal_type, target_date, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [user_email, title, description, progress || 0, goal_type || 'general', target_date, date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating career goal." });
      res.json({ id: this.lastID, user_email, title, description, progress, goal_type, target_date, created_date: date });
    }
  );
});

app.put("/career_goals/:id", (req, res) => {
  const { title, description, progress, goal_type, target_date } = req.body;
  db.run(
    "UPDATE career_goals SET title = ?, description = ?, progress = ?, goal_type = ?, target_date = ? WHERE id = ?",
    [title, description, progress, goal_type, target_date, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating career goal." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/career_goals/:id", (req, res) => {
  db.run("DELETE FROM career_goals WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting career goal." });
    res.json({ deleted: this.changes });
  });
});

// ===================== FUTURE WORK API =====================
app.get("/future_work/:email", (req, res) => {
  db.all("SELECT * FROM future_work WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching future work." });
    res.json(rows);
  });
});

// Alias for future work (dashboard uses this)
app.get("/future/:email", (req, res) => {
  db.all("SELECT * FROM future_work WHERE user_email = ? ORDER BY created_date DESC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching future work." });
    res.json(rows);
  });
});

app.post("/future_work", (req, res) => {
  const { user_email, title, description, priority, timeline, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO future_work (user_email, title, description, priority, timeline, created_date) VALUES (?, ?, ?, ?, ?, ?)",
    [user_email, title, description, priority || 'medium', timeline, date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating future work." });
      res.json({ id: this.lastID, user_email, title, description, priority, timeline, created_date: date });
    }
  );
});

app.put("/future_work/:id", (req, res) => {
  const { title, description, priority, timeline } = req.body;
  db.run(
    "UPDATE future_work SET title = ?, description = ?, priority = ?, timeline = ? WHERE id = ?",
    [title, description, priority, timeline, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating future work." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/future_work/:id", (req, res) => {
  db.run("DELETE FROM future_work WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting future work." });
    res.json({ deleted: this.changes });
  });
});

// ===================== DEADLINES API =====================
app.get("/deadlines/:email", (req, res) => {
  db.all("SELECT * FROM deadlines WHERE user_email = ? ORDER BY due_date ASC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching deadlines." });
    res.json(rows);
  });
});

app.post("/deadlines", (req, res) => {
  const { user_email, title, description, due_date, priority, status, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO deadlines (user_email, title, description, due_date, priority, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [user_email, title, description, due_date, priority || 'medium', status || 'pending', date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating deadline." });
      res.json({ id: this.lastID, user_email, title, description, due_date, priority, status, created_date: date });
    }
  );
});

app.put("/deadlines/:id", (req, res) => {
  const { title, description, due_date, priority, status } = req.body;
  db.run(
    "UPDATE deadlines SET title = ?, description = ?, due_date = ?, priority = ?, status = ? WHERE id = ?",
    [title, description, due_date, priority, status, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating deadline." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/deadlines/:id", (req, res) => {
  db.run("DELETE FROM deadlines WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting deadline." });
    res.json({ deleted: this.changes });
  });
});

// ===================== CALENDAR EVENTS API =====================
// Fixed endpoints to match dashboard expectations
app.get("/events/:email", (req, res) => {
  db.all("SELECT id, title, description, event_date as date, start_time as start, end_time as end, repeat_weekly as repeatWeekly FROM calendar_events WHERE user_email = ? ORDER BY event_date ASC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching events." });
    res.json(rows);
  });
});

app.post("/events", (req, res) => {
  const { userEmail, title, description, date, start, end, repeatWeekly } = req.body;
  const created_date = new Date().toISOString();
  db.run(
    "INSERT INTO calendar_events (user_email, title, description, event_date, start_time, end_time, repeat_weekly, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userEmail, title, description, date, start, end, repeatWeekly ? 1 : 0, created_date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating event." });
      res.json({ id: this.lastID, title, description, date, start, end, repeatWeekly, created_date });
    }
  );
});

app.put("/events/:id", (req, res) => {
  const { title, description, date, start, end, repeatWeekly } = req.body;
  db.run(
    "UPDATE calendar_events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, repeat_weekly = ? WHERE id = ?",
    [title, description, date, start, end, repeatWeekly ? 1 : 0, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating event." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/events/:id", (req, res) => {
  db.run("DELETE FROM calendar_events WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting event." });
    res.json({ deleted: this.changes });
  });
});

// ===================== LEGACY CALENDAR EVENTS API (for compatibility) =====================
app.get("/calendar_events/:email", (req, res) => {
  db.all("SELECT * FROM calendar_events WHERE user_email = ? ORDER BY event_date ASC", [req.params.email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error fetching events." });
    res.json(rows);
  });
});

app.post("/calendar_events", (req, res) => {
  const { user_email, title, description, event_date, start_time, end_time, repeat_weekly, created_date } = req.body;
  const date = created_date || new Date().toISOString();
  db.run(
    "INSERT INTO calendar_events (user_email, title, description, event_date, start_time, end_time, repeat_weekly, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [user_email, title, description, event_date, start_time, end_time, repeat_weekly, date],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creating event." });
      res.json({ id: this.lastID, user_email, title, description, event_date, start_time, end_time, repeat_weekly, created_date: date });
    }
  );
});

app.put("/calendar_events/:id", (req, res) => {
  const { title, description, event_date, start_time, end_time, repeat_weekly } = req.body;
  db.run(
    "UPDATE calendar_events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, repeat_weekly = ? WHERE id = ?",
    [title, description, event_date, start_time, end_time, repeat_weekly, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Error updating event." });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/calendar_events/:id", (req, res) => {
  db.run("DELETE FROM calendar_events WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error deleting event." });
    res.json({ deleted: this.changes });
  });
});

// ===================== FRONTEND ROUTES =====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Catch all route for SPA
app.get("*", (req, res) => {
  if (req.path.endsWith('.html')) {
    res.sendFile(path.join(__dirname, req.path));
  } else {
    res.sendFile(path.join(__dirname, "index.html"));
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${isProduction && process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
});

