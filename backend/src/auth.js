const { createRemoteJWKSet, jwtVerify } = require('jose');
const { upsertUserFromClaims } = require('./db');

const ISSUER = process.env.OIDC_ISSUER || 'http://localhost:9000';
const JWKS_URI = process.env.OIDC_JWKS_URI || 'http://localhost:9000/jwks';
const AUDIENCE = process.env.OIDC_AUDIENCE || 'urn:bezpsw:api';

// Remote JWKS z wbudowanym cache (jose). Backend pobiera klucz publiczny
// raz na ok. 10 minut i weryfikuje podpisy lokalnie.
const JWKS = createRemoteJWKSet(new URL(JWKS_URI), {
  cooldownDuration: 30_000,
  cacheMaxAge: 600_000,
});

async function verifyAccessToken(token) {
  const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['RS256'],
  });
  return { payload, header: protectedHeader };
}

// Middleware: wymaga waznego Bearer JWT. Wstrzykuje req.user.
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    return res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="bezpsw-api", error="invalid_request"')
      .json({ error: 'missing_bearer_token' });
  }
  const token = match[1];

  verifyAccessToken(token)
    .then(async ({ payload }) => {
      const scope = (payload.scope || '').split(' ').filter(Boolean);
      req.user = {
        sub: payload.sub,
        name: payload.name,
        email: payload.email,
        preferred_username: payload.preferred_username,
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        scope,
        raw: payload,
      };
      // Mirror w lokalnej bazie - potrzebne do FK z tabeli tasks.
      try {
        await upsertUserFromClaims(req.user);
      } catch (err) {
        console.error('[auth] upsertUserFromClaims failed', err.message);
        return res.status(500).json({ error: 'internal' });
      }
      return next();
    })
    .catch((err) => {
      console.warn('[auth] token rejected:', err.code || err.message);
      res
        .status(401)
        .set('WWW-Authenticate', `Bearer error="invalid_token", error_description="${err.code || 'invalid'}"`)
        .json({ error: 'invalid_token', detail: err.code || err.message });
    });
}

// Middleware: wymaga konkretnego scope (np. tasks.write).
function requireScope(...required) {
  return (req, res, next) => {
    const have = new Set(req.user?.scope || []);
    for (const s of required) {
      if (!have.has(s)) {
        return res
          .status(403)
          .set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${required.join(' ')}"`)
          .json({ error: 'insufficient_scope', required });
      }
    }
    return next();
  };
}

// Middleware: wymaga konkretnej roli (np. admin).
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user?.roles?.includes(role)) {
      return res.status(403).json({ error: 'forbidden', required_role: role });
    }
    return next();
  };
}

module.exports = {
  authRequired,
  requireScope,
  requireRole,
  verifyAccessToken,
  ISSUER,
  AUDIENCE,
};
