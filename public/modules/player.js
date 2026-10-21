import { roomTimer, closedClue, standings, clueText } from './room-ui.js?v=0.11.0';
import { $, elements, escapeHtml, formatText, toast, updateBuzzTimers } from "./render.js?v=0.11.0";
import { roomRequest, scheduleRoomPoll, stopRoomPolling } from "./rooms.js?v=0.11.0";
import { state } from "./state.js?v=0.11.0";

function playerHeaders() {
  return { "x-player-token": state.joinedRoom?.player_token || "" };
}

function pollPlayer(delay = 600) {
  scheduleRoomPoll("player", syncPlayerRoom, (error) => renderPlayerDisconnected(error.message), delay);
}

async function joinRoom(code, name) {
  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (normalized.length !== 6) throw new Error("Enter the complete six-character room code.");
  const result = await roomRequest(normalized, "players", { method: "POST", body: JSON.stringify({ name }) });
  state.joinedRoom = {
    code: normalized,
    player_id: result.player_id,
    player_token: result.player_token,
    revision: -1,
  };
  pollPlayer(0);
  return result.room;
}

function syncPlayerRoom(room) {
  if (!state.joinedRoom || state.joinedRoom.revision >= room.revision) return;
  state.joinedRoom.revision = room.revision;
  const activeInput = elements.joinResult.querySelector('input');
  const draft = activeInput ? { id: activeInput.id, value: activeInput.value, focused: document.activeElement === activeInput } : null;
  renderPlayerRoom(room);
  const restored = draft && document.getElementById(draft.id);
  if (restored) { restored.value = draft.value; if (draft.focused) restored.focus(); }
  updateBuzzTimers();
}

function playerScoreboard(room) {
  return `<div class="player-scores">${room.players.map((player) => `<span${player.id === state.joinedRoom.player_id ? ' class="you"' : ""}>${escapeHtml(player.name)} <strong>${player.points.toLocaleString()}</strong></span>`).join("")}</div>`;
}

function answerControls(warning) {
  return `${warning ? '<p class="typo-review" role="status">Possible typo. Check your spelling before you submit. The timer is still running.</p><button type="button" class="button secondary" data-edit-answer>Edit answer</button>' : ''}<button class="button primary" type="submit" data-confirm-typo="${Boolean(warning)}">${warning ? 'Submit as written' : 'Submit answer'}</button>`;
}

function wireTypoEdit(form, input) {
  form.querySelector('[data-edit-answer]')?.addEventListener('click', () => { input.focus(); input.select(); });
}

function renderPlayerRoom(room) {
  elements.joinResult.hidden = false;
  elements.joinResult.className = "join-result player-console";
  $("#join-form").hidden = true;
  const viewer = room.viewer || { id: state.joinedRoom.player_id, name: "Player" };
  if (!room.started) {
    elements.joinResult.innerHTML = `<div class="joined-check" aria-hidden="true">✓</div><div><strong>You’re in, ${escapeHtml(viewer.name)}.</strong><p>Waiting for the host to start “${escapeHtml(room.game.name)}”.</p>${playerScoreboard(room)}</div>`;
    return;
  }
  if (room.phase === 'finished') {
    elements.joinResult.innerHTML = `<div class="player-status"><h2>Final standings</h2>${closedClue(room)}${standings(room)}<p>Waiting for the host to close the room.</p></div>`;
    return;
  }
  if (room.phase === 'boss') { renderPlayerBoss(room); return; }
  const active = room.active_clue;
  if (!active) {
    const result = room.last_result;
    const message = result
      ? `${escapeHtml(result.player_name)} ${result.outcome === "correct" ? "got it right" : result.outcome === "timeout" ? "ran out of time" : "was ruled incorrect"}.`
      : "Waiting for the host to choose a clue.";
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">Connected as ${escapeHtml(viewer.name)}</div><h2>${message}</h2>${closedClue(room)}<p>${room.phase === "transition" ? room.transition_deadline ? "Next round starts in" : "Waiting for the host to start the next round." : "Waiting for the next clue…"}</p>${roomTimer(room.transition_deadline, room.server_time)}${playerScoreboard(room)}</div>`;
    return;
  }
  if (active.phase === "open") {
    const excluded = active.excluded_player_ids.includes(viewer.id);
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">${escapeHtml(active.topic)} · ${active.value.toLocaleString()} points</div>${active.image ? `<img class="player-clue-image" src="${escapeHtml(active.image)}" alt="Image for this clue">` : ""}<h2>${formatText(active.clue)}</h2>${roomTimer(active.deadline, room.server_time)}<button class="buzz-button" type="button" ${excluded ? "disabled" : ""}>${excluded ? "You already answered" : "BUZZ"}</button>${excluded ? "<p>Another player gets this attempt.</p>" : "<p>First buzz gets 35 seconds to answer.</p>"}${playerScoreboard(room)}</div>`;
    if (!excluded) elements.joinResult.querySelector(".buzz-button").addEventListener("click", submitBuzz);
    return;
  }
  const first = active.buzzer?.id === viewer.id;
  if (first && active.phase === "answering") {
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">You buzzed first</div>${clueText(active)}<h3>What’s your answer?</h3>${roomTimer(active.deadline, room.server_time, true)}<form id="player-answer-form"><label class="field-label" for="player-answer">Your answer</label><input id="player-answer" maxlength="500" autocomplete="off" required>${answerControls(active.typo_warning_answer)}</form>${playerScoreboard(room)}</div>`;
    $("#player-answer-form").addEventListener("submit", submitPlayerAnswer);
    wireTypoEdit($("#player-answer-form"), $("#player-answer"));
    updateBuzzTimers();
    $("#player-answer").focus();
    return;
  }
  elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">${first ? "Answer submitted" : "First buzz"}</div><h2>${first ? "The host is reviewing your answer." : `${escapeHtml(active.buzzer.name)} buzzed first.`}</h2>${clueText(active)}${active.phase === "answering" ? roomTimer(active.deadline, room.server_time, true) : ""}<p>${first ? "Waiting for the ruling…" : "Waiting for their answer and the host’s ruling."}</p>${playerScoreboard(room)}</div>`;
  updateBuzzTimers();
}

function renderPlayerBoss(room) {
  const boss = room.boss;
  const player = room.players.find(p => p.id === room.viewer.id);
  const entry = boss.entry;
  let controls = '';
  if (boss.phase === 'wager') {
    controls = entry.wager !== null ? `<p>Your wager is locked: ${entry.wager} points.</p>` : `<form id="boss-player-form"><label class="field-label" for="boss-wager">Your wager (0 to ${Math.max(0, player.points)})</label><input id="boss-wager" type="number" min="0" max="${Math.max(0, player.points)}" value="0" required><button class="button primary" type="submit">Lock wager</button></form><p>If you do not submit, your wager is 0.</p>`;
  } else if (boss.phase === 'answering') {
    controls = entry.answer !== null ? '<p>Your answer is locked. Waiting for time to expire.</p>' : `<form id="boss-player-form"><label class="field-label" for="boss-answer">Your answer</label><input id="boss-answer" maxlength="500" autocomplete="off" required>${answerControls(entry.typo_warning_answer)}</form><p>If you do not answer, you lose your wager.</p>`;
  } else controls = '<p>The host is checking the answers.</p>';
  elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">Boss round · ${escapeHtml(boss.topic)}</div>${boss.phase === 'wager' ? '<h2>Make your wager</h2>' : clueText(boss)}${roomTimer(boss.deadline, room.server_time)}${controls}${playerScoreboard(room)}</div>`;
  if ($('#boss-answer')) wireTypoEdit($('#boss-player-form'), $('#boss-answer'));
  $('#boss-player-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const wagering = boss.phase === 'wager';
      const result = await roomRequest(state.joinedRoom.code, wagering ? 'wager' : 'boss-answer', {
        method: 'POST', headers: playerHeaders(),
        body: JSON.stringify(wagering ? { wager: Number($('#boss-wager').value) } : { answer: $('#boss-answer').value, confirm_typo: event.submitter?.dataset.confirmTypo === 'true' }),
      });
      syncPlayerRoom(result.room);
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });
}

async function submitBuzz(event) {
  event.currentTarget.disabled = true;
  try {
    const result = await roomRequest(state.joinedRoom.code, "buzz", {
      method: "POST",
      headers: playerHeaders(),
      body: "{}",
    });
    state.joinedRoom.revision = -1;
    syncPlayerRoom(result.room);
  } catch (error) {
    toast(error.message, error.status !== 409);
    state.joinedRoom.revision = -1;
    pollPlayer(0);
  }
}

async function submitPlayerAnswer(event) {
  event.preventDefault();
  const input = $("#player-answer");
  const button = event.currentTarget.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const result = await roomRequest(state.joinedRoom.code, "answer", {
      method: "POST",
      headers: playerHeaders(),
      body: JSON.stringify({ answer: input.value, confirm_typo: event.submitter?.dataset.confirmTypo === "true" }),
    });
    state.joinedRoom.revision = -1;
    syncPlayerRoom(result.room);
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

function renderPlayerDisconnected(message) {
  stopRoomPolling();
  state.joinedRoom = null;
  elements.joinResult.hidden = false;
  elements.joinResult.className = "join-result";
  elements.joinResult.innerHTML = `<div><strong>Room closed</strong><p>${escapeHtml(message)}</p></div>`;
  $("#join-form").hidden = false;
}

export function initPlayer() {
  elements.roomCode.addEventListener("input", () => {
    elements.roomCode.value = elements.roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  });
  $("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.joinResult.hidden = false;
    elements.joinResult.innerHTML = "<p>Looking for the room…</p>";
    try {
      const room = await joinRoom(elements.roomCode.value, elements.joinPlayerName.value);
      syncPlayerRoom(room);
    } catch (error) {
      elements.joinResult.innerHTML = `<div><strong>Room not found</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  });
  setInterval(updateBuzzTimers, 250);
}
