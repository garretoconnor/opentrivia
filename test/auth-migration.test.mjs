import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../api.mjs';
import { createGame } from '../core.mjs';
import { D1 } from './support/d1.mjs';
import { enrollmentSQL } from '../scripts/enroll-legacy-account.mjs';

test('Better Auth migration preserves user IDs, games, votes, plays and daily history; enrolled owners recover access', async () => {
  const DB = new D1({ through: 5 }), id = crypto.randomUUID(), gameID = crypto.randomUUID();
  const sqlite = DB.sqlite;
  sqlite.prepare('INSERT INTO accounts (id, username, name, password_hash, recovery_hash) VALUES (?, ?, ?, ?, ?)').run(id, 'legacy', 'Legacy', 'legacy-password-hash', 'legacy-recovery-hash');
  sqlite.prepare('INSERT INTO games (id, title, difficulty, game_json, account_id) VALUES (?, ?, ?, ?, ?)').run(gameID, 'Existing game', 'medium', JSON.stringify(createGame()), id);
  sqlite.prepare('INSERT INTO account_games (id, account_id, title, game_json, published_id) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), id, 'Draft', JSON.stringify(createGame()), gameID);
  sqlite.prepare('INSERT INTO daily_players (id, name, account_id) VALUES (?, ?, ?)').run(id, 'Legacy', id);
  sqlite.exec(`INSERT INTO daily_seasons VALUES ('season', 'Season', '2026-09-01', '2026-12-01');
    INSERT INTO daily_questions (id, clue, answer) VALUES ('q', 'Q', 'A');
    INSERT INTO daily_challenges VALUES ('2026-10-13', 'season', 'q', '', '', 'Q', 'A', '[]', '');`);
  sqlite.prepare('INSERT INTO daily_attempts VALUES (?, ?, ?, ?, ?, ?)').run('2026-10-13', id, 'A', 1, '2026-10-13T12:00:00Z', 1000);
  sqlite.prepare('INSERT INTO plays (id, game_id) VALUES (?, ?)').run(crypto.randomUUID(), gameID);
  sqlite.prepare('INSERT INTO votes (game_id, voter_id, value) VALUES (?, ?, ?)').run(gameID, 'voter', 1);
  sqlite.exec(readFileSync(new URL('../migrations/0006_better_auth.sql', import.meta.url), 'utf8'));
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  for (const table of ['games', 'account_games', 'daily_attempts', 'plays', 'votes']) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1);
  assert.equal(sqlite.prepare('SELECT id, email FROM auth_users').get().id, id);
  assert.equal(sqlite.prepare('SELECT email FROM auth_users').get().email, null);
  assert.equal(sqlite.prepare('SELECT password_hash FROM legacy_auth_credentials').get().password_hash, 'legacy-password-hash');
  const mails = [];
  const env = { DB, BETTER_AUTH_SECRET: 'migration-test-only-secret-012345678901234567890', BETTER_AUTH_URL: 'https://example.test', AUTH_EMAIL_FROM: 'accounts@example.test', AUTH_EMAIL: { send: async message => { mails.push(message); } } };
  async function call(path, body, cookie = '') {
    return handleApi(new Request(path.startsWith('https:') ? path : `https://example.test/api${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, origin: 'https://example.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.55' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  }
  assert.equal((await (await call('/account', undefined, 'opentrivia_session=old-cookie')).json()).account, null);
  sqlite.exec(enrollmentSQL({ id, email: 'legacy@example.test' }));
  await call('/auth/request-password-reset', { email: 'legacy@example.test', redirectTo: 'https://example.test/?auth=reset' });
  const link = mails.at(-1).text.match(/https:\/\/\S+/)[0];
  const token = new URL((await call(link)).headers.get('location')).searchParams.get('token');
  assert.equal((await call('/auth/reset-password', { token, newPassword: 'new legacy owner passphrase' })).status, 200);
  await call('/auth/send-verification-email', { email: 'legacy@example.test', callbackURL: 'https://example.test/?auth=verified' });
  assert.equal((await call(mails.at(-1).text.match(/https:\/\/\S+/)[0])).status, 302);
  const login = await call('/auth/sign-in/username', { username: 'legacy', password: 'new legacy owner passphrase' });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await (await call('/account', undefined, cookie)).json()).account.id, id);
  const games = await (await call('/account/games', undefined, cookie)).json();
  assert.equal(games.games[0].title, 'Draft');
  assert.equal(sqlite.prepare('SELECT player_id FROM daily_attempts').get().player_id, id);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});
