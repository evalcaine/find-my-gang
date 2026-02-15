require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// 🔥 FRONTEND ESTÁTICO
app.use(express.static(path.join(__dirname, 'frontend')));

/* ===============================
   DATABASE
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ===============================
   ROOT → FRONTEND
================================ */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

/* ===============================
   ROUTES
================================ */
app.get('/routes', async (_, res) => {
  const r = await pool.query(
    `SELECT DISTINCT code FROM routes ORDER BY code`
  );
  res.json(r.rows);
});

/* ===============================
   CREATE TOUR
================================ */
app.post('/trips', async (req, res) => {
  const { email, name, routeCode, startDate } = req.body;
  if (!email || !name || !routeCode || !startDate) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const duration = await pool.query(
    `SELECT MAX(day_offset) max_day FROM routes WHERE UPPER(code)=UPPER($1)`,
    [routeCode]
  );

  if (!duration.rows[0].max_day) {
    return res.status(400).json({ error: 'Invalid route' });
  }

  await pool.query(
    `INSERT INTO user_trips (email,name,route_code,start_date)
     VALUES ($1,$2,UPPER($3),$4)`,
    [email, name, routeCode, startDate]
  );

  res.json({ ok: true });
});

/* ===============================
   USER TOURS
================================ */
app.get('/user-tours', async (req, res) => {
  const { email } = req.query;

  const r = await pool.query(
    `
    SELECT ut.id, ut.route_code, ut.start_date,
           MAX(ut.start_date + r.day_offset) end_date
    FROM user_trips ut
    JOIN routes r ON UPPER(r.code)=UPPER(ut.route_code)
    WHERE ut.email=$1
    GROUP BY ut.id
    ORDER BY ut.start_date
    `,
    [email]
  );

  res.json(r.rows);
});

/* ===============================
   MATCHES (REAL)
================================ */
app.get('/matches/grouped', async (req, res) => {
  const { email, date } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT
        r.city,
        $2::date AS date,
        json_agg(DISTINCT jsonb_build_object(
          'name', ut.name
        )) AS people
      FROM user_trips ut
      JOIN routes r
        ON UPPER(r.code) = UPPER(ut.route_code)
      WHERE ut.email <> $1
        AND $2::date BETWEEN ut.start_date
        AND ut.start_date + r.day_offset
      GROUP BY r.city
      `,
      [email, date]
    );

    res.json(result.rows);

  } catch (err) {
    console.error('MATCH ERROR:', err);
    res.status(500).json({ error: 'Match error' });
  }
});

/* ===============================
   PROFILE (NUEVO)
================================ */
app.get('/profile', async (req, res) => {
  const { name } = req.query;

  const r = await pool.query(
    `SELECT name, phone FROM profiles WHERE name=$1`,
    [name]
  );

  if (!r.rowCount) return res.sendStatus(403);
  res.json(r.rows[0]);
});

/* ===============================
   SERVER
================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
);
