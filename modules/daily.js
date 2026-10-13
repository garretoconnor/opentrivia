import { api } from './data.js?v=0.6.0';
import { $, escapeHtml } from './render.js?v=0.6.0';
import { state } from './state.js?v=0.6.0';

let snapshot;
let rolloverTimer;
let timer;
let loading = false;
let submitting = false;
let starting = false;
let lostFocus = false;
let baseline = 0;
let elapsed = 0;
const voidKey = day => `opentrivia.daily.void.${day}`;
function locallyVoided(day) {
  try { return localStorage.getItem(voidKey(day)) === '1'; } catch { return false; }
}
function seconds(ms) { return `${(ms / 1000).toFixed(2)} s`; }
function board(rows, season = false) {
  if (!rows.length) return '<p class="muted">No valid completion times yet. Be the first to play.</p>';
  return `<div class="daily-table-wrap"><table class="daily-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">${season ? 'Average time' : 'Time'}</th><th scope="col">Completed</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${seconds(row.completion_ms)}</td><td>${row.played}</td></tr>`).join('')}</tbody></table></div>`;
}
function updateTimer() {
  if (!snapshot?.run || snapshot.result) return;
  $('#daily-timer').textContent = snapshot.run.voided
    ? 'Time voided — you left this tab or window. You can still answer, but this time will not rank.'
    : `Time: ${seconds(elapsed + performance.now() - baseline)}`;
}
function voidTime() {
  if (starting) lostFocus = true;
  if (!snapshot?.run || snapshot.result) return;
  snapshot.run.voided = true;
  try { localStorage.setItem(voidKey(snapshot.day), '1'); } catch { /* Server still records the void. */ }
  clearInterval(timer);
  updateTimer();
  // keepalive also delivers the invalidation when the page is being unloaded.
  api('/api/daily/void', { method: 'POST', keepalive: true, body: JSON.stringify({ day: snapshot.day }) })
    .catch(() => { /* Retried on refresh and included in the answer request. */ });
}
function render() {
  const data = snapshot;
  const revealed = Boolean(data.run || data.result);
  $('#daily-date').textContent = `${data.day} · ${data.season?.name || 'Between seasons'}`;
  $('#daily-status').hidden = Boolean(data.question) && !revealed;
  $('#daily-status').textContent = data.unavailable_reason || 'Answer correctly as quickly as you can. Leaving this tab or window voids your time.';
  $('#daily-topic').textContent = data.question?.topic || 'Daily trivia';
  $('#daily-play').hidden = !data.question || revealed;
  $('#daily-question').hidden = !revealed;
  $('#daily-question').textContent = revealed ? data.question?.clue || '' : '';
  $('#daily-image').hidden = !revealed || !data.question?.image;
  if (revealed && data.question?.image) $('#daily-image').src = data.question.image;
  else $('#daily-image').removeAttribute('src');
  $('#daily-answer-form').hidden = !data.run || Boolean(data.result);
  $('#daily-identity').hidden = !revealed;
  $('#daily-identity').textContent = data.player ? `Playing as ${data.player.name}. Your progress is saved in this browser.` : '';
  if (data.player && !$('#daily-name').value) $('#daily-name').value = data.player.name;
  clearInterval(timer);
  $('#daily-timer').hidden = !data.run || Boolean(data.result);
  if (data.run && !data.result) {
    updateTimer();
    if (!data.run.voided) timer = setInterval(updateTimer, 50);
  }
  const result = $('#daily-result');
  result.hidden = !data.result;
  result.replaceChildren();
  if (data.result) {
    for (const text of [data.result.points ? 'Correct!' : 'Incorrect. Try again tomorrow.',
      data.result.completion_ms == null ? 'Time voided or unavailable — this answer does not rank.' : `Completion time: ${seconds(data.result.completion_ms)}${data.result.points ? '' : ' — only correct answers rank.'}`,
      `Your answer: ${data.result.submitted_answer}`, `Correct answer: ${data.result.correct_answer}`, data.result.explanation]) {
      if (text) { const p = document.createElement('p'); p.textContent = text; result.append(p); }
    }
  }
  $('#daily-board').innerHTML = board(data.leaderboards.daily);
  $('#season-board').innerHTML = data.season ? board(data.leaderboards.season, true) : '<p class="muted">The season leaderboard will appear when a season starts.</p>';
  $('#daily-season-title').textContent = data.season ? `${data.season.name} leaderboard` : 'Season leaderboard';
  clearTimeout(rolloverTimer);
  rolloverTimer = setTimeout(() => {
    clearInterval(timer);
    snapshot = null;
    $('#daily-answer-form').hidden = true;
    $('#daily-play').hidden = true;
    $('#daily-question').hidden = true;
    $('#daily-image').hidden = true;
    $('#daily-timer').hidden = true;
    if (state.currentView === 'daily') loadDaily();
  }, Math.max(1000, Date.parse(data.rolls_over_at) - Date.parse(data.server_time) + 100));
}
function accept(next) {
  const resumed = next.run && !next.result && (!snapshot?.run || snapshot.day !== next.day);
  if (snapshot?.day !== next.day) {
    $('#daily-answer').value = '';
    $('#daily-name').value = '';
  }
  if (next.run && (locallyVoided(next.day) || snapshot?.day === next.day && snapshot.run?.voided)) next.run.voided = true;
  snapshot = next;
  elapsed = next.run ? Math.max(0, Date.parse(next.server_time) - next.run.started_at) : 0;
  baseline = performance.now();
  // A resumed page cannot prove uninterrupted focus since its original start.
  if (resumed || next.run?.voided && !next.result) voidTime();
  render();
}
export async function loadDaily() {
  if (loading || submitting || starting) return;
  loading = true;
  $('#daily-refresh').disabled = true;
  $('#daily-answer-form button').disabled = true;
  $('#daily-error').textContent = '';
  try { accept(await api('/api/daily')); }
  catch (error) {
    if (!snapshot) {
      $('#daily-status').hidden = false;
      $('#daily-status').textContent = 'Daily trivia is currently unavailable.';
      $('#daily-board').textContent = 'Leaderboard unavailable.';
      $('#season-board').textContent = 'Leaderboard unavailable.';
    }
    $('#daily-error').textContent = [404, 501].includes(error.status)
      ? 'Daily trivia needs the Cloudflare server. Run the Worker locally to preview shared questions and leaderboards.'
      : error.message;
  } finally {
    loading = false;
    $('#daily-refresh').disabled = false;
    $('#daily-answer-form button').disabled = false;
  }
}
export function initDaily() {
  $('#daily-refresh').addEventListener('click', loadDaily);
  window.addEventListener('blur', voidTime);
  window.addEventListener('pagehide', voidTime);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) voidTime();
    else if (state.currentView === 'daily') loadDaily();
  });
  $('#daily-play').addEventListener('click', async () => {
    if (!snapshot || starting || loading || snapshot.run || snapshot.result) return;
    starting = true;
    lostFocus = false;
    $('#daily-play').disabled = true;
    $('#daily-error').textContent = '';
    try {
      const next = await api('/api/daily/start', { method: 'POST', body: JSON.stringify({ day: snapshot.day }) });
      // This is a fresh Play response, not a resumed page.
      snapshot = next;
      elapsed = Math.max(0, Date.parse(next.server_time) - next.run.started_at);
      baseline = performance.now();
      if (lostFocus || document.hidden || !document.hasFocus() || locallyVoided(next.day)) voidTime();
      render();
      $('#daily-answer').focus();
    } catch (error) { $('#daily-error').textContent = error.message; }
    finally { starting = false; $('#daily-play').disabled = false; }
  });
  $('#daily-answer-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!snapshot?.run || submitting || loading) return;
    submitting = true;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    $('#daily-error').textContent = '';
    try {
      const response = await api('/api/daily/answer', { method: 'POST', body: JSON.stringify({
        day: snapshot.day, answer: $('#daily-answer').value, name: $('#daily-name').value,
        time_voided: snapshot.run.voided || locallyVoided(snapshot.day),
      }) });
      snapshot.result = response.result;
      if (snapshot.run.voided || locallyVoided(snapshot.day)) snapshot.result.completion_ms = null;
      render();
      $('#daily-answer').value = '';
      submitting = false;
      await loadDaily();
    } catch (error) {
      if (error.status === 409) {
        submitting = false;
        await loadDaily();
      }
      $('#daily-error').textContent = error.message;
    } finally { submitting = false; button.disabled = false; }
  });
}
