import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../core.mjs';
class Element {
  listeners = {}; hidden = false; value = ''; textContent = ''; dataset = {}; children = [];
  classList = { toggle() {} };
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {}, currentTarget: this }); }
  replaceChildren(...children) { this.children = children; }
  remove() {}
  setAttribute() {} removeAttribute() {} append(node) { this.children.push(node); }
  querySelector() { return new Element(); } showModal() {} close() {}
}
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { const timer = schedule(fn, ms); timer.unref(); return timer; };
const nodes = new Map();
const get = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
const storage = new Map(); let storageFails = false;
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (storageFails) throw new Error('Full'); storage.set(key, value); } };
globalThis.document = Object.assign(new Element(), { querySelector: get, querySelectorAll: () => [], getElementById: id => get(`#${id}`), createElement: () => new Element(), dispatchEvent() {} });
globalThis.window = Object.assign(new Element(), { scrollTo() {}, confirm: () => true });
const { state, saveGame, STORAGE_KEY } = await import('../modules/state.js?v=0.10.0');
const { initAccounts, flushCloud } = await import('../modules/accounts.js?v=0.10.0');
const account = { id: 'alice-id', name: 'Alice' };
let server, calls, fail, hold, currentAccount;
async function reset(cached, options = {}) {
  window.location = { origin: 'https://example.test', pathname: '/', search: options.search || '' };
  window.history = { replaceState(_state, _title, url) { window.location.search = ''; window.cleanedURL = url; } };
  storageFails = false; storage.clear(); server = new Map(); calls = []; fail = null; hold = null; currentAccount = options.signedOut ? null : account;
  for (const node of nodes.values()) node.listeners = {};
  storage.set(STORAGE_KEY, JSON.stringify({ ...createGame(), name: 'Guest draft' }));
  if (cached) {
    const id = crypto.randomUUID(), data = JSON.stringify({ ...createGame(), name: 'Cached edits' });
    storage.set('opentrivia.account.alice-id.draft', JSON.stringify({ id, revision: 1, data, saved: cached === 'pending' ? 'old' : data, pending: cached === 'pending' }));
    server.set(id, { game: { ...JSON.parse(data), name: cached === 'pending' ? 'Server original' : 'Cached edits' }, revision: 1 });
  }
  globalThis.fetch = async (path, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ path, body, options });
    if (path === '/api/account') return Response.json({ account: currentAccount });
    if (path.startsWith('/api/auth/')) {
      if (path.includes('/sign-in/')) currentAccount = account;
      if (['/api/auth/sign-out', '/api/auth/reset-password'].includes(path)) currentAccount = null;
      return Response.json({ user: currentAccount, status: true });
    }
    if (path === '/api/auth/sign-out') { currentAccount = null; return Response.json({ account: null }); }
    if (path === '/api/account/games') return Response.json({ games: [] });
    const id = path.split('/').pop(), existing = server.get(id);
    if (options.method === 'PUT') {
      if (hold) await hold;
      if (fail) return Response.json({ error: 'Save failed' }, { status: fail });
      if (body.revision !== (existing?.revision || 0)) return Response.json({ error: 'Conflict' }, { status: 409 });
      const revision = body.revision + 1;
      server.set(id, { game: body.game, revision }); return Response.json({ game: { id, revision } });
    }
    return existing ? Response.json({ game: { id, revision: existing.revision, data: existing.game } }) : Response.json({ error: 'Missing' }, { status: 404 });
  };
  await initAccounts({ renderStudio() {}, changed() {} });
}
test('signed-in autosave survives repeated saves, keeps guest data separate, and sends expected account', async () => {
  await reset();
  state.game.name = 'First edit'; saveGame(); assert.equal(await flushCloud(), true);
  assert.equal(get('#save-status').textContent, 'Saved to your account');
  assert.equal(await flushCloud(), true); // A no-op flush must not leave a resolved flight blocking future edits.
  state.game.name = 'Second edit'; saveGame(); assert.equal(await flushCloud(), true);
  assert.equal([...server.values()][0].game.name, 'Second edit');
  assert.equal([...server.values()][0].revision, 2);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).name, 'Guest draft');
  assert.equal(calls.find(c => c.options.method === 'PUT').options.headers['x-opentrivia-account'], account.id);
});
test('edits during an in-flight save serialize and sync the latest snapshot', async () => {
  await reset(); let release;
  hold = new Promise(resolve => { release = resolve; });
  state.game.name = 'Before request'; saveGame(); const pending = flushCloud();
  state.game.name = 'During request'; saveGame(); release(); hold = null;
  assert.equal(await pending, true);
  assert.equal([...server.values()][0].game.name, 'During request');
  assert.equal([...server.values()][0].revision, 2);
});
test('network failure retains a pending backup, retry succeeds, and reload restores pending edits', async () => {
  await reset(); fail = 503;
  state.game.name = 'Offline edit'; saveGame(); assert.equal(await flushCloud(), false);
  const cached = JSON.parse(storage.get('opentrivia.account.alice-id.draft'));
  assert.equal(cached.pending, true); assert.equal(JSON.parse(cached.data).name, 'Offline edit');
  assert.match(get('#save-status').textContent, /cloud sync pending/);
  fail = null; assert.equal(await flushCloud(), true);
  assert.equal([...server.values()][0].game.name, 'Offline edit');
  await reset('pending');
  assert.equal([...server.values()][0].game.name, 'Cached edits');
  assert.equal(get('#save-status').textContent, 'Saved to your account');
});
test('conflicts preserve edits, stop automatic overwrites, and can save an independent copy', async () => {
  await reset(); fail = 409;
  state.game.name = 'My pending version'; saveGame(); assert.equal(await flushCloud(), false);
  const before = calls.filter(c => c.options.method === 'PUT').length;
  assert.equal(await flushCloud(), false);
  assert.equal(calls.filter(c => c.options.method === 'PUT').length, before);
  assert.equal(get('#cloud-conflict').hidden, false);
  assert.equal(JSON.parse(JSON.parse(storage.get('opentrivia.account.alice-id.draft')).data).name, 'My pending version');
  fail = null; await get('#cloud-copy').fire('click');
  assert.equal([...server.values()][0].game.name, 'My pending version');
  assert.equal(get('#cloud-conflict').hidden, true);
});
test('cloud saving works when device storage is full and logout restores the guest draft', async () => {
  await reset(); storageFails = true;
  state.game.name = 'Cloud without device storage'; assert.equal(saveGame(), true); assert.equal(await flushCloud(), true);
  assert.equal([...server.values()][0].game.name, 'Cloud without device storage');
  storageFails = false;
  await get('#account-logout').fire('click');
  assert.equal(state.account, null); assert.equal(state.game.name, 'Guest draft');
  state.game.name = 'Guest edit'; saveGame(); assert.equal(JSON.parse(storage.get(STORAGE_KEY)).name, 'Guest edit');
});

test('local draft imports are idempotent even if the local import marker is lost', async () => {
  await reset();
  await get('#import-local-games').fire('click');
  assert.equal(server.size, 1); assert.equal([...server.values()][0].game.name, 'Guest draft');
  for (const key of storage.keys()) if (key.startsWith('opentrivia.import.')) storage.delete(key);
  await get('#import-local-games').fire('click');
  assert.equal(server.size, 1);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).name, 'Guest draft');
});
test('signing out does not replace a game being played', async () => {
  await reset(); state.currentView = 'play';
  const playing = state.game;
  await get('#account-logout').fire('click');
  assert.equal(state.game, playing); assert.equal(state.authoredGame.name, 'Guest draft');
  state.currentView = 'library';
});

test('signup uses Better Auth email endpoints and prompts verification without attaching an unverified account', async () => {
  await reset(undefined, { signedOut: true });
  await get('#account-signup-link').fire('click');
  assert.equal(get('#account-email').required, true); assert.equal(get('#account-name').required, true);
  get('#account-email').value = 'alice@example.test';
  get('#account-name').value = 'Alice'; get('#account-password').value = 'test fixture passphrase';
  await get('#account-form').fire('submit');
  const request = calls.find(c => c.path === '/api/auth/sign-up/email');
  assert.equal(request.body.email, 'alice@example.test'); assert.equal('username' in request.body, false); assert.equal(request.body.callbackURL, 'https://example.test/?auth=verified');
  assert.equal(state.account, null); assert.match(get('#account-message').textContent, /verify your account/);
  assert.equal(get('#account-title').textContent, 'Sign in'); assert.equal(get('#account-password').value, '');
});
test('login supports email, recovery and resend use email, and auth state attaches only after session resolution', async () => {
  await reset(undefined, { signedOut: true });
  await get('#account-recover-link').fire('click');
  assert.equal(get('#account-password').required, false); assert.equal(get('#account-email').required, true);
  get('#account-email').value = 'alice@example.test'; await get('#account-form').fire('submit');
  assert.equal(calls.find(c => c.path === '/api/auth/request-password-reset').body.redirectTo, 'https://example.test/?auth=reset');
  assert.match(get('#account-message').textContent, /If that email is eligible/);
  await get('#account-login-link').fire('click'); await get('#account-resend-link').fire('click'); await get('#account-form').fire('submit');
  assert.ok(calls.some(c => c.path === '/api/auth/send-verification-email'));
  await get('#account-login-link').fire('click');
  get('#account-email').value = 'alice@example.test'; get('#account-password').value = 'test fixture passphrase';
  await get('#account-form').fire('submit');
  assert.ok(calls.some(c => c.path === '/api/auth/sign-in/email')); assert.equal(state.account.id, account.id);
});
test('password reset callback scrubs tokens from the URL, validates confirmation and submits to Better Auth', async () => {
  await reset(undefined, { signedOut: true, search: '?auth=reset&token=synthetic-reset-token' });
  assert.equal(get('#account-title').textContent, 'Choose a new password'); assert.equal(window.cleanedURL, '/');
  get('#account-password').value = 'new fixture passphrase'; get('#account-confirm').value = 'mismatch';
  await get('#account-form').fire('submit'); assert.match(get('#account-error').textContent, /do not match/);
  assert.equal(calls.some(c => c.path === '/api/auth/reset-password'), false);
  get('#account-confirm').value = 'new fixture passphrase'; await get('#account-form').fire('submit');
  assert.deepEqual(calls.find(c => c.path === '/api/auth/reset-password').body, { token: 'synthetic-reset-token', newPassword: 'new fixture passphrase' });
  assert.equal(get('#account-title').textContent, 'Sign in'); assert.match(get('#account-message').textContent, /Other sessions/);
});

test('reset link remains usable when this browser already has a session, then refreshes revoked auth state', async () => {
  await reset(undefined, { search: '?auth=reset&token=synthetic-reset-token' });
  assert.equal(get('#account-signed-out').hidden, false); assert.equal(get('#account-signed-in').hidden, true);
  get('#account-password').value = 'new fixture passphrase'; get('#account-confirm').value = 'new fixture passphrase';
  await get('#account-form').fire('submit');
  assert.equal(state.account, null); assert.equal(get('#account-title').textContent, 'Sign in');
});
