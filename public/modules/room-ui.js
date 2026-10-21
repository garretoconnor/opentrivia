import { escapeHtml, formatText, answerDetails } from './render.js?v=0.11.0';

export function roomTimer(deadline, serverTime, overtime = false) {
  if (!deadline) return '';
  // Translate server time to this device's clock for display only.
  const localDeadline = Date.now() + Math.max(0, deadline - serverTime);
  return `<div class="${overtime ? 'buzz-timer' : 'room-timer'}" data-deadline="${localDeadline}" role="timer"></div>`;
}

export function closedClue(room) {
  const clue = room.last_closed;
  if (!clue) return '';
  return `<section class="correct-response"><div class="eyebrow">${escapeHtml(clue.topic)} · Correct answer</div><p>${formatText(clue.clue)}</p><strong>${formatText(clue.answer)}</strong>${answerDetails(clue)}${clue.outcome === 'unanswered' ? '<p>No buzz before time expired. Scores are unchanged.</p>' : ''}</section>`;
}

export function standings(room) {
  const players = [...room.players].sort((a, b) => b.points - a.points);
  let rank = 0;
  return `<div class="final-standings">${players.map((p, index) => {
    if (!index || p.points !== players[index - 1].points) rank = index + 1;
    return `<div class="standing"><strong>${rank}. ${escapeHtml(p.name)}</strong><span>${p.points.toLocaleString()} points</span></div>`;
  }).join('')}</div>`;
}

export function clueText(clue) {
  return `${clue.image ? `<img class="player-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ''}<h2>${formatText(clue.clue)}</h2>`;
}
