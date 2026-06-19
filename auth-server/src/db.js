const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://authuser:authpass@localhost:5432/authdb',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[auth-db] pg pool error', err);
});

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
      console.log(`[auth-db] waiting for postgres (${i}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { pool, query, waitForDb };
