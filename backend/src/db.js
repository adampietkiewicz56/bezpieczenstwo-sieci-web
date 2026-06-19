const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://appuser:apppass@localhost:5433/appdb',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[app-db] pg pool error', err));

async function query(text, params) {
  return pool.query(text, params);
}

async function waitForDb(maxAttempts = 30, delayMs = 1000) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === maxAttempts) throw err;
      console.log(`[app-db] waiting for postgres (${i}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function upsertUserFromClaims(claims) {
  await pool.query(
    `INSERT INTO users (id, username, email, name, roles, last_seen)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE
       SET username  = COALESCE(EXCLUDED.username,  users.username),
           email     = COALESCE(EXCLUDED.email,     users.email),
           name      = COALESCE(EXCLUDED.name,      users.name),
           roles     = EXCLUDED.roles,
           last_seen = NOW()`,
    [
      claims.sub,
      claims.preferred_username || null,
      claims.email || null,
      claims.name || null,
      claims.roles || [],
    ],
  );
}

module.exports = { pool, query, waitForDb, upsertUserFromClaims };
