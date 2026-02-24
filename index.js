// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();

/* ------------------ MIDDLEWARE ------------------ */
app.use(cors());
app.use(express.json());

/* ------------------ DATABASE ------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Test de conexión
(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Database connection error:', err);
  }
})();

/* ------------------ STATIC FRONTEND ------------------ */
app.use(express.static(path.join(__dirname, 'frontend')));

/* ------------------ API ROUTER ------------------ */
const api = express.Router();

/* =====================================================
   POST /api/trips
   - Evita solapamiento de tours
   - Permite último día = primer día siguiente
===================================================== */
api.post('/trips', async (req, res) => {
  const { email, name, routeCode, startDate } = req.body;

  if (!email || !name || !routeCode || !startDate) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // Normalizar email
  const normalizedEmail = email.trim().toLowerCase();

  try {
    /* 1️⃣ Obtener duración del tour */
    const routeResult = await pool.query(
      `
      SELECT MAX(day_offset) AS max_offset
      FROM routes
      WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))
      `,
      [routeCode]
    );

    const maxOffset = routeResult.rows[0]?.max_offset;

    if (maxOffset === null || maxOffset === undefined) {
      return res.status(404).json({ error: 'Route not found' });
    }

    /* 2️⃣ Calcular rango [start_date, end_date) */
    const start = new Date(startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + maxOffset + 1); // rango semi-abierto

    const newStart = startDate;
    const newEnd = end.toISOString().split('T')[0];

    /* 3️⃣ Verificar solapamiento */
    const overlapCheck = await pool.query(
      `
      SELECT 1
      FROM user_trips
      WHERE LOWER(TRIM(email)) = $1
        AND start_date < $3
        AND $2 < end_date
      LIMIT 1
      `,
      [normalizedEmail, newStart, newEnd]
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This tour overlaps with another existing tour'
      });
    }

    /* 4️⃣ Insertar tour */
    await pool.query(
      `
      INSERT INTO user_trips
        (email, name, route_code, start_date, end_date)
      VALUES
        ($1, $2, UPPER(TRIM($3)), $4, $5)
      `,
      [normalizedEmail, name, routeCode, newStart, newEnd]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =====================================================
   GET /api/routes
===================================================== */
api.get('/routes', async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT DISTINCT code
      FROM routes
      ORDER BY code
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =====================================================
   GET /api/matches/grouped
===================================================== */
api.get('/matches/grouped', async (req, res) => {
  const { email, date } = req.query;

  if (!email || !date) {
    return res.status(400).json({ error: 'Missing email or date' });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        r.city,
        to_char(
          (u.start_date::date + r.day_offset),
          'YYYY-MM-DD'
        ) AS date,
        array_agg(u.name ORDER BY u.name) AS people
      FROM user_trips u
      JOIN routes r
        ON TRIM(UPPER(r.code)) = TRIM(UPPER(u.route_code))
      WHERE (u.start_date::date + r.day_offset) = $1::date
        AND LOWER(TRIM(u.email)) != LOWER(TRIM($2))
      GROUP BY r.city, date
      ORDER BY r.city
      `,
      [date, email]
    );

    res.json(result.rows);

  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ------------------ MOUNT API ------------------ */
app.use('/api', api);

/* ------------------ FRONTEND FALLBACK ------------------ */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'login.html'));
});

/* ------------------ SERVER ------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});