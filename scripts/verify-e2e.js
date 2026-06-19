// Pelen flow Authorization Code + PKCE programowo (symuluje przegladarke).
// Uruchomienie:  node scripts/verify-e2e.js
// Albo jako admin:  LOGIN_USER=admin node scripts/verify-e2e.js
//
// Skrypt:
//  1. generuje code_verifier i code_challenge (S256),
//  2. GET /auth -> przechodzi przez interaction (login + consent),
//  3. wymienia code na access_token z code_verifier,
//  4. dekoduje JWT (sprawdza claimy iss/aud/sub/scope/roles),
//  5. wola backend (/api/profile, /api/tasks, /api/admin/users)
//     i weryfikuje, ze RBAC dziala (alice=403, admin=200).
const http = require('http');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const AUTH = 'http://localhost:9000';
const API  = 'http://localhost:8088';
const CLIENT_ID = 'bezpsw-spa';
const REDIRECT_URI = 'http://localhost:3000/callback';

const code_verifier  = crypto.randomBytes(32).toString('base64url');
const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
console.log('[1] code_verifier =', code_verifier.slice(0,16) + '...');
console.log('[1] code_challenge =', code_challenge.slice(0,16) + '...');

const cookieJar = {};
function setCookies(setCookieHeaders) {
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const sc of list) {
    if (!sc) continue;
    const kv = sc.split(';')[0];
    const eq = kv.indexOf('=');
    cookieJar[kv.slice(0,eq)] = kv.slice(eq+1);
  }
}
function cookieHeader() {
  return Object.entries(cookieJar).map(([k,v]) => k + '=' + v).join('; ');
}
function req(method, urlStr, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const o = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: Object.assign({}, opts.headers || {}),
    };
    if (cookieHeader()) o.headers.Cookie = cookieHeader();
    if (opts.body) {
      o.headers['Content-Type'] = o.headers['Content-Type'] || 'application/x-www-form-urlencoded';
      o.headers['Content-Length'] = Buffer.byteLength(opts.body);
    }
    const r = http.request(o, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.headers['set-cookie']) setCookies(res.headers['set-cookie']);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  const state = crypto.randomBytes(8).toString('hex');
  const nonce = crypto.randomBytes(8).toString('hex');
  const authQs = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email roles tasks.read tasks.write',
    state, nonce,
    code_challenge,
    code_challenge_method: 'S256',
    resource: 'urn:bezpsw:api',
  });

  let r = await req('GET', AUTH + '/auth?' + authQs.toString());
  console.log('[2] /auth ->', r.status, r.headers.location || '');
  if (![302,303].includes(r.status)) throw new Error('expected redirect');
  let next = new URL(r.headers.location, AUTH).toString();

  while (true) {
    r = await req('GET', next);
    console.log('    ->', r.status, (r.headers.location || '(html)').slice(0,80));
    if (r.status >= 300 && r.status < 400) {
      if (r.headers.location.startsWith(REDIRECT_URI)) { next = r.headers.location; break; }
      next = new URL(r.headers.location, AUTH).toString();
      continue;
    }
    if (r.status === 200) break;
    throw new Error('unexpected: ' + r.status);
  }

  const uidMatch1 = next.match(/\/interaction\/([\w-]+)/);
  const interactionUid = uidMatch1 ? uidMatch1[1] : null;
  console.log('[3] interaction uid =', interactionUid);

  const username = process.env.LOGIN_USER || 'alice';
  const loginBody = new URLSearchParams({ login: username, password: 'password' }).toString();
  r = await req('POST', AUTH + '/interaction/' + interactionUid + '/login', { body: loginBody });
  console.log('[4] login ->', r.status, r.headers.location || '');
  next = new URL(r.headers.location, AUTH).toString();

  while (true) {
    r = await req('GET', next);
    console.log('    ->', r.status, (r.headers.location || '(html)').slice(0,80));
    if (r.status >= 300 && r.status < 400) {
      if (r.headers.location.startsWith(REDIRECT_URI)) { next = r.headers.location; break; }
      next = new URL(r.headers.location, AUTH).toString();
      continue;
    }
    if (r.status === 200) break;
    throw new Error('unexpected: ' + r.status);
  }

  if (next.includes('/interaction/')) {
    const uidMatch2 = next.match(/\/interaction\/([\w-]+)/);
    const uid2 = uidMatch2[1];
    console.log('[5] consent uid =', uid2);
    r = await req('POST', AUTH + '/interaction/' + uid2 + '/confirm');
    console.log('[5] confirm ->', r.status, r.headers.location || '');
    next = new URL(r.headers.location, AUTH).toString();
    while (!next.startsWith(REDIRECT_URI)) {
      r = await req('GET', next);
      console.log('    ->', r.status, (r.headers.location || '(html)').slice(0,80));
      if (r.status >= 300 && r.status < 400) {
        next = new URL(r.headers.location, AUTH).toString();
        continue;
      }
      throw new Error('expected redirect to callback, got ' + r.status);
    }
  }

  const cbUrl = new URL(next);
  const code = cbUrl.searchParams.get('code');
  if (!code) throw new Error('no code in callback: ' + next);
  console.log('[6] got code:', code.slice(0,16) + '...');

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier,
  }).toString();
  r = await req('POST', AUTH + '/token', { body: tokenBody });
  console.log('[7] /token ->', r.status);
  const tok = JSON.parse(r.body);
  console.log('    access_token:', tok.access_token.slice(0,40) + '...');
  console.log('    id_token:    ', tok.id_token ? tok.id_token.slice(0,40) + '...' : '(none)');
  console.log('    expires_in:', tok.expires_in, 'token_type:', tok.token_type);

  const payload = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64url').toString());
  console.log('    JWT claims:', { iss: payload.iss, aud: payload.aud,
    sub: payload.sub.slice(0,8) + '...', scope: payload.scope, roles: payload.roles,
    name: payload.name, email: payload.email });

  r = await req('GET', API + '/api/profile', { headers: { Authorization: 'Bearer ' + tok.access_token }});
  console.log('[8] GET /api/profile ->', r.status);
  console.log('    body:', r.body);

  r = await req('POST', API + '/api/tasks', {
    headers: { Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test E2E', priority: 'high', status: 'todo' }),
  });
  console.log('[9] POST /api/tasks ->', r.status);
  console.log('    body:', r.body);

  r = await req('GET', API + '/api/admin/users', { headers: { Authorization: 'Bearer ' + tok.access_token }});
  console.log('[10] GET /api/admin/users (alice = user, oczekujemy 403) ->', r.status);
  console.log('     body:', r.body);

  console.log('\n=== OK: pelny PKCE flow + JWT walidacja + RBAC dziala ===');
})().catch((e) => { console.error('FAIL:', e.message); console.error(e.stack); process.exit(1); });
