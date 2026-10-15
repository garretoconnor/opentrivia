import { api } from './data.js?v=0.10.5';
import { $, escapeHtml, switchView } from './render.js?v=0.10.5';
import { state } from './state.js?v=0.10.5';
import { difficultySymbol, normalizeGame } from '../core.mjs?v=0.10.5';

let generation = 0, dependencies;
const profileURL = user => user.username ? `/@${encodeURIComponent(user.username)}` : `/#profile=${encodeURIComponent(user.id)}`;
const link = user => `<a href="${profileURL(user)}">${escapeHtml(user.name)}</a>`;
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
  const editButton = (field, label) => `<button class="profile-edit-button" type="button" popovertarget="edit-${field}" aria-label="${label}">${label}</button>`;
  const editor = (field, title, contents) => `<div id="edit-${field}" class="profile-popover" popover aria-labelledby="edit-${field}-title"><form data-profile-edit="${field}"><h2 id="edit-${field}-title">${title}</h2>${contents}<p class="profile-edit-error" role="alert"></p><div class="account-actions"><button class="button primary" type="submit">Save</button><button class="button quiet" type="button" popovertarget="edit-${field}" popovertargetaction="hide">Cancel</button></div></form></div>`;
  mount.innerHTML = `<div class="profile-identity">
    <div class="profile-avatar-controls">${p.owner ? `<button class="profile-avatar-button" type="button" aria-label="Upload profile picture" title="Change profile picture">${avatar(p)}<span class="profile-avatar-edit" aria-hidden="true">✎</span></button><input type="file" id="profile-upload" accept="image/png,image/jpeg,image/webp" hidden />${p.picture ? '<button class="profile-edit-button" id="profile-remove-picture" type="button">Remove picture</button>' : ''}` : avatar(p)}</div>
    <div class="profile-name"><h1 tabindex="-1">${escapeHtml(p.name)}</h1>${p.owner ? editButton('username', p.username ? 'Edit username' : 'Choose username') : ''}</div>
    ${p.owner ? editButton('privacy','Privacy') : ''}
    </div>
    <div class="profile-bio-row"><p class="profile-bio">${escapeHtml(p.bio || 'No bio yet.')}</p>${p.owner ? editButton('bio','Edit bio') : ''}</div>
    <p class="profile-feedback" role="status"></p><div class="account-actions">${actions}</div>
    <h2>Daily stats</h2>${stats}
    <h2>Created games</h2>${p.games === null ? '<p>Created games are private.</p>' : p.games.length ? `<div class="profile-card-row" aria-label="Created games">${p.games.map(game => `<article class="game-card">${game.hero_image ? `<img class="game-card-image" src="${escapeHtml(game.hero_image)}" alt="" />` : '<div class="game-card-image game-card-placeholder" aria-hidden="true"><span>?</span></div>'}<div class="game-card-body"><div class="difficulty ${escapeHtml(game.difficulty || 'medium')}">${difficultySymbol(game.difficulty)} ${escapeHtml(game.difficulty || 'medium')}</div>${game.adult_content ? '<span class="adult-badge">18+</span>' : ''}<h3>${escapeHtml(game.title)}</h3><button class="button primary" type="button" data-profile-game="${escapeHtml(game.id)}">Play</button></div></article>`).join('')}</div>` : '<p>No published games yet.</p>'}
    <h2>Friends</h2>${p.friends === null ? '<p>Friends list is private.</p>' : p.friends.length ? `<div class="profile-card-row profile-friend-row" aria-label="Friends">${p.friends.map(user => `<article class="profile-friend-card"><a href="${profileURL(user)}">${avatar(user)}<h3>${escapeHtml(user.name)}</h3></a>${p.owner ? button('Remove friend','DELETE',user.id) : ''}</article>`).join('')}</div>` : '<p>No friends to show yet.</p>'}
    ${p.owner ? `<h2>Friend requests</h2>${p.requests.length ? `<ul class="profile-list">${p.requests.map(user => `<li>${link(user)}<div class="account-actions">${user.direction === 'incoming' ? button('Accept','PUT',user.id) + button('Decline','DELETE',user.id) : button('Cancel request','DELETE',user.id)}</div></li>`).join('')}</ul>` : '<p>No pending requests.</p>'}
    ${editor('username','Edit username', `<label>Username<input name="username" autofocus value="${escapeHtml(p.username || '')}" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]{3,30}" required /></label><p>3–30 letters, numbers, or underscores. Changing your username changes your profile URL.</p>`)}
    ${editor('bio','Edit bio', `<label>Bio<textarea name="bio" autofocus rows="6" maxlength="2000">${escapeHtml(p.bio)}</textarea></label><p>Up to 2,000 characters.</p>`)}
    ${editor('privacy','Privacy', `<fieldset><legend>Who can see your profile?</legend>${Object.entries(privacyFields).map(([key,label]) => `<label>${label}<select name="${key}">${[['public','Public'],['friends','Friends only'],['private','Private']].map(([value,text]) => `<option value="${value}" ${p.privacy[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`).join('')}</fieldset><p>Profile privacy applies to the whole page. Section settings can restrict it further. Hiding your games here does not unpublish them from Explore. Daily leaderboard names remain public.</p>`)}
    ` : ''}
    <h2>Find players</h2><form class="profile-search"><label>Search public profiles<input name="q" minlength="2" maxlength="80" required placeholder="Player name" /></label><button class="button secondary" type="submit">Search</button></form><div class="profile-search-results"></div>`;
  const feedback = mount.querySelector('.profile-feedback');
  const identity = state.account?.id, renderedGeneration = generation;
  const current = () => state.account?.id === identity && renderedGeneration === generation && mount.isConnected;
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
  let busy = false;
  async function save(changes, errorNode = feedback, focusSelector) {
    if (busy || !current()) return;
    busy = true;
    const controls = [...mount.querySelectorAll('button')];
    controls.forEach(node => { node.disabled = true; });
    errorNode.textContent = '';
    try {
      await api(`/api/profiles/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify({ bio: p.bio, picture: p.picture, ...p.privacy, ...changes }) });
      if (current()) {
        await load(p.id, mount);
        const status = mount.querySelector('.profile-feedback');
        if (status) status.textContent = 'Profile saved.';
        mount.querySelector(focusSelector)?.focus();
      }
    } catch (error) { if (current()) errorNode.textContent = error.message; }
    finally { busy = false; controls.forEach(node => { node.disabled = false; }); }
  }
  mount.querySelectorAll('[data-profile-edit]').forEach(form => {
    const popover = form.closest('[popover]');
    popover.addEventListener('beforetoggle', event => {
      if (event.newState === 'open') { form.reset(); form.querySelector('.profile-edit-error').textContent = ''; }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      save(Object.fromEntries(new FormData(form)), form.querySelector('.profile-edit-error'), `[popovertarget="edit-${form.dataset.profileEdit}"]`);
    });
  });
  mount.querySelector('.profile-avatar-button').addEventListener('click', () => mount.querySelector('#profile-upload').click());
  mount.querySelector('#profile-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || busy) return;
    const avatarButton = mount.querySelector('.profile-avatar-button');
    avatarButton.disabled = true;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10000000) throw new Error('Choose a PNG, JPEG, or WebP under 10 MB.');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
      bitmap.close();
      const picture = canvas.toDataURL('image/webp', .85);
      if (picture.length > 350000) throw new Error('This picture is too large. Choose another image.');
      await save({ picture }, feedback, '.profile-avatar-button');
    } catch (error) { if (current()) feedback.textContent = error.message; }
    finally { avatarButton.disabled = false; event.target.value = ''; }
  });
  mount.querySelector('#profile-remove-picture')?.addEventListener('click', () => save({ picture: '' }, feedback, '.profile-avatar-button'));

}

async function load(id, mount) {
  const version = ++generation, identity = state.account?.id;
  mount.textContent = 'Loading profile…';
  try {
    const { profile } = await api(`/api/profiles/${encodeURIComponent(id)}`);
    if (version !== generation || identity !== state.account?.id) return;
    render(profile, mount);
    if (['profile','publicProfile'].includes(state.currentView) && profile.username) history.replaceState(null, '', profileURL(profile));
    if (profile.owner) {
      state.account.name = profile.name;
      state.account.needsUsername = !profile.username;
      $('#account-nav-label').textContent = profile.name;
      $('#account-button').setAttribute('aria-label', `Profile: ${profile.name}`);
      $('#account-button').title = profile.name;
      $('#account-initials').textContent = Array.from(profile.name).slice(0,2).join('').toUpperCase();
      $('#account-picture').hidden = !profile.picture;
      $('#account-picture').src = profile.picture;
      $('#account-initials').hidden = Boolean(profile.picture);
      $('#account-guest-icon').hidden = true;
    }
  } catch (error) { if (version === generation) mount.textContent = error.message; }
}
async function openHash() {
  const match = location.pathname.match(/^\/(@[a-zA-Z0-9_]{3,30})$/) || location.hash.match(/^#profile=(.+)$/);
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
  if (location.pathname.startsWith('/@') || location.hash.startsWith('#profile=')) openHash();
  else if (state.account?.needsUsername) switchView('profile');
  else if (state.account) load(state.account.id, $('#own-profile-content'));
}
export function initProfiles(deps) {
  dependencies = deps;
  window.addEventListener('hashchange', openHash);
  window.addEventListener('popstate', () => {
    if (location.pathname.startsWith('/@') || location.hash.startsWith('#profile=')) openHash();
    else switchView('library');
  });
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href^="/@"]');
    if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, '', anchor.getAttribute('href'));
    openHash();
  });
  document.addEventListener('opentrivia:view', () => {
    if (state.currentView === 'profile' && state.account) { $('#public-profile-content').replaceChildren(); load(state.account.id, $('#own-profile-content')); }
    if (state.currentView !== 'publicProfile' && (location.pathname.startsWith('/@') || location.hash.startsWith('#profile='))) history.replaceState(null, '', '/' + location.search);
  });
}
