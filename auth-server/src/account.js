const bcrypt = require('bcrypt');
const { query } = require('./db');

// Konta seedowane na starcie. Hasla hashowane bcryptem (cost=10).
const SEED_USERS = [
  { username: 'alice', email: 'alice@example.com', name: 'Alice Allen',  password: 'password', roles: ['user'] },
  { username: 'bob',   email: 'bob@example.com',   name: 'Bob Brown',    password: 'password', roles: ['user'] },
  { username: 'admin', email: 'admin@example.com', name: 'Adam Admin',   password: 'password', roles: ['admin', 'user'] },
];

async function seedUsers() {
  for (const u of SEED_USERS) {
    const { rows } = await query('SELECT id FROM users WHERE username = $1', [u.username]);
    if (rows.length === 0) {
      const hash = await bcrypt.hash(u.password, 10);
      await query(
        `INSERT INTO users (username, email, name, password_hash, roles)
         VALUES ($1, $2, $3, $4, $5)`,
        [u.username, u.email, u.name, hash, u.roles],
      );
      console.log(`[auth-server] seeded user ${u.username} (${u.roles.join(',')})`);
    }
  }
}

async function getUserById(id) {
  const { rows } = await query(
    'SELECT id, username, email, name, roles FROM users WHERE id = $1',
    [id],
  );
  return rows[0];
}

async function getUserByUsername(username) {
  const { rows } = await query(
    'SELECT id, username, email, name, password_hash, roles FROM users WHERE username = $1',
    [username],
  );
  return rows[0];
}

async function authenticate(usernameOrEmail, password) {
  const { rows } = await query(
    `SELECT id, username, email, name, password_hash, roles
       FROM users
      WHERE username = $1 OR email = $1`,
    [usernameOrEmail],
  );
  const user = rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return user.id;
}

// Wymagane przez oidc-provider: zwraca obiekt konta z metoda claims().
async function findAccount(_ctx, id) {
  const user = await getUserById(id);
  if (!user) return undefined;
  return {
    accountId: id,
    async claims(_use, scope) {
      const scopes = (scope || '').split(' ').filter(Boolean);
      const result = { sub: id };
      if (scopes.includes('profile')) {
        result.name = user.name;
        result.preferred_username = user.username;
      }
      if (scopes.includes('email')) {
        result.email = user.email;
        result.email_verified = true;
      }
      if (scopes.includes('roles')) {
        result.roles = user.roles;
      }
      return result;
    },
  };
}

module.exports = {
  seedUsers,
  getUserById,
  getUserByUsername,
  authenticate,
  findAccount,
  SEED_USERS,
};
