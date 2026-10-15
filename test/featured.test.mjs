import test from 'node:test';
import assert from 'node:assert/strict';
import { D1 } from './support/d1.mjs';
import { handleApi } from '../api.mjs';
import { createGame } from '../core.mjs';

test('featured selection is admin-only, ordered, validated, and can be cleared', async () => {
  const env = { DB: new D1(), ADMIN_TOKEN: 'test-key' };
  const call = (path, method = 'GET', body, authorized = false) => handleApi(new Request(`https://example.test${path}`, {
    method, headers: authorized ? { authorization: 'Bearer test-key' } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [i, id] of ids.entries()) await env.DB.prepare('INSERT INTO games (id, title, hero_image, difficulty, game_json) VALUES (?, ?, ?, ?, ?)').bind(id, `Game ${i}`, '', 'easy', JSON.stringify(createGame())).run();
  assert.equal((await call('/api/admin/featured', 'PUT', { ids })).status, 401);
  assert.equal((await call('/api/admin/featured', 'PUT', { ids: [ids[0], ids[0]] }, true)).status, 400);
  assert.equal((await call('/api/admin/featured', 'PUT', { ids: [crypto.randomUUID()] }, true)).status, 409);
  assert.equal((await call('/api/admin/featured', 'PUT', { ids: [...ids].reverse() }, true)).status, 200);
  assert.deepEqual((await (await call('/api/featured')).json()).ids, [...ids].reverse());
  assert.equal((await (await call('/api/admin/featured', 'GET', undefined, true)).json()).games.length, 2);
  await call('/api/admin/featured', 'PUT', { ids: [] }, true);
  assert.deepEqual((await (await call('/api/featured')).json()).ids, []);
});

test('public cards expose usernames only for non-anonymous games', async () => {
  const env = { DB: new D1() };
  await env.DB.prepare('INSERT INTO auth_users (id, name, email, emailVerified, createdAt, updatedAt, username) VALUES (?, ?, ?, 1, 0, 0, ?)').bind('creator', 'alexwarren', 'alex@example.test', 'alexwarren').run();
  for (const anonymous of [false, true]) {
    const game = { ...createGame(), anonymous };
    await env.DB.prepare('INSERT INTO games (id, title, hero_image, difficulty, game_json, account_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), String(anonymous), '', 'easy', JSON.stringify(game), 'creator').run();
  }
  const response = await handleApi(new Request('https://example.test/api/games'), env);
  assert.equal(response.status, 200);
  const { games } = await response.json();
  assert.equal(games.find(game => game.title === 'false').creator_username, 'alexwarren');
  assert.equal(games.find(game => game.title === 'true').creator_username, null);
});
