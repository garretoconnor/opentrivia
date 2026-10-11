import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleDaily, triviaDay, nextRollover, calendarSeason } from '../daily.mjs';

class D1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(readFileSync(new URL('../migrations/0001_v0_2.sql', import.meta.url), 'utf8'));
    this.db.exec(readFileSync(new URL('../migrations/0002_daily_trivia.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    };
  }
}
function setup() {
  const DB = new D1();
  // Synthetic fixtures only; no questions are shipped in the bank.
  for (let i = 1; i <= 4; i++) DB.db.prepare(`INSERT INTO daily_questions
    (id, prompt, answer, accepted_answers, explanation, enabled, queue_order) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(`q${i}`, `Test prompt ${i}`, 'Test answer', '["Alias"]', 'Test explanation', i);
  let time = Date.parse('2026-10-11T12:00:00Z');
  return { DB, setTime: value => { time = Date.parse(value); },
    async call(path = '', body, cookie) {
      return handleDaily(new Request(`https://example.test/api/daily${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), { DB }, () => time);
    },
  };
}
async function player(context, name) {
  const response = await context.call('/player', { name });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('fixed EST rollover is 07:00 UTC in winter and summer', () => {
  for (const date of ['2026-01-11', '2026-07-11']) {
    assert.equal(triviaDay(Date.parse(`${date}T06:59:59.999Z`)), date.replace('11', '10'));
    assert.equal(triviaDay(Date.parse(`${date}T07:00:00Z`)), date);
    assert.equal(nextRollover(Date.parse(`${date}T06:59:59Z`)), `${date}T07:00:00.000Z`);
  }
});
test('shared question is stable, secret before answering, and snapshotted from bank', async () => {
  const c = setup();
  const responses = await Promise.all(Array.from({ length: 8 }, () => c.call().then(r => r.json())));
  assert.ok(responses.every(r => r.question.prompt === 'Test prompt 1'));
  assert.equal(c.DB.db.prepare('SELECT COUNT(*) AS n FROM daily_challenges').get().n, 1);
  assert.equal(JSON.stringify(responses).includes('Test answer'), false);
  assert.equal(JSON.stringify(responses).includes('Alias'), false);
  c.DB.db.exec("UPDATE daily_questions SET prompt = 'Changed', answer = 'Changed' WHERE id = 'q1'");
  const cookie = await player(c, 'Ada');
  const response = await c.call('/answer', { day: '2026-10-11', answer: '  ALIAS  ', points: 999 }, cookie);
  assert.equal((await response.json()).result.points, 1);
  const state = await (await c.call('', undefined, cookie)).json();
  assert.equal(state.question.prompt, 'Test prompt 1');
  assert.equal(state.result.correct_answer, 'Test answer');
  assert.equal(state.leaderboards.daily[0].points, 1);
  assert.equal(JSON.stringify(state.leaderboards).includes(cookie.split('=')[1]), false);
});
test('concurrent attempts only score once and reload restores result', async () => {
  const c = setup();
  const cookie = await player(c, 'Ada');
  const attempts = await Promise.all(['wrong', 'Test answer'].map(answer => c.call('/answer', { day: '2026-10-11', answer }, cookie).then(r => r.json())));
  assert.ok(attempts.every(a => a.result.points === 0));
  assert.equal(attempts.filter(a => a.already_submitted).length, 1);
  assert.equal(c.DB.db.prepare('SELECT COUNT(*) AS n FROM daily_attempts').get().n, 1);
  const state = await (await c.call('', undefined, cookie)).json();
  assert.equal(state.result.submitted_answer, 'wrong');
});
test('rollover rejects stale answer and season totals include only current season', async () => {
  const c = setup();
  const cookie = await player(c, 'Ada');
  await c.call('/answer', { day: '2026-10-11', answer: 'Test answer' }, cookie);
  c.setTime('2026-10-12T07:00:00Z');
  assert.equal((await c.call('/answer', { day: '2026-10-11', answer: 'Test answer' }, cookie)).status, 409);
  let state = await (await c.call('', undefined, cookie)).json();
  assert.equal(state.question.prompt, 'Test prompt 2');
  assert.equal(state.result, null);
  assert.equal(state.leaderboards.daily.length, 0);
  assert.equal(state.leaderboards.season[0].points, 1);
  await c.call('/answer', { day: '2026-10-12', answer: 'Test answer' }, cookie);
  state = await (await c.call()).json();
  assert.equal(state.leaderboards.season[0].points, 2);
  c.setTime('2026-12-01T07:00:00Z');
  state = await (await c.call()).json();
  assert.equal(state.season.id, 'winter-2026');
  assert.equal(state.leaderboards.season.length, 0);
});
test('ties share rank, identities persist on rename, and validation rejects invalid input', async () => {
  const c = setup();
  for (const name of ['Ada', 'Bo']) {
    const cookie = await player(c, name);
    await c.call('/answer', { day: '2026-10-11', answer: 'Test answer' }, cookie);
    if (name === 'Ada') {
      await c.call('/player', { name: 'Adele' }, cookie);
      const state = await (await c.call('', undefined, cookie)).json();
      assert.equal(state.result.points, 1);
    }
  }
  const state = await (await c.call()).json();
  assert.deepEqual(state.leaderboards.daily.map(r => r.rank), [1, 1]);
  assert.equal((await c.call('/player', { name: ' ' })).status, 400);
  assert.equal((await c.call('/player', null)).status, 400);
  assert.equal((await c.call('/answer', { day: '2026-10-11', answer: 'Test answer' })).status, 401);
  const cookie = await player(c, 'Cy');
  assert.equal((await c.call('/answer', { day: '2026-10-11', answer: ' ' }, cookie)).status, 400);
  assert.equal((await c.call('/answer', { day: '2026-10-11', answer: 'x'.repeat(301) }, cookie)).status, 400);
});
test('empty bank has an explicit empty state; seasons start automatically and drafts stay private', async () => {
  const c = setup();
  c.DB.db.exec('UPDATE daily_questions SET enabled = 0');
  let state = await (await c.call()).json();
  assert.equal(state.question, null);
  assert.match(state.unavailable_reason, /bank/);
  c.setTime('2027-01-01T07:00:00Z');
  state = await (await c.call()).json();
  assert.equal(state.season.name, 'Winter 2026–2027');
  assert.match(state.unavailable_reason, /bank/);
  assert.throws(() => c.DB.db.exec("INSERT INTO daily_seasons VALUES ('bad', 'Overlap', '2026-06-01', '2026-12-01')"), /overlap/);
});
test('exhaustion does not reuse questions, and new bank content resumes the same day', async () => {
  const c = setup();
  for (let day = 11; day <= 14; day++) {
    c.setTime(`2026-10-${day}T07:00:00Z`);
    assert.ok((await (await c.call()).json()).question);
  }
  c.setTime('2026-10-15T07:00:00Z');
  assert.equal((await (await c.call()).json()).question, null);
  c.DB.db.exec("INSERT INTO daily_questions (id, prompt, answer, enabled) VALUES ('new', 'New fixture', 'Fixture', 1)");
  assert.equal((await (await c.call()).json()).question.prompt, 'New fixture');
});

test('calendar seasons cover all months, year boundaries, and leap days', () => {
  const expected = ['winter-2025', 'winter-2025', 'spring-2026', 'spring-2026', 'spring-2026',
    'summer-2026', 'summer-2026', 'summer-2026', 'fall-2026', 'fall-2026', 'fall-2026', 'winter-2026'];
  expected.forEach((id, index) => assert.equal(calendarSeason(`2026-${String(index + 1).padStart(2, '0')}-01`).id, id));
  assert.deepEqual(calendarSeason('2028-02-29'), {
    id: 'winter-2027', name: 'Winter 2027–2028', starts_on: '2027-12-01', ends_on: '2028-03-01',
  });
});
test('each seasonal boundary switches at the daily rollover and creates one season', async () => {
  for (const [date, before, after] of [
    ['2026-03-01', 'winter-2025', 'spring-2026'],
    ['2026-06-01', 'spring-2026', 'summer-2026'],
    ['2026-09-01', 'summer-2026', 'fall-2026'],
    ['2026-12-01', 'fall-2026', 'winter-2026'],
  ]) {
    const c = setup();
    c.setTime(`${date}T06:59:59.999Z`);
    assert.equal((await (await c.call()).json()).season.id, before);
    c.setTime(`${date}T07:00:00Z`);
    const states = await Promise.all(Array.from({ length: 5 }, () => c.call().then(r => r.json())));
    assert.ok(states.every(state => state.season.id === after));
    assert.equal(c.DB.db.prepare('SELECT COUNT(*) AS n FROM daily_seasons').get().n, 2);
  }
});
test('winter totals continue through January and February, and reset in March', async () => {
  const c = setup();
  const cookie = await player(c, 'Ada');
  for (const day of ['2027-12-01', '2028-01-01', '2028-02-29']) {
    c.setTime(`${day}T07:00:00Z`);
    await c.call('/answer', { day, answer: 'Test answer' }, cookie);
  }
  let state = await (await c.call()).json();
  assert.equal(state.season.id, 'winter-2027');
  assert.equal(state.leaderboards.season[0].points, 3);
  c.setTime('2028-03-01T07:00:00Z');
  state = await (await c.call()).json();
  assert.equal(state.season.id, 'spring-2028');
  assert.equal(state.leaderboards.season.length, 0);
});
