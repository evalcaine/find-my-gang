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

/* =====================================================
   GET /api/profile
===================================================== */
api.get('/profile', async (req, res) => {
  const { email, name, date, city } = req.query;

  if (!email || !name || !date || !city) {
    return res.status(400).json({ error: 'Missing params' });
  }

  try {
    const matchResult = await pool.query(
      `
      SELECT 1
      FROM user_trips u1
      JOIN routes r1
        ON TRIM(UPPER(r1.code)) = TRIM(UPPER(u1.route_code))
      JOIN user_trips u2
        ON LOWER(TRIM(u2.email)) = LOWER(TRIM($1))
      JOIN routes r2
        ON TRIM(UPPER(r2.code)) = TRIM(UPPER(u2.route_code))
      WHERE LOWER(TRIM(u1.email)) != LOWER(TRIM($1))
        AND LOWER(TRIM(u1.name)) = LOWER(TRIM($2))
        AND (u1.start_date::date + r1.day_offset) = $3::date
        AND LOWER(TRIM(r1.city)) = LOWER(TRIM($4))
        AND (u2.start_date::date + r2.day_offset) = $3::date
        AND LOWER(TRIM(r2.city)) = LOWER(TRIM($4))
      LIMIT 1
      `,
      [email, name, date, city]
    );

    if (!matchResult.rows.length) {
      return res.status(403).json({ error: 'No valid match for this profile' });
    }

    const profileResult = await pool.query(
      `
      SELECT name, phone
      FROM profiles
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
      [name]
    );

    if (!profileResult.rows.length) {
      return res.json({ name, phone: null });
    }

    return res.json(profileResult.rows[0]);
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

/* =====================================================
   GET /api/user-tours
===================================================== */
api.get('/user-tours', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, route_code, start_date, end_date
      FROM user_trips
      WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
      ORDER BY start_date, id
      `,
      [email]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

/* =====================================================
   DELETE /api/user-tours/:id
===================================================== */
api.delete('/user-tours/:id', async (req, res) => {
  const { id } = req.params;
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM user_trips
      WHERE id = $1
        AND LOWER(TRIM(email)) = LOWER(TRIM($2))
      RETURNING id
      `,
      [id, email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Tour not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

/* =====================================================
   PUT /api/user-tours/:id
===================================================== */
api.put('/user-tours/:id', async (req, res) => {
  const { id } = req.params;
  const { email, routeCode, startDate } = req.body;

  if (!email || !routeCode || !startDate) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
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

    const start = new Date(startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + maxOffset + 1);

    const newEnd = end.toISOString().split('T')[0];

    const overlapCheck = await pool.query(
      `
      SELECT 1
      FROM user_trips
      WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
        AND id <> $2
        AND start_date < $4
        AND $3 < end_date
      LIMIT 1
      `,
      [email, id, startDate, newEnd]
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This tour overlaps with another existing tour'
      });
    }

    const updateResult = await pool.query(
      `
      UPDATE user_trips
      SET route_code = UPPER(TRIM($1)),
          start_date = $2,
          end_date = $3
      WHERE id = $4
        AND LOWER(TRIM(email)) = LOWER(TRIM($5))
      RETURNING id
      `,
      [routeCode, startDate, newEnd, id, email]
    );

    if (!updateResult.rows.length) {
      return res.status(404).json({ error: 'Tour not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});


/* ------------------ MOUNT API ------------------ */
app.use('/api', api);

/* ------------------ FRONTEND FALLBACK ------------------ */
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'login.html'));
});

/* ------------------ SERVER ------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
