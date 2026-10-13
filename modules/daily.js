import { api } from './data.js?v=0.6.0';
import { $, escapeHtml } from './render.js?v=0.6.0';
import { state } from './state.js?v=0.6.0';

let snapshot;
let rolloverTimer;
let loading = false;
let submitting = false;

function board(rows) {
  if (!rows.length) return '<p class="muted">No answers yet. Be the first to play.</p>';
  return `<div class="daily-table-wrap"><table class="daily-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Played</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${row.points}</td><td>${row.played}</td></tr>`).join('')}</tbody></table></div>`;
}
function render() {
  const data = snapshot;
  $('#daily-date').textContent = `${data.day} · ${data.season?.name || 'Between seasons'}`;
  $('#daily-status').textContent = data.unavailable_reason || 'One question. One answer. One point for getting it right.';
  $('#daily-question').textContent = data.question?.clue || 'Your daily challenge is on its way.';
  $('#daily-topic').textContent = data.question?.topic || '';
  $('#daily-image').src = data.question?.image || '';
  $('#daily-image').hidden = !data.question?.image;
  $('#daily-player-form').hidden = !data.question || Boolean(data.player);
  $('#daily-answer-form').hidden = !data.question || !data.player || Boolean(data.result);
  $('#daily-identity').textContent = data.player ? `Playing as ${data.player.name}. Your progress is saved in this browser.` : 'Choose a name to join the leaderboards. Progress is saved in this browser.';
  const result = $('#daily-result');
  result.hidden = !data.result;
  result.replaceChildren();
  if (data.result) {
    for (const text of [data.result.points ? 'Correct! You earned 1 point.' : 'No point today. Try again tomorrow.',
      `Your answer: ${data.result.submitted_answer}`, `Correct answer: ${data.result.correct_answer}`, data.result.explanation]) {
      if (text) { const p = document.createElement('p'); p.textContent = text; result.append(p); }
    }
  }
  $('#daily-board').innerHTML = board(data.leaderboards.daily);
  $('#season-board').innerHTML = data.season ? board(data.leaderboards.season) : '<p class="muted">The season leaderboard will appear when a season starts.</p>';
  $('#daily-season-title').textContent = data.season ? `${data.season.name} leaderboard` : 'Season leaderboard';
  clearTimeout(rolloverTimer);
  // Use the server's clock so a skewed device clock cannot postpone rollover.
  rolloverTimer = setTimeout(() => {
    snapshot = null;
    $('#daily-answer-form').hidden = true;
    $('#daily-player-form').hidden = true;
    $('#daily-question').textContent = 'Loading the new daily question…';
    if (state.currentView === 'daily') loadDaily();
  }, Math.max(1000, Date.parse(data.rolls_over_at) - Date.parse(data.server_time) + 100));
}
export async function loadDaily() {
  if (loading || submitting) return;
  loading = true;
  $('#daily-refresh').disabled = true;
  $('#daily-answer-form button').disabled = true;
  $('#daily-error').textContent = '';
  try {
    const next = await api('/api/daily');
    if (snapshot?.day !== next.day) $('#daily-answer').value = '';
    snapshot = next;
    render();
  } catch (error) {
    if (!snapshot) {
      $('#daily-status').textContent = 'Daily trivia is currently unavailable.';
      $('#daily-question').textContent = 'Please try refreshing shortly.';
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.currentView === 'daily') loadDaily();
  });
  $('#daily-player-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/daily/player', { method: 'POST', body: JSON.stringify({ name: $('#daily-name').value }) });
      await loadDaily();
    } catch (error) { $('#daily-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#daily-answer-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!snapshot || submitting || loading) return;
    submitting = true;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    $('#daily-error').textContent = '';
    try {
      const response = await api('/api/daily/answer', { method: 'POST', body: JSON.stringify({ day: snapshot.day, answer: $('#daily-answer').value }) });
      snapshot.result = response.result;
      render();
      $('#daily-answer').value = '';
      submitting = false;
      await loadDaily();
    } catch (error) {
      if (error.status === 409) {
        submitting = false;
        $('#daily-answer').value = '';
        await loadDaily();
      }
      $('#daily-error').textContent = error.message;
    } finally { submitting = false; button.disabled = false; }
  });
}
