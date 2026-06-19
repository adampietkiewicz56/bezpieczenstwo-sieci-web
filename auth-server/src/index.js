const path = require('path');
const express = require('express');
const helmet = require('helmet');

const { waitForDb } = require('./db');
const Account = require('./account');
const { buildConfiguration, ISSUER } = require('./config');
const { registerInteractionRoutes } = require('./routes');

const PORT = parseInt(process.env.PORT || '9000', 10);

async function buildApp() {
  const { default: Provider } = await import('oidc-provider');

  await waitForDb();
  await Account.seedUsers();

  const configuration = await buildConfiguration();
  const provider = new Provider(ISSUER, configuration);

  // Za reverse-proxy (jezeli kiedys) - tu lokalnie tez nie szkodzi.
  provider.proxy = true;

  const app = express();

  // helmet z lagodnym CSP (oidc-provider serwuje swoje endpointy + my mamy EJS).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Statyczne dla styli (jezeli kiedys dodamy).
  app.use('/static', express.static(path.join(__dirname, 'public')));

  // Healthcheck (niezabezpieczony, do orkiestracji).
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-server' }));

  // Routy interakcji (login + consent).
  registerInteractionRoutes(app, provider);

  // Wszystko inne mountujemy na callbacku providera (jego endpointy OIDC).
  app.use(provider.callback());

  return { app, provider };
}

if (require.main === module) {
  buildApp()
    .then(({ app }) => {
      app.listen(PORT, () => {
        console.log(`[auth-server] listening on http://0.0.0.0:${PORT}`);
        console.log(`[auth-server] issuer: ${ISSUER}`);
        console.log(`[auth-server] discovery: ${ISSUER}/.well-known/openid-configuration`);
      });
    })
    .catch((err) => {
      console.error('[auth-server] fatal startup error', err);
      process.exit(1);
    });
}

module.exports = { buildApp };
