import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
  value = '';
  hidden = false;
  textContent = '';
  listeners = {};
  children = [];
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type) {
    for (const fn of this.listeners[type] || []) await fn({ currentTarget: this, preventDefault() {} });
  }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
  removeAttribute(name) { delete this[name]; }
  querySelector() { return get('#daily-answer-form button'); }
  focus() { document.activeElement = this; }
}
const nodes = new Map();
const get = selector => {
  if (!nodes.has(selector)) nodes.set(selector, new Element());
  return nodes.get(selector);
};
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.document = Object.assign(new Element(), {
  querySelector: get, createElement: () => new Element(), hidden: false, hasFocus: () => true,
});
globalThis.window = new Element();
// Timers remain controllable without keeping the test process alive.
let timerId = 0;
const intervals = new Map();
globalThis.setInterval = fn => { intervals.set(++timerId, fn); return timerId; };
globalThis.clearInterval = id => intervals.delete(id);
globalThis.setTimeout = () => ++timerId;
globalThis.clearTimeout = () => {};
const { state } = await import('../modules/state.js?v=0.6.0');
state.currentView = 'daily';
const { initDaily, loadDaily } = await import('../modules/daily.js');
initDaily();
let server;
let answerBody;
let holdStart;
const requests = [];
function reset(day) {
  server = {
    day, server_time: `${day}T12:00:00Z`, rolls_over_at: `${day}T23:00:00Z`,
    season: { name: 'Fall' }, player: null, question: { topic: 'Space' }, run: null, result: null,
    leaderboards: { daily: [], season: [] },
  };
  document.hidden = false;
}
globalThis.fetch = async (path, options = {}) => {
  requests.push(path);
  const body = options.body && JSON.parse(options.body);
  if (path.endsWith('/start')) {
    server.run = { started_at: Date.parse(server.server_time), voided: false };
    server.player = { name: 'Player' };
    server.question = { topic: 'Space', clue: 'Which planet?', image: 'https://example.test/clue.png' };
    if (holdStart) await holdStart;
  }
  if (path.endsWith('/void')) server.run.voided = true;
  if (path.endsWith('/answer')) {
    answerBody = body;
    server.result = { points: 1, completion_ms: body.time_voided ? null : 2000, submitted_answer: body.answer, correct_answer: 'Saturn' };
    return Response.json({ result: server.result });
  }
  return Response.json(server);
};

test('daily UI gates clue and input behind Play and voids on tab, window, and page focus loss', async () => {
  for (const [day, surface, event] of [
    ['2026-10-11', document, 'visibilitychange'],
    ['2026-10-12', window, 'blur'],
    ['2026-10-13', window, 'pagehide'],
  ]) {
    reset(day);
    await loadDaily();
    assert.equal(get('#daily-topic').textContent, 'Space');
    assert.equal(get('#daily-play').hidden, false);
    assert.equal(get('#daily-question').hidden, true);
    assert.equal(get('#daily-question').textContent, '');
    assert.equal(get('#daily-image').hidden, true);
    assert.equal(get('#daily-answer-form').hidden, true);
    assert.equal(get('#daily-timer').hidden, true);
    await get('#daily-play').fire('click');
    assert.equal(get('#daily-play').hidden, true);
    assert.equal(get('#daily-question').textContent, 'Which planet?');
    assert.equal(get('#daily-image').hidden, false);
    assert.equal(get('#daily-answer-form').hidden, false);
    assert.equal(get('#daily-timer').hidden, false);
    assert.match(get('#daily-timer').textContent, /Time: /);
    assert.equal(document.activeElement, get('#daily-answer'));
    assert.equal(intervals.size, 1);
    if (surface === document) document.hidden = true;
    await surface.fire(event);
    assert.match(get('#daily-timer').textContent, /Time voided/);
    assert.equal(intervals.size, 0);
    assert.equal(storage.get(`opentrivia.daily.void.${day}`), '1');
    document.hidden = false;
    await loadDaily();
    assert.match(get('#daily-timer').textContent, /Time voided/);
    get('#daily-answer').value = 'Saturn';
    get('#daily-name').value = 'Ada';
    await get('#daily-answer-form').fire('submit');
    assert.equal(answerBody.time_voided, true);
    assert.equal(get('#daily-answer-form').hidden, true);
    assert.equal(get('#daily-timer').hidden, true);
    assert.equal(get('#daily-result').hidden, false);
    const voidCount = requests.filter(path => path.endsWith('/void')).length;
    await window.fire('blur');
    assert.equal(requests.filter(path => path.endsWith('/void')).length, voidCount);
  }
});

test('focus loss during the Play request voids the revealed run', async () => {
  reset('2026-10-14');
  await loadDaily();
  let release;
  holdStart = new Promise(resolve => { release = resolve; });
  const pending = get('#daily-play').fire('click');
  await window.fire('blur');
  release();
  await pending;
  holdStart = null;
  assert.equal(server.run.voided, true);
  assert.match(get('#daily-timer').textContent, /Time voided/);
});

test('reloading an unfinished run voids its time', async () => {
  reset('2026-10-15');
  server.run = { started_at: Date.parse(server.server_time), voided: false };
  server.player = { name: 'Ada' };
  server.question.clue = 'Resumed clue';
  const reloaded = await import('../modules/daily.js?reload-test');
  await reloaded.loadDaily();
  assert.equal(server.run.voided, true);
  assert.equal(get('#daily-question').textContent, 'Resumed clue');
  assert.match(get('#daily-timer').textContent, /Time voided/);
});
