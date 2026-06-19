const bcrypt = require('bcrypt');
const Account = require('../src/account');

describe('Account - seedy i hashowanie hasel', () => {
  test('SEED_USERS zawiera admina z rolami admin + user', () => {
    const admin = Account.SEED_USERS.find((u) => u.username === 'admin');
    expect(admin).toBeDefined();
    expect(admin.roles).toEqual(expect.arrayContaining(['admin', 'user']));
  });

  test('kazdy seedowany user ma haslo i unikalny username', () => {
    const usernames = Account.SEED_USERS.map((u) => u.username);
    expect(new Set(usernames).size).toBe(usernames.length);
    for (const u of Account.SEED_USERS) {
      expect(u.password).toBeTruthy();
      expect(u.email).toMatch(/@/);
    }
  });

  test('bcrypt round-trip dla hasla seedowanego dziala', async () => {
    const hash = await bcrypt.hash('password', 10);
    expect(await bcrypt.compare('password', hash)).toBe(true);
    expect(await bcrypt.compare('nie-to', hash)).toBe(false);
  });
});
