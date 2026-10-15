import {
  adjustScore,
  createPlayers,
  gradeBossGuess,
  isBossBoard,
  setWager,
} from "../core.mjs?v=0.10.1";
import { api } from "./data.js?v=0.10.1";
import { rateGame, recordLocalPlay } from "./library.js?v=0.10.1";
import { $, elements, escapeHtml, formatText, answerDetails, switchView, toast } from "./render.js?v=0.10.1";
import { saveGame, state } from "./state.js?v=0.10.1";

let openHostedPlayCard = () => {};
let closeHostedRoom = () => {};

export function initLocalPlay(dependencies) {
  openHostedPlayCard = dependencies.openHostedPlayCard;
  closeHostedRoom = dependencies.closeHostedRoom;
  $("#preview-button").addEventListener("click", previewRound);
  document.addEventListener("opentrivia:view", () => {
    if (previewSnapshot && state.currentView !== "play") {
      Object.assign(state, previewSnapshot);
      previewSnapshot = null;
    }
  });
  $("#play-button").addEventListener("click", () => showSetup("studio"));
  $("#cancel-setup-button").addEventListener("click", () => switchView(state.returnView));
  $("#launch-button").addEventListener("click", launchGame);
  elements.cardDialog.addEventListener("close", () => {
    if (state.session && !elements.play.hidden && !state.hostClueLocation) renderPlayRound();
  });
  elements.cardDialog.addEventListener("cancel", (event) => {
    if (state.session?.hosted && state.hostClueLocation) event.preventDefault();
  });
}

let previewSnapshot = null;
export function previewRound() {
  previewSnapshot = { game: state.game, session: state.session, publishedGameId: state.publishedGameId, returnView: state.returnView };
  state.game = structuredClone(state.authoredGame);
  state.publishedGameId = null;
  state.returnView = "studio";
  state.session = {
    preview: true,
    players: createPlayers(Array.from({ length: state.game.num_players }, (_, index) => `Player ${index + 1}`), 1000),
    boardIndex: state.selectedBoard,
    used: state.game.boards.map(board => board.columns.map(column => column.clues.map(() => false))),
    bossPhase: "category",
  };
  elements.playGameName.textContent = state.game.name;
  switchView("play");
  renderPlayRound();
}

export function showSetup(source = "studio", gameId = null) {
  if (source === "studio") {
    state.game.name = elements.gameName.value.trim() || "Untitled game";
    saveGame();
  }
  state.returnView = source === "studio" ? "studio" : source === "host" ? "host" : "library";
  state.publishedGameId = gameId;
  elements.playerFields.replaceChildren(...Array.from({ length: state.game.num_players }, (_, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "player-input-wrap";
    wrapper.innerHTML = `<label for="player-name-${index}">Player ${index + 1}</label><input id="player-name-${index}" maxlength="30" value="Player ${index + 1}" autocomplete="off">`;
    return wrapper;
  }));
  switchView("setup");
}

function launchGame() {
  try {
    const names = [...elements.playerFields.querySelectorAll("input")].map((input) => input.value);
    const players = createPlayers(names, Number(elements.startingPoints.value));
    state.session = {
      players,
      boardIndex: 0,
      used: state.game.boards.map((board) => board.columns.map((column) => column.clues.map(() => false))),
      bossPhase: "category",
    };
    elements.playGameName.textContent = state.game.name;
    if (state.publishedGameId) {
      api(`/api/games/${state.publishedGameId}/plays`, { method: "POST" }).catch(() => recordLocalPlay(state.publishedGameId));
    }
    switchView("play");
    renderPlayRound();
  } catch (error) {
    toast(error.message, true);
  }
}

export function renderScoreboard() {
  elements.scoreboard.replaceChildren(...state.session.players.map((player) => {
    const chip = document.createElement("div");
    chip.className = `score-chip${player.eliminated ? " eliminated" : ""}`;
    chip.innerHTML = `<strong>${escapeHtml(player.name)}</strong><span>${player.points.toLocaleString()}</span>`;
    return chip;
  }));
}

export function renderPlayRound() {
  const board = state.game.boards[state.session.boardIndex];
  elements.playKicker.textContent = `${state.session.preview ? "Preview · " : ""}${board.title ? `${board.title} · ` : ""}Round ${state.session.boardIndex + 1} of ${state.game.boards.length} · ${isBossBoard(board) ? "Boss" : "Standard"}`;
  renderScoreboard();
  if (isBossBoard(board)) renderBossRound();
  else renderStandardRound();
}

function renderStandardRound() {
  const board = state.game.boards[state.session.boardIndex];
  const rows = Math.max(...board.columns.map((column) => column.size));
  const grid = document.createElement("div");
  grid.className = "play-board";
  grid.style.gridTemplateColumns = `repeat(${board.columns.length}, minmax(88px, 1fr))`;
  const children = [];
  board.columns.forEach((column) => {
    const topic = document.createElement("div");
    topic.className = "play-topic";
    topic.textContent = column.topic || "Untitled topic";
    children.push(topic);
  });
  for (let row = 0; row < rows; row += 1) {
    board.columns.forEach((column, columnIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "play-clue";
      if (row >= column.size) {
        button.classList.add("blank");
        button.disabled = true;
      } else {
        const clue = column.clues[row];
        const used = state.session.used[state.session.boardIndex][columnIndex][row];
        button.textContent = used ? "" : clue.value.toLocaleString();
        button.classList.toggle("used", used);
        button.disabled = used;
        button.setAttribute("aria-label", used ? "Card already played" : `${column.topic}, ${clue.value} points`);
        button.addEventListener("click", () => openPlayCard(columnIndex, row));
      }
      children.push(button);
    });
  }
  grid.replaceChildren(...children);
  const usedCount = state.session.used[state.session.boardIndex].flat().filter(Boolean).length;
  const total = board.columns.reduce((sum, column) => sum + column.size, 0);
  const footer = document.createElement("div");
  footer.className = "round-footer";
  footer.innerHTML = `<span>${usedCount} of ${total} cards played</span>`;
  const next = document.createElement("button");
  next.className = "button primary";
  next.type = "button";
  next.textContent = state.session.boardIndex === state.game.boards.length - 1 ? "Finish game" : "Next round →";
  next.disabled = usedCount < total;
  next.addEventListener("click", nextRound);
  footer.append(next);
  elements.playStage.replaceChildren(grid, footer);
}

function openPlayCard(columnIndex, row) {
  if (state.session.hosted) {
    openHostedPlayCard(columnIndex, row);
    return;
  }
  const board = state.game.boards[state.session.boardIndex];
  const column = board.columns[columnIndex];
  const clue = column.clues[row];
  state.session.used[state.session.boardIndex][columnIndex][row] = true;
  elements.cardContent.innerHTML = `
    <div class="dialog-topline">
      <div class="eyebrow">${escapeHtml(column.topic)} · ${clue.value.toLocaleString()} points</div>
      <button class="icon-button" id="dismiss-card-button" type="button" aria-label="Close card">×</button>
    </div>
    <h2>Clue</h2>
    ${clue.image ? `<img class="play-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}
    <p class="revealed-answer">${formatText(clue.clue || "No clue was provided.")}</p>
    <button class="button secondary" id="reveal-response-button" type="button">Reveal correct response</button>
    <div id="response-area" hidden></div>`;
  $("#dismiss-card-button").addEventListener("click", () => elements.cardDialog.close());
  $("#reveal-response-button").addEventListener("click", (event) => {
    event.currentTarget.hidden = true;
    const response = $("#response-area");
    response.hidden = false;
    response.innerHTML = `<div class="correct-response"><strong>Correct response</strong><br>${formatText(clue.answer || "No response was provided.")}${answerDetails(clue)}</div><div class="scoring-grid" id="normal-scoring"></div><div class="dialog-actions"><button class="button primary" id="close-card-button" type="button">Back to board</button></div>`;
    renderNormalScoring($("#normal-scoring"), clue.value);
    $("#close-card-button").addEventListener("click", () => { elements.cardDialog.close(); renderPlayRound(); });
  });
  elements.cardDialog.showModal();
}

function renderNormalScoring(container, value) {
  container.replaceChildren(...state.session.players.map((player) => {
    const row = document.createElement("div");
    row.className = "score-row";
    row.innerHTML = `<span>${escapeHtml(player.name)} · ${player.points.toLocaleString()}</span>`;
    const minus = scoreButton(`−${value}`, "negative", () => adjustScore(player, -value));
    const plus = scoreButton(`+${value}`, "positive", () => adjustScore(player, value));
    minus.disabled = player.eliminated;
    plus.disabled = player.eliminated;
    for (const button of [minus, plus]) button.addEventListener("click", () => renderNormalScoring(container, value));
    row.append(minus, plus);
    return row;
  }));
  renderScoreboard();
}

function scoreButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `score-button ${className}`;
  button.textContent = label;
  button.addEventListener("click", action, { once: true });
  return button;
}

function renderBossRound() {
  const board = state.game.boards[state.session.boardIndex];
  const column = board.columns[0];
  const clue = column.clues[0];
  const card = document.createElement("div");
  card.className = "boss-card";
  const stage = document.createElement("div");
  stage.className = "boss-stage";
  stage.append(card);
  elements.playStage.replaceChildren(stage);

  if (state.session.bossPhase === "category") {
    card.innerHTML = `<div class="boss-symbol" aria-hidden="true">✦</div><div class="eyebrow">Boss topic</div><h2>${escapeHtml(column.topic || "Untitled topic")}</h2><p>The topic is revealed first. Next, every active player locks in a wager.</p><div class="boss-actions"><button class="button primary" id="begin-wagers" type="button">Begin wagering</button></div>`;
    $("#begin-wagers").addEventListener("click", () => { state.session.bossPhase = "wager"; renderBossRound(); });
  } else if (state.session.bossPhase === "wager") {
    const active = state.session.players.filter((player) => !player.eliminated);
    card.innerHTML = `<div class="eyebrow">Boss round · Wager</div><h2>Make it count.</h2><p>Each player wagers from 1 point up to their current score.</p><form id="wager-form" class="boss-form"></form>`;
    const form = $("#wager-form");
    active.forEach((player) => {
      const row = document.createElement("div");
      row.className = "boss-player-row";
      if (player.points < 1) {
        row.innerHTML = `<label><strong>${escapeHtml(player.name)}</strong><small>0 points · no valid wager</small></label><input value="0" disabled aria-label="${escapeHtml(player.name)} has no valid wager">`;
      } else {
        row.innerHTML = `<label for="wager-${player.id}"><strong>${escapeHtml(player.name)}</strong><small>${player.points.toLocaleString()} points available</small></label><input id="wager-${player.id}" data-player="${player.id}" type="number" min="1" max="${player.points}" step="1" value="${Math.min(200, player.points)}" required>`;
      }
      form.append(row);
    });
    const actions = document.createElement("div");
    actions.className = "boss-actions";
    actions.innerHTML = `<button class="button primary" type="submit">Lock all wagers</button>`;
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        form.querySelectorAll("input[data-player]").forEach((input) => setWager(state.session.players[Number(input.dataset.player)], Number(input.value)));
        state.session.bossPhase = "clue";
        renderBossRound();
      } catch (error) {
        toast(error.message, true);
      }
    });
  } else if (state.session.bossPhase === "clue") {
    card.innerHTML = `<div class="eyebrow">${escapeHtml(column.topic)}</div>${clue.image ? `<img class="boss-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}<h2>${formatText(clue.clue || "No clue was provided.")}</h2><p>Wagers are locked. Give every player time to think before collecting responses.</p><div class="boss-actions"><button class="button primary" id="collect-guesses" type="button">Collect responses</button></div>`;
    $("#collect-guesses").addEventListener("click", () => { state.session.bossPhase = "guess"; renderBossRound(); });
  } else if (state.session.bossPhase === "guess") {
    const eligible = state.session.players.filter((player) => !player.eliminated && player.wager);
    card.innerHTML = `<div class="eyebrow">Boss round · Responses</div><h2>What’s your answer?</h2><p>Every wagering player submits a response before the correct one is shown.</p><form id="guess-form" class="boss-form"></form>`;
    const form = $("#guess-form");
    eligible.forEach((player) => {
      const row = document.createElement("div");
      row.className = "boss-player-row";
      row.innerHTML = `<label for="guess-${player.id}"><strong>${escapeHtml(player.name)}</strong><small>Wagered ${player.wager.toLocaleString()}</small></label><input id="guess-${player.id}" data-player="${player.id}" value="${escapeHtml(player.guess)}" required autocomplete="off">`;
      form.append(row);
    });
    const actions = document.createElement("div");
    actions.className = "boss-actions";
    actions.innerHTML = `<button class="button primary" type="submit">Reveal correct response</button>`;
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.querySelectorAll("input[data-player]").forEach((input) => { state.session.players[Number(input.dataset.player)].guess = input.value.trim(); });
      state.session.bossPhase = "grade";
      renderBossRound();
    });
  } else {
    renderBossGrading(card, clue);
  }
}

function renderBossGrading(card, clue) {
  const eligible = state.session.players.filter((player) => !player.eliminated && player.wager);
  card.innerHTML = `<div class="eyebrow">Correct response</div><h2>${formatText(clue.answer || "No response was provided.")}</h2>${answerDetails(clue)}<p>Mark each response. Correct players win their wager; incorrect players lose it.</p><div class="grading-list" id="grading-list"></div><div class="boss-actions"><button class="button primary" id="finish-boss" type="button">${state.session.boardIndex === state.game.boards.length - 1 ? "Finish game" : "Next round →"}</button></div>`;
  const list = $("#grading-list");
  list.replaceChildren(...eligible.map((player) => {
    const row = document.createElement("div");
    row.className = `grading-row${player.graded ? " graded" : ""}`;
    row.innerHTML = `<div><strong>${escapeHtml(player.name)}</strong><p>“${escapeHtml(player.guess)}” · wager ${player.wager.toLocaleString()}</p></div>`;
    const incorrect = scoreButton("Incorrect", "negative", () => gradeAndRender(player, false));
    const correct = scoreButton("Correct", "positive", () => gradeAndRender(player, true));
    incorrect.disabled = player.graded;
    correct.disabled = player.graded;
    row.append(incorrect, correct);
    return row;
  }));
  const finish = $("#finish-boss");
  finish.disabled = eligible.some((player) => !player.graded);
  finish.addEventListener("click", nextRound);
}

function gradeAndRender(player, correct) {
  gradeBossGuess(player, correct);
  renderScoreboard();
  renderBossRound();
  if (player.eliminated) toast(`${player.name} has been eliminated.`);
}

function nextRound() {
  if (state.session.boardIndex >= state.game.boards.length - 1) {
    renderFinal();
    return;
  }
  state.session.boardIndex += 1;
  state.session.bossPhase = "category";
  for (const player of state.session.players) {
    player.wager = null;
    player.guess = "";
    player.graded = false;
  }
  renderPlayRound();
}

function renderFinal() {
  const ranked = [...state.session.players].sort((a, b) => b.points - a.points);
  if (state.hostedRoom) closeHostedRoom({ quiet: true });
  elements.playKicker.textContent = "Game complete";
  elements.playStage.innerHTML = `<div class="final-stage"><div class="final-card"><div class="boss-symbol" aria-hidden="true">★</div><div class="eyebrow">Final standings</div><h2>${escapeHtml(ranked[0].name)} wins!</h2><div class="final-standings">${ranked.map((player, index) => `<div class="standing"><strong>${index + 1}. ${escapeHtml(player.name)}</strong><span>${player.points.toLocaleString()} points</span></div>`).join("")}</div>${state.publishedGameId ? `<div class="rate-game"><strong>How was this game?</strong><div><button class="rating-button" data-vote="1" type="button" aria-label="Thumbs up">👍</button><button class="rating-button" data-vote="-1" type="button" aria-label="Thumbs down">👎</button></div></div>` : ""}<button class="button primary" id="return-after-game" type="button">${state.returnView === "studio" ? "Return to studio" : "Back to games"}</button></div></div>`;
  document.querySelectorAll(".rating-button").forEach((button) => button.addEventListener("click", () => rateGame(Number(button.dataset.vote))));
  $("#return-after-game").addEventListener("click", () => switchView(state.returnView === "studio" ? "studio" : "library"));
}
