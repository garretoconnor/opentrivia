import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../api.mjs';
import { createGame } from '../core.mjs';
import { D1 } from './support/d1.mjs';
const password = 'a long test passphrase';
function setup() {
  const DB = new D1(), mails = [];
  const env = { DB, BETTER_AUTH_SECRET: 'test-only-better-auth-secret-01234567890123456789', BETTER_AUTH_URL: 'https://example.test',
    AUTH_EMAIL_FROM: 'accounts@example.test', AUTH_EMAIL: { async send(message) { mails.push(message); return { messageId: 'fixture' }; } } };
  return { DB, env, mails,
    async call(path, body, cookie = '', method = body === undefined ? 'GET' : 'POST', headers = {}) {
      return handleApi(new Request(path.startsWith('https:') ? path : `https://example.test/api${path}`, { method,
        headers: { cookie, origin: 'https://example.test', 'cf-connecting-ip': '192.0.2.1', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    },
    async signup(username) {
      const email = `${username}@example.test`;
      const response = await this.call('/auth/sign-up/email', { username, email, password, name: username, callbackURL: 'https://example.test/?auth=verified' });
      assert.equal(response.status, 200, await response.clone().text());
      const link = mails.at(-1).text.match(/https:\/\/\S+/)[0];
      assert.equal((await this.call(link)).status, 302);
      const login = await this.call('/auth/sign-in/username', { username, password });
      assert.equal(login.status, 200, await login.clone().text());
      const cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
      const account = (await (await this.call('/account', undefined, cookie)).json()).account;
      return { account, cookie, email };
    },
  };
}
function completeGame(name = 'Private fixture') {
  const game = createGame(); game.name = name;
  for (const board of game.boards) for (const col of board.columns) for (const clue of col.clues) { clue.clue = 'Question'; clue.answer = 'Answer'; }
  return game;
}
test('Better Auth signup requires email verification, supports username/email login, expiry and logout', async () => {
  const c = setup();
  const pending = await c.call('/auth/sign-up/email', { username: 'pending', email: 'pending@example.test', password, name: 'Pending' });
  assert.equal(pending.status, 200); assert.equal((await pending.json()).token, null);
  assert.equal((await c.call('/auth/sign-in/username', { username: 'pending', password })).status, 403);
  const ada = await c.signup('ada');
  const stored = c.DB.sqlite.prepare('SELECT password FROM auth_credentials WHERE userId = ?').get(ada.account.id);
  assert.ok(stored.password); assert.equal(stored.password.includes(password), false);
  const login = await c.call('/auth/sign-in/email', { email: ada.email, password });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/i); assert.match(login.headers.get('set-cookie'), /Secure/i);
  const second = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  await c.call('/auth/sign-out', {}, ada.cookie);
  assert.equal((await (await c.call('/account', undefined, ada.cookie)).json()).account, null);
  assert.equal((await (await c.call('/account', undefined, second)).json()).account.id, ada.account.id);
  c.DB.sqlite.exec('UPDATE auth_sessions SET expiresAt = 0');
  assert.equal((await (await c.call('/account', undefined, second)).json()).account, null);
  assert.equal((await c.call('/account/games', undefined, second)).status, 401);
  for (const route of ['signup', 'login', 'recover', 'logout']) assert.equal((await c.call(`/account/${route}`, {})).status, 410);
});
test('Better Auth validates credentials, persists throttles, and rejects cross-site mutations', async () => {
  const c = setup();
  assert.equal((await c.call('/auth/sign-up/email', { username: 'ada', email: 'ada@example.test', password: 'short', name: 'Ada' })).status, 400);
  assert.equal((await c.call('/auth/sign-up/email', { username: 'ada', email: 'ada@example.test', password, name: 'Ada' }, '', 'POST', { origin: 'https://evil.test' })).status, 403);
  assert.equal((await c.call('/auth/sign-up/email', { username: 'ada', email: 'ada@example.test', password, name: 'Ada' }, '', 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  const ada = await c.signup('ada');
  for (const username of ['ada', 'missing']) assert.equal((await c.call('/auth/sign-in/username', { username, password: 'incorrect passphrase' })).status, 401);
  c.DB.sqlite.exec('UPDATE auth_rate_limits SET count = 100');
  assert.equal((await c.call('/auth/sign-in/username', { username: 'ada', password })).status, 429);
  assert.equal((await (await c.call('/account', undefined, ada.cookie)).json()).account.id, ada.account.id);
});
test('Better Auth email reset tokens are one-use and revoke all old sessions', async () => {
  const c = setup(), ada = await c.signup('ada');
  const login = await c.call('/auth/sign-in/username', { username: 'ada', password });
  const second = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  const requested = await c.call('/auth/request-password-reset', { email: ada.email, redirectTo: 'https://example.test/?auth=reset' });
  assert.equal(requested.status, 200);
  const link = c.mails.at(-1).text.match(/https:\/\/\S+/)[0];
  const redirect = await c.call(link);
  const token = new URL(redirect.headers.get('location')).searchParams.get('token');
  const body = { token, newPassword: 'the replacement passphrase' };
  assert.equal((await c.call('/auth/reset-password', body)).status, 200);
  assert.equal((await c.call('/auth/reset-password', body)).status, 400);
  for (const cookie of [ada.cookie, second]) assert.equal((await (await c.call('/account', undefined, cookie)).json()).account, null);
  assert.equal((await c.call('/auth/sign-in/username', { username: 'ada', password })).status, 401);
  assert.equal((await c.call('/auth/sign-in/username', { username: 'ada', password: body.newPassword })).status, 200);
});
test('private games persist across sessions, enforce ownership and detect concurrent edits', async () => {
  const c = setup(), ada = await c.signup('ada'), bo = await c.signup('bob');
  const id = crypto.randomUUID(), game = completeGame();
  assert.equal((await c.call(`/account/games/${crypto.randomUUID()}`, { game, revision: 0 }, bo.cookie, 'PUT', { 'x-opentrivia-account': ada.account.id })).status, 409);
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 0 }, ada.cookie, 'PUT')).status, 200);
  assert.deepEqual((await (await c.call('/games')).json()).games, []);
  assert.deepEqual((await (await c.call('/account/games', undefined, bo.cookie)).json()).games, []);
  assert.equal((await c.call(`/account/games/${id}`, undefined, bo.cookie)).status, 404);
  assert.equal((await c.call(`/account/games/${id}/publish`, { revision: 1 }, bo.cookie)).status, 404);
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 1 }, bo.cookie, 'PUT')).status, 409);
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 0 }, bo.cookie, 'PUT')).status, 409);
  game.name = 'Updated';
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 1 }, ada.cookie, 'PUT')).status, 200);
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 1 }, ada.cookie, 'PUT')).status, 409);
  const login = await c.call('/auth/sign-in/username', { username: 'ada', password });
  const second = login.headers.get('set-cookie').split(';')[0];
  const opened = await (await c.call(`/account/games/${id}`, undefined, second)).json();
  assert.equal(opened.game.data.name, 'Updated'); assert.equal(opened.game.revision, 2);
  assert.equal((await c.call(`/account/games/${id}`, { game, revision: 2 }, ada.cookie, 'PUT', { origin: 'https://evil.test' })).status, 403);
  const attempts = await Promise.all(['First', 'Second'].map(name => c.call(`/account/games/${id}`, { game: { ...game, name }, revision: 2 }, ada.cookie, 'PUT')));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
});
test('publication is explicit, validates completeness, updates one public copy and keeps later edits private', async () => {
  const c = setup(), ada = await c.signup('ada'), id = crypto.randomUUID();
  await c.call(`/account/games/${id}`, { game: createGame(), revision: 0 }, ada.cookie, 'PUT');
  assert.equal((await c.call(`/account/games/${id}/publish`, { revision: 1 }, ada.cookie)).status, 400);
  const game = completeGame();
  await c.call(`/account/games/${id}`, { game, revision: 1 }, ada.cookie, 'PUT');
  assert.equal((await c.call(`/account/games/${id}/publish`, { revision: 1 }, ada.cookie)).status, 409);
  const first = await (await c.call(`/account/games/${id}/publish`, { revision: 2 }, ada.cookie)).json();
  game.name = 'Private revision';
  await c.call(`/account/games/${id}`, { game, revision: 2 }, ada.cookie, 'PUT');
  assert.equal((await (await c.call(`/games/${first.game.id}`)).json()).game.title, 'Private fixture');
  const second = await (await c.call(`/account/games/${id}/publish`, { revision: 3 }, ada.cookie)).json();
  assert.equal(second.game.id, first.game.id);
  assert.equal((await (await c.call('/games')).json()).games.length, 1);
  assert.equal((await (await c.call(`/games/${first.game.id}`)).json()).game.title, 'Private revision');
});
function bank(c) {
  c.DB.sqlite.exec("INSERT INTO daily_questions (id, clue, answer, enabled) VALUES ('q1', 'Fixture question', 'Answer', 1)");
}
async function guestAttempt(c, answer = 'Answer') {
  const initial = await (await c.call('/daily')).json();
  const start = await c.call('/daily/start', { day: initial.day });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  await c.call('/daily/answer', { day: initial.day, answer, name: 'Guest' }, cookie);
  return { cookie, day: initial.day };
}
test('daily results follow accounts across devices; forged guest IDs cannot access account scores', async () => {
  const c = setup(), ada = await c.signup('ada'); bank(c);
  const initial = await (await c.call('/daily', undefined, ada.cookie)).json();
  await c.call('/daily/start', { day: initial.day }, ada.cookie);
  const answer = await c.call('/daily/answer', { day: initial.day, answer: 'Answer', name: 'Imposter' }, ada.cookie);
  assert.equal((await answer.json()).result.points, 1);
  const login = await c.call('/auth/sign-in/username', { username: 'ada', password });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const next = await (await c.call('/daily', undefined, cookie)).json();
  assert.equal(next.result.points, 1); assert.equal(next.account, true); assert.equal(next.player.name, 'ada');
  const second = await (await c.call('/daily/answer', { day: initial.day, answer: 'wrong' }, cookie)).json();
  assert.equal(second.already_submitted, true); assert.equal(second.result.points, 1);
  assert.equal((await c.call('/daily/start', { day: initial.day }, ada.cookie, 'POST', { 'x-opentrivia-account': 'guest' })).status, 409);
  const forged = `opentrivia_daily=${ada.account.id}`;
  assert.equal((await (await c.call('/daily', undefined, forged)).json()).result, null);
  assert.equal((await c.call('/daily/void', { day: initial.day }, forged)).status, 401);
  assert.equal((await c.call('/daily/player', { name: 'Bad' }, ada.cookie)).status, 409);
});
test('claim transfers guest history once, preserves timing, and retires old cookies', async () => {
  const c = setup(); bank(c); const guest = await guestAttempt(c);
  const ada = await c.signup('ada'), bo = await c.signup('bob');
  const before = await (await c.call('/daily', undefined, guest.cookie)).json();
  const claimed = await c.call('/daily/claim', {}, `${ada.cookie}; ${guest.cookie}`);
  assert.equal((await claimed.json()).claimed, true);
  const next = await (await c.call('/daily', undefined, ada.cookie)).json();
  assert.deepEqual(next.result, before.result);
  assert.equal((await (await c.call('/daily', undefined, guest.cookie)).json()).result, null);
  assert.equal((await (await c.call('/daily/claim', {}, `${bo.cookie}; ${guest.cookie}`)).json()).claimed, false);
  assert.equal((await (await c.call('/daily', undefined, bo.cookie)).json()).result, null);
  assert.equal(next.leaderboards.daily.length, 1);
  assert.deepEqual(c.DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});
test('overlapping account and guest runs keep the account answer and void the merged time', async () => {
  const c = setup(); bank(c); const guest = await guestAttempt(c);
  const ada = await c.signup('ada');
  await c.call('/daily/start', { day: guest.day }, ada.cookie);
  await c.call('/daily/answer', { day: guest.day, answer: 'wrong' }, ada.cookie);
  await c.call('/daily/claim', {}, `${ada.cookie}; ${guest.cookie}`);
  const result = await (await c.call('/daily', undefined, ada.cookie)).json();
  assert.equal(result.result.points, 0); assert.equal(result.result.submitted_answer, 'wrong'); assert.equal(result.result.completion_ms, null);
  assert.equal(result.run.voided, true);
});

test('email configuration failures stop signup before creating an account, and mail uses the Cloudflare binding', async () => {
  const c = setup(); delete c.env.AUTH_EMAIL;
  const response = await c.call('/auth/sign-up/email', { username: 'ada', email: 'ada@example.test', password, name: 'Ada' });
  assert.equal(response.status, 503);
  assert.equal(c.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n, 0);
  assert.equal((await c.call('/auth/request-password-reset', { email: 'unknown@example.test' })).status, 503);
  c.env.AUTH_EMAIL = { send: async message => { c.mails.push(message); return { messageId: 'test-only' }; } };
  await c.signup('alice');
  assert.deepEqual(c.mails[0].from, { email: c.env.AUTH_EMAIL_FROM, name: 'OpenTrivia' });
  assert.equal(c.mails[0].to, 'alice@example.test');
  assert.match(c.mails[0].subject, /Verify/);
});
test('sign-in identity throttles span IP addresses and stale tabs cannot sign out another account', async () => {
  const c = setup(), ada = await c.signup('ada'), bob = await c.signup('bob');
  assert.equal((await c.call('/auth/sign-out', {}, bob.cookie, 'POST', { 'x-opentrivia-account': ada.account.id })).status, 409);
  assert.equal((await (await c.call('/account', undefined, bob.cookie)).json()).account.id, bob.account.id);
  c.DB.sqlite.exec("UPDATE auth_rate_limits SET count = 15 WHERE key LIKE 'identity:%'");
  for (const ip of ['192.0.2.22', '192.0.2.23']) assert.equal((await c.call('/auth/sign-in/username', { username: 'ada', password }, '', 'POST', { 'cf-connecting-ip': ip })).status, 429);
});
test('a shared account session provisions exactly one daily identity under simultaneous requests', async () => {
  const c = setup(), ada = await c.signup('ada');
  c.DB.sqlite.prepare('DELETE FROM daily_players WHERE account_id = ?').run(ada.account.id);
  const responses = await Promise.all(Array.from({ length: 6 }, () => c.call('/account', undefined, ada.cookie)));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(c.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_players WHERE account_id = ?').get(ada.account.id).n, 1);
});
