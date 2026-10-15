import { createGame, normalizeGame } from '../core.mjs?v=0.10.5';
import { api } from './data.js?v=0.10.5';
import { $, escapeHtml, switchView, toast } from './render.js?v=0.10.5';
import { configurePersistence, loadGuestGame, localLibrary, state, STORAGE_KEY } from './state.js?v=0.10.5';

let context = null;
let debounce;
let renderStudio = () => {};
let changed = () => {};
let authBusy = false;
let accountReady = false;
let browserPlan = null;
let reviewBusy = false;
const cacheKey = id => `opentrivia.account.${id}.draft`;
function status(message, error = false) {
  const node = $('#save-status');
  node.textContent = message; node.dataset.error = String(error);
  $('#cloud-retry').hidden = !context?.pending || Boolean(context?.conflict);
  $('#cloud-conflict').hidden = !context?.conflict;
}
function cache(ctx) {
  try { localStorage.setItem(cacheKey(ctx.owner), JSON.stringify({ id: ctx.id, revision: ctx.revision, data: ctx.data, saved: ctx.saved, pending: ctx.pending })); return true; }
  catch { return false; }
}
function newContext(data, info = {}) {
  const serialized = JSON.stringify(data);
  return { owner: state.account.id, id: info.id || crypto.randomUUID(), revision: info.revision || 0, data: serialized,
    saved: info.saved ?? (info.revision ? serialized : null), pending: info.pending ?? !info.revision, conflict: false, flight: null };
}
function refreshStatus() {
  if (!state.account) { status('Saved on this device'); return; }
  if (!context) { status('Create a game or open one from My Games'); return; }
  if (context.conflict) status('Cloud version changed — your edits are kept on this device', true);
  else if (context.flight) status('Saving…');
  else if (context.pending) status('Saved on this device — cloud sync pending', true);
  else status('Saved to your account');
}
function setWorkingGame(data, ctx) {
  const editingAuthored = state.currentView === 'studio' || state.game === state.authoredGame && !['play', 'setup', 'host', 'join'].includes(state.currentView);
  state.authoredGame = normalizeGame(data); state.selectedBoard = 0;
  if (editingAuthored) state.game = state.authoredGame;
  context = ctx;
  if (editingAuthored) renderStudio();
  refreshStatus();
}
function persist(game) {
  if (!accountReady) { status('Checking account — please wait before editing', true); return false; }
  if (!state.account) return null;
  if (!context) context = newContext(game);
  context.data = JSON.stringify(game);
  context.pending = context.data !== context.saved;
  const local = cache(context);
  status(local ? 'Saved on this device — cloud sync pending' : 'Saving to your account… device backup unavailable', !local);
  clearTimeout(debounce);
  debounce = setTimeout(() => flushCloud().catch(() => {}), 700);
  return true;
}
export async function flushCloud() {
  clearTimeout(debounce);
  const ctx = context;
  if (!ctx || !state.account) return true;
  if (ctx.flight) return ctx.flight;
  if (ctx.conflict) { refreshStatus(); return false; }
  if (!ctx.pending) { refreshStatus(); return true; }
  ctx.flight = (async () => {
    try {
      while (ctx.pending && state.account?.id === ctx.owner) {
        const data = ctx.data;
        const response = await api(`/api/account/games/${ctx.id}`, { method: 'PUT', body: JSON.stringify({ game: JSON.parse(data), revision: ctx.revision }) });
        ctx.revision = response.game.revision; ctx.saved = data; ctx.pending = ctx.data !== data; cache(ctx);
      }
      if (context === ctx && !ctx.pending) $('#cloud-error').textContent = '';
      return !ctx.pending;
    } catch (error) {
      ctx.pending = true; ctx.conflict = error.status === 409; cache(ctx);
      if (context === ctx) $('#cloud-error').textContent = error.message;
      return false;
    } finally { ctx.flight = null; if (context === ctx) refreshStatus(); }
  })();
  refreshStatus();
  return ctx.flight;
}
export function activeCloudGame() { return context ? { id: context.id, revision: context.revision } : null; }
export async function publishCloudGame() {
  if (!await flushCloud()) throw new Error('Your changes have not synced. Retry saving before publishing.');
  if (!context) throw new Error('Save this game to your account before publishing.');
  return api(`/api/account/games/${context.id}/publish`, { method: 'POST', body: JSON.stringify({ revision: context.revision }) });
}
async function attachAccount(account, review = true) {
  clearTimeout(debounce);
  state.account = account; context = null;
  browserPlan = null;
  $('#browser-data-review').close();
  $('#review-browser-data').hidden = true;
  if (account) {
    let cached;
    try { cached = JSON.parse(localStorage.getItem(cacheKey(account.id))); } catch { /* Start with My Games. */ }
    if (cached?.data) {
      try {
        let data = normalizeGame(JSON.parse(cached.data)), info = cached;
        if (!cached.pending && cached.revision) {
          try { const latest = await api(`/api/account/games/${cached.id}`); data = normalizeGame(latest.game.data); info = latest.game; }
          catch { /* Cached copy remains available; revision checks protect the next save. */ }
        }
        setWorkingGame(data, newContext(data, info)); cache(context);
      } catch { setWorkingGame(createGame(), null); }
    } else setWorkingGame(createGame(), null);
  } else setWorkingGame(loadGuestGame(), null);
  $('#account-nav-label').textContent = account ? account.name : 'Log in';
  $('#account-button').setAttribute('aria-label', account ? `Profile: ${account.name}` : 'Log in');
  $('#account-button').title = account ? account.name : 'Log in';
  $('#account-initials').textContent = account ? account.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() : '';
  $('#account-initials').hidden = !account;
  $('#account-guest-icon').hidden = Boolean(account);
  if (account) $('#account-title').textContent = 'Your profile';
  $('#account-signed-out').hidden = Boolean(account);
  $('#account-signed-in').hidden = !account;
  $('#account-label').textContent = account ? account.name : '';
  $('#my-games-panel').hidden = !account;
  $('#studio-storage-help').textContent = account ? 'Changes save automatically to your account. Drafts stay private until you publish.' : 'Changes save automatically on this device. Sign in to save games to your account.';
  $('#cloud-error').textContent = '';
  changed();
  if (account) {
    if (context?.pending) await flushCloud();
    await loadMyGames();
    if (review) await reviewBrowserData();
  }
}
export async function loadMyGames() {
  if (!state.account) return;
  const owner = state.account.id;
  $('#my-games-status').textContent = 'Loading your games…';
  try {
    const response = await api('/api/account/games');
    if (state.account?.id !== owner) return;
    $('#my-games-status').textContent = response.games.length ? 'Private drafts and your published games.' : 'Create a game to save it to your account.';
    $('#my-games-list').replaceChildren(...response.games.map(game => {
      const item = document.createElement('article'); item.className = 'cloud-game';
      item.innerHTML = `<div><h3>${escapeHtml(game.title)}</h3><p>${game.published_id ? 'Published · edits stay private until republished' : 'Private draft'}</p></div><button class="button secondary" type="button">Edit game</button>`;
      item.querySelector('button').addEventListener('click', () => openGame(game.id));
      return item;
    }));
  } catch (error) { $('#my-games-status').textContent = error.message; }
}
async function openGame(id, discard = false) {
  if (!discard && !await flushCloud()) { toast('Sync your changes or save them as a new game before opening another game.', true); return; }
  try {
    const owner = state.account?.id;
    const response = await api(`/api/account/games/${id}`);
    if (owner !== state.account?.id) return;
    const data = normalizeGame(response.game.data);
    setWorkingGame(data, newContext(data, response.game)); cache(context); switchView('studio');
    $('#cloud-error').textContent = '';
  } catch (error) { toast(error.message, true); }
}
async function createNew() {
  if (!await flushCloud()) { toast('Sync your changes or save them as a new game first.', true); return; }
  setWorkingGame(createGame(), null); switchView('studio');
  persist(state.game); await flushCloud(); await loadMyGames();
}
async function reviewBrowserData() {
  const owner = state.account?.id;
  if (!owner) return;
  try {
    const drafts = [];
    let unreadable = 0;
    const add = (key, value) => {
      try { drafts.push({ key, game: normalizeGame(value) }); }
      catch { unreadable++; }
    };
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('opentrivia.game.v0.1');
      if (saved) { try { add('draft', JSON.parse(saved)); } catch { unreadable++; } }
      for (const entry of localLibrary()) add(entry.id, entry.game);
    } catch { unreadable++; }
    const [daily, cloud] = await Promise.all([api('/api/daily/claim'), drafts.length ? api('/api/account/games') : Promise.resolve({ games: [] })]);
    const existing = await Promise.all(cloud.games.map(game => api(`/api/account/games/${game.id}`)));
    const seen = new Set(existing.map(item => JSON.stringify(normalizeGame(item.game.data))));
    const ids = new Set(cloud.games.map(game => game.id));
    const pending = [];
    for (const draft of drafts) {
      const data = JSON.stringify(draft.game);
      const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${owner}:${draft.key}:${data}`));
      const suffix = [...new Uint8Array(fingerprint)].map(n => n.toString(16).padStart(2, '0')).join('');
      const id = `${suffix.slice(0,8)}-${suffix.slice(8,12)}-${suffix.slice(12,16)}-${suffix.slice(16,20)}-${suffix.slice(20,32)}`;
      // Keep the original import ID scheme so previously imported, edited drafts remain recognized.
      if (seen.has(data) || ids.has(id)) continue;
      seen.add(data); pending.push({ ...draft, id });
    }
    if (state.account?.id !== owner) return;
    browserPlan = { owner, drafts: pending, daily };
    $('#review-browser-data').textContent = 'Review this browser’s history';
    const available = pending.length > 0 || daily.days > 0;
    $('#review-browser-data').hidden = !available && !unreadable;
    $('#browser-data-error').textContent = unreadable ? 'Some local data could not be read. It remains on this device.' : '';
    if (!available) {
      if (unreadable) $('#account-error').textContent = 'Some local data could not be read. It remains on this device.';
      return;
    }
    $('#browser-data-summary').textContent = `Review what will be added to ${state.account.name}. Identical games already in your account are skipped. Local originals stay on this device; other games become separate private drafts.`;
    $('#browser-data-games').replaceChildren(...pending.map(draft => {
      const item = document.createElement('li'); item.textContent = draft.game.name; return item;
    }));
    $('#browser-data-daily').textContent = daily.days ? `${daily.days} guest daily sessions: ${daily.answers - daily.overlappingAnswers} answers to add. ${daily.overlappingAnswers} existing account answers will be kept. Times for ${daily.overlappingDays} overlapping days will be voided. Guest history will move to this account.` : 'No guest daily history to add.';
    $('#browser-data-confirm').disabled = false;
    $('#browser-data-review').showModal();
  } catch (error) {
    if (state.account?.id !== owner) return;
    browserPlan = null;
    $('#review-browser-data').hidden = false;
    $('#review-browser-data').textContent = 'Retry checking this browser’s history';
    $('#account-error').textContent = `Could not check browser history: ${error.message}`;
  }
}
async function confirmBrowserData() {
  const plan = browserPlan;
  if (reviewBusy || !plan || state.account?.id !== plan.owner) return;
  reviewBusy = true;
  $('#browser-data-confirm').disabled = true;
  $('#browser-data-later').disabled = true;
  try {
    if (!await flushCloud()) throw new Error('Sync the current game before importing.');
    for (const draft of plan.drafts) {
      if (state.account?.id !== plan.owner) throw new Error('Your account changed. Review the history again.');
      try { await api(`/api/account/games/${draft.id}`, { method: 'PUT', body: JSON.stringify({ game: draft.game, revision: 0 }) }); }
      catch (error) {
        if (error.status !== 409) throw error;
        // A response may have been lost after a successful import. Never overwrite a cloud draft.
        await api(`/api/account/games/${draft.id}`);
      }
    }
    if (state.account?.id !== plan.owner) throw new Error('Your account changed. Review the history again.');
    if (plan.daily.days) await api('/api/daily/claim', { method: 'POST', body: '{}' });
    browserPlan = null;
    $('#browser-data-review').close();
    $('#review-browser-data').hidden = true;
    await loadMyGames(); changed(); toast('Browser history added to your account.');
  } catch (error) {
    $('#browser-data-error').textContent = `${error.message} You can retry safely; completed imports will not be duplicated.`;
  } finally {
    reviewBusy = false;
    $('#browser-data-confirm').disabled = false;
    $('#browser-data-later').disabled = false;
  }
}
export async function initAccounts(dependencies) {
  renderStudio = dependencies.renderStudio; changed = dependencies.changed;
  configurePersistence(persist);
  $('#studio-view').inert = true;
  $('#account-button').addEventListener('click', async () => {
    if (state.currentView === 'host') {
      await dependencies.closeHostedRoom?.({ quiet: true });
      if (state.hostedRoom) return;
    }
    if (!state.account && !resetToken) setMode('login');
    $('#account-title').textContent = state.account && !resetToken ? 'Your profile' : $('#account-title').textContent;
    $('#account-error').textContent = ''; switchView('profile');
    $('#account-title').focus?.();
    if (!state.account && !resetToken) $('#account-email').focus?.();
  });
  let resetToken = '', accountMode = 'login';
  const appOrigin = () => window.location?.origin || '';
  function setMode(mode) {
    accountMode = mode;
    const signup = mode === 'signup', login = mode === 'login', resetting = mode === 'reset';
    $('#account-title').textContent = { login: 'Sign in', signup: 'Create your account', recover: 'Reset your password', resend: 'Verify your email', reset: 'Choose a new password' }[mode];
    $('#account-intro').textContent = {
      login: 'Welcome back. Your games and daily results are waiting.',
      signup: 'Save your games and daily results across devices.',
      recover: 'Enter your email and we’ll send you a password-reset link.',
      resend: 'Enter your email and we’ll send you a new verification link.',
      reset: 'Choose a new password to secure your account.',
    }[mode];
    $('#account-name-field').hidden = !signup; $('#account-name').required = signup;
    $('#account-email-field').hidden = resetting; $('#account-email').required = !resetting;
    $('#account-password-field').hidden = !signup && !login && !resetting;
    $('#account-password').required = signup || login || resetting;
    $('#account-password').minLength = login ? 1 : 15;
    $('#account-password').autocomplete = login ? 'current-password' : 'new-password';
    $('#account-password-help').hidden = login;
    $('#account-forgot').hidden = !login;
    $('#account-confirm-field').hidden = !resetting; $('#account-confirm').required = resetting;
    $('#account-signup-prompt').hidden = !login;
    $('#account-login-prompt').hidden = login;
    $('#account-login-copy').textContent = signup ? 'Already have an account?' : 'Back to';
    $('#account-resend-prompt').hidden = !login;
    $('#account-submit').textContent = { login: 'Sign in', signup: 'Create account', recover: 'Send reset link', resend: 'Send verification link', reset: 'Set new password' }[mode];
    $('#account-password').value = ''; $('#account-confirm').value = '';
    $('#account-error').textContent = ''; $('#account-message').textContent = '';
  }
  for (const [id, mode] of [['signup', 'signup'], ['login', 'login'], ['recover', 'recover'], ['resend', 'resend']]) {
    $(`#account-${id}-link`).addEventListener('click', () => {
      if (authBusy) return;
      resetToken = ''; setMode(mode);
      $('#account-email').focus?.();
    });
  }
  setMode('login');
  $('#account-form').addEventListener('submit', async event => {
    event.preventDefault(); if (authBusy) return; authBusy = true;
    $('#account-submit').disabled = true; $('#account-error').textContent = ''; $('#account-message').textContent = '';
    try {
      const mode = accountMode, password = $('#account-password').value;
      const email = $('#account-email').value.trim();
      if (mode === 'signup') {
        await api('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ email, name: $('#account-name').value.trim(), password, callbackURL: `${appOrigin()}/?auth=verified` }) });
        setMode('login'); $('#account-message').textContent = 'Check your email to verify your account, then sign in. Use “Resend verification email” if you need another link.';
      } else if (mode === 'recover' || mode === 'resend') {
        await api(`/api/auth/${mode === 'recover' ? 'request-password-reset' : 'send-verification-email'}`, { method: 'POST', body: JSON.stringify({ email, ...(mode === 'recover' ? { redirectTo: `${appOrigin()}/?auth=reset` } : { callbackURL: `${appOrigin()}/?auth=verified` }) }) });
        $('#account-message').textContent = 'If that email is eligible, a link has been sent. Check your inbox.';
      } else if (mode === 'reset') {
        if (!resetToken) throw new Error('Open a valid password-reset link from your email.');
        if (password !== $('#account-confirm').value) throw new Error('The passwords do not match.');
        await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, newPassword: password }) });
        resetToken = '';
        const refreshed = await api('/api/account'); await attachAccount(refreshed.account);
        setMode('login'); $('#account-message').textContent = 'Password reset. Sign in with your new password. Other sessions have been signed out.';
      } else {
        await api('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
        const response = await api('/api/account');
        if (!response.account) throw new Error('Verify your email before signing in.');
        accountReady = true; $('#studio-view').inert = false; await attachAccount(response.account);
        $('#account-title').focus?.();
      }
      $('#account-password').value = ''; $('#account-confirm').value = '';
    } catch (error) { $('#account-error').textContent = error.message; }
    finally { authBusy = false; $('#account-submit').disabled = false; }
  });
  $('#account-logout').addEventListener('click', async () => {
    try {
      if (!await flushCloud()) throw new Error('Your changes have not synced. Retry or export your game before signing out.');
      await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
      await attachAccount(null); setMode('login');
    } catch (error) { $('#account-error').textContent = error.message; }
  });
  const callback = new URLSearchParams(window.location?.search || '');
  if (callback.has('auth')) {
    resetToken = callback.get('auth') === 'reset' ? callback.get('token') || '' : '';
    setMode(resetToken ? 'reset' : 'login');
    if (callback.has('error') || callback.get('auth') === 'reset' && !resetToken) $('#account-error').textContent = 'This email link is invalid or expired. Request a new link.';
    else if (!resetToken) $('#account-message').textContent = 'Email verified. Sign in to continue.';
    window.history?.replaceState({}, '', window.location.pathname);
    switchView('profile');
  }
  $('#review-browser-data').addEventListener('click', reviewBrowserData);
  $('#browser-data-confirm').addEventListener('click', confirmBrowserData);
  $('#browser-data-later').addEventListener('click', () => $('#browser-data-review').close());
  $('#browser-data-review').addEventListener('cancel', event => { if (reviewBusy) event.preventDefault(); });
  $('#new-cloud-game').addEventListener('click', () => createNew().catch(error => toast(error.message, true)));
  $('#refresh-my-games').addEventListener('click', loadMyGames);
  $('#cloud-retry').addEventListener('click', () => flushCloud());
  $('#cloud-copy').addEventListener('click', async () => {
    if (!context || context.flight) return;
    context = newContext(JSON.parse(context.data)); cache(context);
    await flushCloud(); await loadMyGames();
  });
  $('#cloud-reload').addEventListener('click', () => {
    if (context && window.confirm('Discard this device’s pending edits and open the latest cloud version? You can choose Save as new game to keep both versions instead.')) openGame(context.id, true);
  });
  document.addEventListener('opentrivia:view', () => { if (state.currentView === 'library' && state.account) loadMyGames(); });
  window.addEventListener('online', () => flushCloud());
  window.addEventListener('beforeunload', event => { if (context?.pending) { event.preventDefault(); event.returnValue = ''; } });
  try {
    const response = await api('/api/account');
    accountReady = true; $('#studio-view').inert = false; await attachAccount(response.account, !resetToken);
    if (resetToken) { setMode('reset'); $('#account-signed-out').hidden = false; $('#account-signed-in').hidden = true; }
  } catch (error) {
    // Never treat an unavailable session lookup as an authenticated account or silently save its edits as guest data.
    accountReady = [404, 501, 503].includes(error.status);
    if (accountReady) { $('#studio-view').inert = false; await attachAccount(null); }
    else { $('#account-error').textContent = 'Could not check your account. Reload when the connection returns.'; status('Account unavailable — reload to reconnect', true); }
  }
}
