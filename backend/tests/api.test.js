/**
 * Testy API. Generujemy lokalna pare kluczy, stawiamy mock JWKS endpoint
 * i wskazujemy backend na nasz endpoint via OIDC_JWKS_URI. Sami podpisujemy
 * tokeny -> nie potrzebujemy realnego auth-servera.
 *
 * Testy DB-zalezne (200 dla /api/profile, /api/admin/users) sa gated na
 * env DATABASE_URL. W CI uruchamiamy serwis postgres i ustawiamy te zmienna.
 */
const http = require('http');
const request = require('supertest');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

const TEST_ISSUER   = 'http://test-issuer';
const TEST_AUDIENCE = 'urn:bezpsw:api';
const TEST_KID      = 'test-key-1';

let jwksServer;
let privateKey;
let app;

const hasDb = !!process.env.DATABASE_URL;
const dbTest = hasDb ? test : test.skip;

async function signToken(claims, overrides = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid || TEST_KID })
    .setIssuedAt()
    .setIssuer(overrides.iss || TEST_ISSUER)
    .setAudience(overrides.aud || TEST_AUDIENCE)
    .setExpirationTime(overrides.exp || '5m')
    .sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const publicJwk = await exportJWK(kp.publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  publicJwk.kid = TEST_KID;

  jwksServer = http.createServer((req, res) => {
    if (req.url === '/jwks') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => jwksServer.listen(0, resolve));
  const port = jwksServer.address().port;

  process.env.OIDC_ISSUER = TEST_ISSUER;
  process.env.OIDC_AUDIENCE = TEST_AUDIENCE;
  process.env.OIDC_JWKS_URI = `http://localhost:${port}/jwks`;
  process.env.CORS_ORIGIN = 'http://localhost:3000';

  jest.isolateModules(() => {
    const { buildApp } = require('../src/index');
    app = buildApp();
  });
});

afterAll(async () => {
  if (jwksServer) await new Promise((r) => jwksServer.close(r));
});

describe('Endpointy niezabezpieczone', () => {
  test('GET /health zwraca 200 i status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Endpointy zabezpieczone - walidacja JWT', () => {
  test('GET /api/profile bez tokenu -> 401 + WWW-Authenticate', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/);
  });

  test('GET /api/tasks z popsutym tokenem -> 401', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  test('zle issuer w tokenie -> 401', async () => {
    const tok = await signToken({ sub: 'u1', scope: 'tasks.read' }, { iss: 'http://wrong-issuer' });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(401);
  });

  test('zla audience w tokenie -> 401', async () => {
    const tok = await signToken({ sub: 'u1', scope: 'tasks.read' }, { aud: 'wrong-audience' });
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(401);
  });
});

describe('RBAC - scope i role', () => {
  dbTest('GET /api/profile z waznym tokenem zwraca claims', async () => {
    const tok = await signToken({
      sub: '00000000-0000-0000-0000-000000000001',
      scope: 'openid profile email',
      roles: ['user'],
      name: 'Test User',
      email: 'test@example.com',
      preferred_username: 'tester',
    });
    const res = await request(app).get('/api/profile').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(res.body.roles).toEqual(['user']);
  });

  dbTest('GET /api/tasks bez scope tasks.read -> 403', async () => {
    const tok = await signToken({
      sub: '00000000-0000-0000-0000-000000000001',
      scope: 'openid',
      roles: ['user'],
    });
    const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  dbTest('GET /api/admin/users bez roli admin -> 403', async () => {
    const tok = await signToken({
      sub: '00000000-0000-0000-0000-000000000001',
      scope: 'tasks.read tasks.write',
      roles: ['user'],
    });
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  dbTest('GET /api/admin/users z rola admin -> 200', async () => {
    const tok = await signToken({
      sub: '00000000-0000-0000-0000-0000000000aa',
      scope: 'tasks.read',
      roles: ['admin', 'user'],
      name: 'Admin User',
      email: 'admin@example.com',
      preferred_username: 'admin',
    });
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  dbTest('full CRUD - POST + GET + PUT + DELETE wlasnego task', async () => {
    const sub = '00000000-0000-0000-0000-0000000000bb';
    const tok = await signToken({
      sub,
      scope: 'tasks.read tasks.write',
      roles: ['user'],
      name: 'Crud User',
      email: 'crud@example.com',
      preferred_username: 'crud',
    });
    const auth = { Authorization: `Bearer ${tok}` };

    const created = await request(app).post('/api/tasks').set(auth).send({
      title: 'Demo zadanie', description: 'opis', priority: 'high',
    });
    expect(created.status).toBe(201);
    const id = created.body.task.id;

    const list = await request(app).get('/api/tasks').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.tasks.find((t) => t.id === id)).toBeDefined();

    const updated = await request(app).put(`/api/tasks/${id}`).set(auth).send({ status: 'done' });
    expect(updated.status).toBe(200);
    expect(updated.body.task.status).toBe('done');

    const del = await request(app).delete(`/api/tasks/${id}`).set(auth);
    expect(del.status).toBe(204);
  });
});
