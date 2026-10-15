import { normalizeGame } from "../core.mjs?v=0.11.0";
import { allowsLocalFallback, api } from "./data.js?v=0.11.0";
import { getPublishedGame, recordLocalPlay } from "./library.js?v=0.11.0";
import { renderPlayRound, renderScoreboard } from "./local-play.js?v=0.11.0";
import { $, elements, escapeHtml, formatText, answerDetails, switchView, toast, updateBuzzTimers } from "./render.js?v=0.11.0";
import {
  localRoomStore,
  makeLocalRoom,
  roomRequest,
  saveLocalRooms,
  scheduleRoomPoll,
  stopRoomPolling,
} from "./rooms.js?v=0.11.0";
import { state } from "./state.js?v=0.11.0";

function hostHeaders() {
  return { "x-host-token": state.hostedRoom?.host_token || "" };
}

function pollHost(delay = 600) {
  scheduleRoomPoll("host", syncHostRoom, () => { state.hostedRoom = null; }, delay);
}

export async function hostPublished(id) {
  try {
    const selected = normalizeGame(await getPublishedGame(id));
    state.authoredGame = state.currentView === "studio" ? state.game : state.authoredGame;
    state.game = selected;
    try {
      state.hostedRoom = await api("/api/rooms", { method: "POST", body: JSON.stringify({ game: selected }) });
    } catch (error) {
      if (!allowsLocalFallback(error)) throw error;
      state.hostedRoom = await makeLocalRoom(selected);
    }
    state.hostedRoom.gameId = id;
    elements.hostCode.textContent = state.hostedRoom.code;
    $("#host-game-name").textContent = `Hosting “${selected.name}”`;
    renderHostPlayers({ players: [], started: false });
    switchView("host");
    pollHost(0);
  } catch (error) {
    toast(error.message, true);
  }
}

export async function closeHostedRoom({ quiet = false } = {}) {
  if (!state.hostedRoom) return;
  const room = state.hostedRoom;
  try {
    await roomRequest(room.code, "close", { method: "POST", headers: { "x-host-token": room.host_token } });
  } catch (error) {
    if (!allowsLocalFallback(error)) {
      if (!quiet) toast(error.message, true);
      return;
    }
    const rooms = localRoomStore();
    if (rooms[room.code]?.host_token === room.host_token) {
      delete rooms[room.code];
      saveLocalRooms(rooms);
    }
  }
  state.hostedRoom = null;
  state.hostRoomSnapshot = null;
  stopRoomPolling();
  if (!quiet) {
    toast("Room closed.");
    switchView("library");
  }
}

function renderHostPlayers(room) {
  const expected = state.game.num_players;
  const names = room.players.map((player) => `<span>${escapeHtml(player.name)}</span>`).join("");
  elements.hostPlayerList.innerHTML = `<strong>${room.players.length} of ${expected} players joined</strong><div>${names || "Waiting for players…"}</div>`;
  const start = $("#host-start-button");
  start.disabled = room.started || room.players.length < 2;
  start.textContent = room.started ? "Game started" : room.players.length < 2 ? "Waiting for players" : "Start hosting";
}

function syncHostRoom(room) {
  state.hostRoomSnapshot = room;
  if (state.currentView === "host") renderHostPlayers(room);
  if (!state.session?.hosted) return;
  state.session.players = room.players.map((serverPlayer) => {
    const local = state.session.players.find((player) => player.id === serverPlayer.id) || {};
    return {
      ...local,
      ...serverPlayer,
      eliminated: false,
      wager: local.wager ?? null,
      guess: local.guess ?? "",
      graded: local.graded ?? false,
    };
  });
  state.session.used = room.used;
  renderScoreboard();
  if (room.active_clue && state.hostClueLocation) {
    renderHostedClue(room);
  } else if (!room.active_clue && state.hostClueLocation) {
    state.hostClueLocation = null;
    if (elements.cardDialog.open) elements.cardDialog.close();
    renderPlayRound();
  }
}

async function launchHostedGame() {
  if (!state.hostedRoom) return;
  try {
    const result = await roomRequest(state.hostedRoom.code, "start", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ starting_points: 1000 }),
    });
    state.hostRoomSnapshot = result.room;
    state.returnView = "host";
    state.publishedGameId = state.hostedRoom.gameId || null;
    state.session = {
      players: result.room.players.map((player) => ({ ...player, eliminated: false, wager: null, guess: "", graded: false })),
      boardIndex: 0,
      used: result.room.used,
      bossPhase: "category",
      hosted: true,
    };
    elements.playGameName.textContent = state.game.name;
    if (state.publishedGameId) {
      api(`/api/games/${state.publishedGameId}/plays`, { method: "POST" }).catch(() => recordLocalPlay(state.publishedGameId));
    }
    switchView("play");
    renderPlayRound();
    pollHost(0);
  } catch (error) {
    toast(error.message, true);
  }
}

export async function openHostedPlayCard(columnIndex, row) {
  try {
    const result = await roomRequest(state.hostedRoom.code, "clues", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ board_index: state.session.boardIndex, column_index: columnIndex, row }),
    });
    state.hostClueLocation = { boardIndex: state.session.boardIndex, columnIndex, row };
    if (!elements.cardDialog.open) elements.cardDialog.showModal();
    syncHostRoom(result.room);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderHostedClue(room) {
  const active = room.active_clue;
  if (!active || !state.hostClueLocation) return;
  const board = state.game.boards[active.board_index];
  const column = board.columns[active.column_index];
  const clue = column.clues[active.row];
  const previous = room.last_result && active.attempt > 1
    ? `<p class="attempt-notice">${escapeHtml(room.last_result.player_name)} ${room.last_result.outcome === "timeout" ? "ran out of time" : "was ruled incorrect"}. The clue is open again.</p>`
    : "";
  if (active.phase === "open") {
    elements.cardContent.innerHTML = `<div class="eyebrow">${escapeHtml(column.topic)} · ${clue.value.toLocaleString()} points</div><h2>Clue</h2>${previous}${clue.image ? `<img class="play-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}<p class="revealed-answer">${formatText(clue.clue || "No clue was provided.")}</p><div class="buzz-open"><span class="live-dot" aria-hidden="true"></span> Buzzers are open${active.attempt > 1 ? ` · attempt ${active.attempt}` : ""}</div>`;
    return;
  }
  if (active.phase === "answering") {
    elements.cardContent.innerHTML = `<div class="eyebrow">First buzz</div><h2>${escapeHtml(active.buzzer.name)} buzzed first.</h2><p class="clue-hidden-note">The clue is hidden while ${escapeHtml(active.buzzer.name)} answers.</p><div class="buzz-timer" data-deadline="${active.deadline}">30</div><p>Waiting for an answer…</p>`;
    updateBuzzTimers();
    return;
  }
  elements.cardContent.innerHTML = `<div class="eyebrow">Answer submitted</div><h2>${escapeHtml(active.buzzer.name)} answered</h2><blockquote class="submitted-answer">${formatText(active.submitted_answer || "")}</blockquote><div class="correct-response"><strong>Correct response</strong><br>${formatText(clue.answer || "No response was provided.")}${answerDetails(clue)}</div><div class="ruling-actions"><button class="score-button negative" data-ruling="false" type="button">Incorrect · −${clue.value.toLocaleString()}</button><button class="score-button positive" data-ruling="true" type="button">Correct · +${clue.value.toLocaleString()}</button></div>`;
  elements.cardContent.querySelectorAll("[data-ruling]").forEach((button) => {
    button.addEventListener("click", () => submitHostRuling(button.dataset.ruling === "true"));
  });
}

async function submitHostRuling(correct) {
  elements.cardContent.querySelectorAll("[data-ruling]").forEach((button) => { button.disabled = true; });
  try {
    const result = await roomRequest(state.hostedRoom.code, "ruling", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ correct }),
    });
    syncHostRoom(result.room);
  } catch (error) {
    toast(error.message, true);
  }
}

export function initHost() {
  elements.hostCode.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements.hostCode.textContent);
      toast("Room code copied.");
    } catch {
      toast("Select the code and copy it to share.");
    }
  });
  $("#close-room-button").addEventListener("click", () => closeHostedRoom());
  $("#host-start-button").addEventListener("click", launchHostedGame);
  window.addEventListener("pagehide", () => {
    if (!state.hostedRoom) return;
    fetch(`/api/rooms/${state.hostedRoom.code}/close`, {
      method: "POST",
      headers: { "x-host-token": state.hostedRoom.host_token },
      keepalive: true,
    }).catch(() => {});
    const rooms = localRoomStore();
    delete rooms[state.hostedRoom.code];
    saveLocalRooms(rooms);
  });
}
