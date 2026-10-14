import { $, elements, escapeHtml, formatText, toast, updateBuzzTimers } from "./render.js?v=0.10.0";
import { roomRequest, scheduleRoomPoll, stopRoomPolling } from "./rooms.js?v=0.10.0";
import { state } from "./state.js?v=0.10.0";

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
  if (!state.joinedRoom || state.joinedRoom.revision === room.revision) return;
  state.joinedRoom.revision = room.revision;
  renderPlayerRoom(room);
}

function playerScoreboard(room) {
  return `<div class="player-scores">${room.players.map((player) => `<span${player.id === state.joinedRoom.player_id ? ' class="you"' : ""}>${escapeHtml(player.name)} <strong>${player.points.toLocaleString()}</strong></span>`).join("")}</div>`;
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
  const active = room.active_clue;
  if (!active) {
    const result = room.last_result;
    const message = result
      ? `${escapeHtml(result.player_name)} ${result.outcome === "correct" ? "got it right" : result.outcome === "timeout" ? "ran out of time" : "was ruled incorrect"}.`
      : "Waiting for the host to choose a clue.";
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">Connected as ${escapeHtml(viewer.name)}</div><h2>${message}</h2><p>Waiting for the next clue…</p>${playerScoreboard(room)}</div>`;
    return;
  }
  if (active.phase === "open") {
    const excluded = active.excluded_player_ids.includes(viewer.id);
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">${escapeHtml(active.topic)} · ${active.value.toLocaleString()} points</div>${active.image ? `<img class="player-clue-image" src="${escapeHtml(active.image)}" alt="Image for this clue">` : ""}<h2>${formatText(active.clue)}</h2><button class="buzz-button" type="button" ${excluded ? "disabled" : ""}>${excluded ? "You already answered" : "BUZZ"}</button>${excluded ? "<p>Another player gets this attempt.</p>" : "<p>First buzz gets 35 seconds to answer.</p>"}${playerScoreboard(room)}</div>`;
    if (!excluded) elements.joinResult.querySelector(".buzz-button").addEventListener("click", submitBuzz);
    return;
  }
  const first = active.buzzer?.id === viewer.id;
  if (first && active.phase === "answering") {
    elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">You buzzed first</div><h2>What’s your answer?</h2><div class="buzz-timer" data-deadline="${active.deadline}">30</div><form id="player-answer-form"><label class="field-label" for="player-answer">Your answer</label><input id="player-answer" maxlength="500" autocomplete="off" required><button class="button primary" type="submit">Submit answer</button></form>${playerScoreboard(room)}</div>`;
    $("#player-answer-form").addEventListener("submit", submitPlayerAnswer);
    updateBuzzTimers();
    $("#player-answer").focus();
    return;
  }
  elements.joinResult.innerHTML = `<div class="player-status"><div class="eyebrow">${first ? "Answer submitted" : "First buzz"}</div><h2>${first ? "The host is reviewing your answer." : `${escapeHtml(active.buzzer.name)} buzzed first.`}</h2>${active.phase === "answering" ? `<div class="buzz-timer" data-deadline="${active.deadline}">30</div>` : ""}<p>${first ? "Waiting for the ruling…" : "The clue is hidden while they answer."}</p>${playerScoreboard(room)}</div>`;
  updateBuzzTimers();
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
  event.currentTarget.querySelector("button").disabled = true;
  try {
    const result = await roomRequest(state.joinedRoom.code, "answer", {
      method: "POST",
      headers: playerHeaders(),
      body: JSON.stringify({ answer: input.value }),
    });
    state.joinedRoom.revision = -1;
    syncPlayerRoom(result.room);
  } catch (error) {
    toast(error.message, true);
    event.currentTarget.querySelector("button").disabled = false;
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
