import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/server/api.mjs';
import { handleDaily } from '../src/server/daily.mjs';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_v0_2.sql', '0002_daily_trivia.sql', '0003_consistent_question_content.sql', '0004_daily_timing.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const DB = { prepare(sql) {
    const statement = db.prepare(sql);
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
  } };
  const env = { DB, ADMIN_TOKEN: 'test-only-admin-key' };
  return { db, env, async call(method = 'GET', body, headers = { authorization: `Bearer ${env.ADMIN_TOKEN}` }) {
    return handleApi(new Request('https://example.test/api/admin/questions', { method, headers,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env);
  } };
}
const question = (overrides = {}) => ({ id: crypto.randomUUID(), topic: 'Test topic', clue: 'Test question?',
  answer: 'Test answer', accepted_answers: ['Alternative'], image: 'https://example.test/image.png',
  explanation: 'Test explanation', enabled: true, queue_order: 10, ...overrides });

test('admin bank is closed without configuration or a valid key', async () => {
  const c = setup();
  for (const method of ['GET', 'POST', 'PATCH']) {
    for (const headers of [{}, { authorization: 'Bearer wrong-key' }]) {
      const response = await c.call(method, method === 'GET' ? undefined : question(), headers);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  c.env.ADMIN_TOKEN = '';
  assert.equal((await c.call()).status, 503);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM daily_questions').get().n, 0);
});

test('create validates content and rejects cross-origin writes', async () => {
  const c = setup();
  for (const overrides of [{ clue: ' ' }, { answer: 'x'.repeat(301) }, { accepted_answers: 'wrong' },
    { accepted_answers: [123] }, { enabled: 1 }, { queue_order: 1.5 }, { image: 'javascript:alert(1)' },
    { id: 'invalid' }, { explanation: 'x'.repeat(2001) }, { topic: 1 }]) {
    assert.equal((await c.call('POST', question(overrides))).status, 400, JSON.stringify(overrides));
  }
  assert.equal((await c.call('POST', 'invalid-json')).status, 400);
  assert.equal((await c.call('POST', 'x'.repeat(20001))).status, 413);
  assert.equal((await c.call('POST', question(), { authorization: `Bearer ${c.env.ADMIN_TOKEN}`, origin: 'https://other.test' })).status, 403);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM daily_questions').get().n, 0);
});

test('added questions enter the daily queue and answers remain private', async () => {
  const c = setup();
  const draft = question({ enabled: false, queue_order: -10 });
  const ready = question({ clue: 'Ready question?', answer: "O'Brien", accepted_answers: ['Alias', ' Alias '] });
  assert.equal((await c.call('POST', draft)).status, 201);
  assert.equal((await c.call('POST', ready)).status, 201);
  assert.equal((await c.call('POST', ready)).status, 200);
  assert.equal((await c.call('POST', { ...ready, answer: 'Changed' })).status, 409);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM daily_questions').get().n, 2);
  const stored = c.db.prepare('SELECT * FROM daily_questions WHERE id = ?').get(ready.id);
  assert.equal(stored.answer, "O'Brien");
  assert.deepEqual(JSON.parse(stored.accepted_answers), ['Alias']);
  let bank = await (await c.call()).json();
  assert.deepEqual(bank.counts, { total: 2, drafts: 1, ready: 1, used: 0 });
  const daily = await handleDaily(new Request('https://example.test/api/daily'), c.env, () => Date.parse('2026-10-13T12:00:00Z'));
  const state = await daily.json();
  assert.deepEqual(state.question, { topic: ready.topic });
  assert.equal(c.db.prepare('SELECT clue FROM daily_challenges').get().clue, ready.clue);
  assert.equal(JSON.stringify(state).includes(ready.answer), false);
  assert.equal(JSON.stringify(state).includes('Alias'), false);
  assert.equal((await c.call('PATCH', { id: ready.id, enabled: false })).status, 409);
  assert.equal((await c.call('PATCH', { id: draft.id, enabled: true })).status, 200);
  bank = await (await c.call()).json();
  assert.deepEqual(bank.counts, { total: 2, drafts: 0, ready: 1, used: 1 });
  assert.equal(bank.questions.find(q => q.id === ready.id).used_on, '2026-10-13');
  const tomorrow = await handleDaily(new Request('https://example.test/api/daily'), c.env, () => Date.parse('2026-10-14T12:00:00Z'));
  assert.deepEqual((await tomorrow.json()).question, { topic: draft.topic });
  assert.equal(c.db.prepare("SELECT clue FROM daily_challenges WHERE day = '2026-10-14'").get().clue, draft.clue);
});
