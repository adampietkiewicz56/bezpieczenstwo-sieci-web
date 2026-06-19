/**
 * Integration testy. Wymagaja postgresa pod $DATABASE_URL (w CI uruchamiamy
 * service `postgres` w GitHub Actions). Lokalnie mozna odpalic kontener:
 *   docker compose up -d auth-db
 *   DATABASE_URL=postgres://authuser:authpass@localhost:5432/authdb npm test
 */
const request = require('supertest');

const hasDb = !!process.env.DATABASE_URL;
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Authorization Server - OIDC + PKCE', () => {
  let app;

  beforeAll(async () => {
    process.env.ISSUER = process.env.ISSUER || 'http://localhost:9000';
    const { buildApp } = require('../src/index');
    const built = await buildApp();
    app = built.app;
  });

  test('publikuje OIDC discovery document', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe(process.env.ISSUER);
    expect(res.body.code_challenge_methods_supported).toContain('S256');
    expect(res.body.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token']),
    );
    expect(res.body.scopes_supported).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'roles', 'tasks.read', 'tasks.write']),
    );
  });

  test('publikuje JWKS z kluczem RS256', async () => {
    const res = await request(app).get('/jwks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys[0].alg).toBe('RS256');
    expect(res.body.keys[0].kty).toBe('RSA');
    // Klucz publiczny w JWKS nie moze miec komponentow prywatnych:
    expect(res.body.keys[0].d).toBeUndefined();
  });

  test('PKCE WYMUSZONE - /auth bez code_challenge zwraca blad', async () => {
    const res = await request(app)
      .get('/auth')
      .query({
        client_id: 'bezpsw-spa',
        response_type: 'code',
        redirect_uri: 'http://localhost:3000/callback',
        scope: 'openid',
        state: 'xyz123',
      })
      .redirects(0);

    // oidc-provider wykrywa brak code_challenge i redirektuje z error=invalid_request
    // (do redirect_uri) LUB zwraca 400 jezeli nie da sie wybrac redirect_uri.
    if (res.status >= 300 && res.status < 400) {
      expect(res.headers.location).toMatch(/error=invalid_request/);
    } else {
      expect(res.status).toBe(400);
    }
  });

  test('healthcheck odpowiada bez auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
