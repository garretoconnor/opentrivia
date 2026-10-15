import { api } from './data.js?v=0.10.2';
import { $, escapeHtml, switchView } from './render.js?v=0.10.2';
import { state } from './state.js?v=0.10.2';
import { normalizeGame } from '../core.mjs?v=0.10.2';

let generation = 0, dependencies;
const profileURL = id => `#profile=${encodeURIComponent(id)}`;
const link = user => `<a href="${profileURL(user.id)}">${escapeHtml(user.name)}</a>`;
const privacyFields = { visibility: 'Profile', stats_visibility: 'Daily stats', games_visibility: 'Created games', friends_visibility: 'Friends list' };
const button = (label, action, id) => `<button class="button secondary" type="button" data-friend="${action}" data-user="${escapeHtml(id)}">${label}</button>`;

function avatar(p) {
  return p.picture ? `<img class="profile-portrait" src="${escapeHtml(p.picture)}" alt="${escapeHtml(p.name)}'s profile picture" />` : `<span class="profile-portrait profile-initials" aria-hidden="true">${escapeHtml(p.name.trim().split(/\s+/).slice(0,2).map(part => Array.from(part)[0]).join('').toUpperCase())}</span>`;
}
function render(p, mount) {
  const stats = p.stats ? `<dl class="profile-stats">${[
    [p.stats.streak, 'Day streak'], [p.stats.plays, 'Dailies played'], [p.stats.correct, 'Correct answers'], [p.stats.rank ? `#${p.stats.rank}` : 'Unranked', 'Season position'],
  ].map(([value, title]) => `<div><dt>${title}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="profile-note">${escapeHtml(p.stats.season || 'No active season')}. Streaks count consecutive trivia days (resetting at 07:00 UTC) with a submitted answer. Season ranks use average valid completion time.</p>` : '<p>Daily stats are private.</p>';
  let actions = '';
  if (!p.owner) {
    if (!state.account) actions = '<button class="button secondary" id="profile-login" type="button">Log in to add friends</button>';
    else if (p.relationship === 'incoming') actions = button('Accept request','PUT',p.id) + button('Decline','DELETE',p.id);
    else if (p.relationship === 'outgoing') actions = button('Cancel request','DELETE',p.id);
    else if (p.relationship === 'friends') actions = '<span>Friends</span>' + button('Remove friend','DELETE',p.id);
    else actions = button('Add friend','POST',p.id);
  }
  mount.innerHTML = `<div class="profile-identity">${avatar(p)}<div><h2>${escapeHtml(p.name)}</h2><a href="${profileURL(p.id)}">Public profile link</a></div></div>
    <p class="profile-bio">${escapeHtml(p.bio || 'No bio yet.')}</p><div class="account-actions">${actions}</div>
    <h2>Daily stats</h2>${stats}
    <h2>Created games</h2>${p.games === null ? '<p>Created games are private.</p>' : p.games.length ? `<ul class="profile-list">${p.games.map(game => `<li><span>${escapeHtml(game.title)}</span><button class="button secondary" type="button" data-profile-game="${escapeHtml(game.id)}">Play</button></li>`).join('')}</ul>` : '<p>No published games yet.</p>'}
    <h2>Friends</h2>${p.friends === null ? '<p>Friends list is private.</p>' : p.friends.length ? `<ul class="profile-list">${p.friends.map(user => `<li>${link(user)}${p.owner ? button('Remove','DELETE',user.id) : ''}</li>`).join('')}</ul>` : '<p>No friends to show yet.</p>'}
    ${p.owner ? `<h2>Friend requests</h2>${p.requests.length ? `<ul class="profile-list">${p.requests.map(user => `<li>${link(user)}<div class="account-actions">${user.direction === 'incoming' ? button('Accept','PUT',user.id) + button('Decline','DELETE',user.id) : button('Cancel request','DELETE',user.id)}</div></li>`).join('')}</ul>` : '<p>No pending requests.</p>'}
    <h2>Edit profile</h2><form id="profile-edit">
      <label>Profile picture<input type="file" id="profile-upload" accept="image/png,image/jpeg,image/webp" /></label>
      <img id="profile-upload-preview" class="profile-portrait" alt="Selected picture" ${p.picture ? `src="${escapeHtml(p.picture)}"` : 'hidden'} />
      <button class="button quiet" id="profile-remove-picture" type="button">Remove picture</button>
      <label>Bio<textarea id="profile-bio" rows="6" maxlength="2000" aria-describedby="bio-help">${escapeHtml(p.bio)}</textarea></label><p id="bio-help">Up to 2,000 characters.</p>
      <fieldset><legend>Privacy</legend>${Object.entries(privacyFields).map(([key,label]) => `<label>${label}<select name="${key}">${[['public','Public'],['friends','Friends only'],['private','Private']].map(([value,text]) => `<option value="${value}" ${p.privacy[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`).join('')}</fieldset>
      <p>Profile privacy controls access to the whole page. Section settings can restrict it further. Only published games appear here; these settings do not unpublish games from Explore. Your name and rank remain on daily leaderboards.</p>
      <button class="button primary" type="submit">Save profile</button>
    </form>` : ''}
    <h2>Find players</h2><form class="profile-search"><label>Search public profiles<input name="q" minlength="2" maxlength="80" required placeholder="Player name" /></label><button class="button secondary" type="submit">Search</button></form><div class="profile-search-results"></div>
    <p class="profile-feedback" role="status"></p>`;
  const feedback = mount.querySelector('.profile-feedback');
  const identity = state.account?.id;
  const current = () => state.account?.id === identity && mount.isConnected;
  mount.querySelectorAll('[data-friend]').forEach(node => node.addEventListener('click', async () => {
    node.disabled = true;
    try {
      await api(`/api/profiles/${encodeURIComponent(node.dataset.user)}/friend`, { method: node.dataset.friend, body: '{}' });
      if (current()) await load(p.id, mount);
    } catch (error) { if (current()) feedback.textContent = error.message; }
    finally { node.disabled = false; }
  }));
  mount.querySelector('#profile-login')?.addEventListener('click', () => $('#account-button').click());
  mount.querySelectorAll('[data-profile-game]').forEach(node => node.addEventListener('click', async () => {
    try {
      const response = await api(`/api/games/${node.dataset.profileGame}`);
      if (!current()) return;
      state.game = normalizeGame(response.game.data);
      dependencies.showSetup('library', node.dataset.profileGame);
    } catch (error) { feedback.textContent = error.message; }
  }));
  mount.querySelector('.profile-search').addEventListener('submit', async event => {
    event.preventDefault();
    const output = mount.querySelector('.profile-search-results');
    output.textContent = 'Searching…';
    try {
      const result = await api(`/api/profiles?q=${encodeURIComponent(new FormData(event.currentTarget).get('q'))}`);
      if (current()) output.innerHTML = result.profiles.length ? `<ul>${result.profiles.map(user => `<li>${link(user)}</li>`).join('')}</ul>` : '<p>No public profiles found.</p>';
    } catch (error) { if (current()) output.textContent = error.message; }
  });
  if (!p.owner) return;
  let picture = p.picture, processing = false;
  const form = mount.querySelector('#profile-edit'), submit = form.querySelector('[type=submit]');
  mount.querySelector('#profile-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    processing = true; submit.disabled = true; feedback.textContent = '';
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10000000) throw new Error('Choose a PNG, JPEG, or WebP under 10 MB.');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
      bitmap.close();
      picture = canvas.toDataURL('image/webp', .85);
      if (picture.length > 350000) throw new Error('This picture is too large. Choose another image.');
      const preview = mount.querySelector('#profile-upload-preview'); preview.src = picture; preview.hidden = false;
    } catch (error) { feedback.textContent = error.message; picture = p.picture; }
    finally { processing = false; submit.disabled = false; }
  });
  mount.querySelector('#profile-remove-picture').addEventListener('click', () => {
    if (processing) return;
    picture = ''; mount.querySelector('#profile-upload-preview').hidden = true; mount.querySelector('#profile-upload').value = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (processing) return;
    submit.disabled = true;
    try {
      await api(`/api/profiles/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ picture, bio: mount.querySelector('#profile-bio').value, ...Object.fromEntries(new FormData(form)) }) });
      if (current()) { await load(p.id, mount); mount.querySelector('.profile-feedback').textContent = 'Profile saved.'; }
    } catch (error) { if (current()) feedback.textContent = error.message; }
    finally { submit.disabled = false; }
  });
}

async function load(id, mount) {
  const version = ++generation, identity = state.account?.id;
  mount.textContent = 'Loading profile…';
  try {
    const { profile } = await api(`/api/profiles/${encodeURIComponent(id)}`);
    if (version !== generation || identity !== state.account?.id) return;
    render(profile, mount);
    if (profile.owner) {
      $('#account-picture').hidden = !profile.picture;
      $('#account-picture').src = profile.picture;
      $('#account-initials').hidden = Boolean(profile.picture);
      $('#account-guest-icon').hidden = true;
    }
  } catch (error) { if (version === generation) mount.textContent = error.message; }
}
async function openHash() {
  const match = location.hash.match(/^#profile=(.+)$/);
  if (!match) return;
  if (state.currentView === 'host') { await dependencies.closeHostedRoom({ quiet: true }); if (state.hostedRoom) return; }
  $('#own-profile-content').replaceChildren();
  switchView('publicProfile');
  try { await load(decodeURIComponent(match[1]), $('#public-profile-content')); }
  catch { $('#public-profile-content').textContent = 'Invalid profile link.'; }
}
export function refreshProfileIdentity() {
  generation++;
  $('#account-picture').hidden = true;
  $('#account-picture').removeAttribute('src');
  $('#own-profile-content').replaceChildren();
  $('#public-profile-content').replaceChildren();
  if (location.hash.startsWith('#profile=')) openHash();
  else if (state.account) load(state.account.id, $('#own-profile-content'));
}
export function initProfiles(deps) {
  dependencies = deps;
  window.addEventListener('hashchange', openHash);
  document.addEventListener('opentrivia:view', () => {
    if (state.currentView === 'profile' && state.account) { $('#public-profile-content').replaceChildren(); load(state.account.id, $('#own-profile-content')); }
    if (state.currentView !== 'publicProfile' && location.hash.startsWith('#profile=')) history.replaceState(null, '', location.pathname + location.search);
  });
}
