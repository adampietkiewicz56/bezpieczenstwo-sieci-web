const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { waitForDb, query } = require('./db');

const profileRoute = require('./routes/profile');
const tasksRoute   = require('./routes/tasks');
const adminRoute   = require('./routes/admin');

const PORT = parseInt(process.env.PORT || '8080', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

function buildApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(morgan('combined'));

  // -------- NIEZABEZPIECZONE ENDPOINTY ----------------------------------
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'backend' }));
  app.get('/ready', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', detail: err.message });
    }
  });

  // -------- ZABEZPIECZONE ENDPOINTY -------------------------------------
  app.use('/api', profileRoute);            // /api/profile
  app.use('/api/tasks', tasksRoute);        // /api/tasks (CRUD)
  app.use('/api/admin', adminRoute);        // /api/admin/* (RBAC)

  // Domyslny 404 dla nieznanych routes.
  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // Error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[backend] unhandled error', err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}

if (require.main === module) {
  (async () => {
    try {
      await waitForDb();
      const app = buildApp();
      app.listen(PORT, () => {
        console.log(`[backend] listening on http://0.0.0.0:${PORT}`);
        console.log(`[backend] OIDC issuer: ${process.env.OIDC_ISSUER}`);
        console.log(`[backend] OIDC JWKS:   ${process.env.OIDC_JWKS_URI}`);
        console.log(`[backend] audience:    ${process.env.OIDC_AUDIENCE}`);
      });
    } catch (err) {
      console.error('[backend] fatal startup', err);
      process.exit(1);
    }
  })();
}

module.exports = { buildApp };
