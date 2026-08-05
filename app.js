import {
  DIFFICULTIES,
  LIMITS,
  adjustScore,
  buzzTimer,
  createBoard,
  createBossBoard,
  createGame,
  createPlayers,
  difficultySymbol,
  exportBoard,
  exportGame,
  gradeBossGuess,
  isBossBoard,
  normalizeBoard,
  normalizeGame,
  resizeBoard,
  setWager,
} from "./core.mjs?v=0.3.1";
import { TriviaRoom } from "./api.mjs?v=0.3.1";

const STORAGE_KEY = "opentrivia.game.v0.2";
const LEGACY_STORAGE_KEY = "opentrivia.game.v0.1";
const LOCAL_LIBRARY_KEY = "opentrivia.library.v0.2";
const VOTER_KEY = "opentrivia.voter.v0.2";
const $ = (selector) => document.querySelector(selector);
const elements = {
  library: $("#library-view"), studio: $("#studio-view"), setup: $("#play-setup-view"),
  join: $("#join-view"), host: $("#host-view"), play: $("#play-view"),
  editorActions: $("#editor-actions"), exitPlay: $("#exit-play-button"), boardList: $("#board-list"),
  editorBoard: $("#editor-board"), gameName: $("#game-name"), playerCount: $("#player-count"),
  difficulty: $("#difficulty"), heroInput: $("#hero-image-input"), heroPreview: $("#hero-image-preview"),
  rowCount: $("#row-count"), columnCount: $("#column-count"), roundCount: $("#round-count"),
  roundKicker: $("#round-kicker"), studioTitle: $("#studio-title"), studioHelp: $("#studio-help"),
  sizeControls: $("#size-controls"), deleteBoard: $("#delete-board-button"), clueDialog: $("#clue-dialog"),
  clueForm: $("#clue-form"), fileInput: $("#file-input"), exportMenu: $("#export-menu"),
  exportButton: $("#export-button"), playerFields: $("#player-name-fields"), startingPoints: $("#starting-points"),
  scoreboard: $("#scoreboard"), playStage: $("#play-stage"), playKicker: $("#play-kicker"),
  playGameName: $("#play-game-name"), cardDialog: $("#card-dialog"), cardContent: $("#card-dialog-content"),
  toastRegion: $("#toast-region"), gameGrid: $("#game-grid"), libraryStatus: $("#library-status"),
  joinResult: $("#join-result"), roomCode: $("#room-code"), hostCode: $("#host-code"),
  joinPlayerName: $("#join-player-name"), hostPlayerList: $("#host-player-list"),
};

let game = loadGame();
let authoredGame = game;
let selectedBoard = 0;
let editingClue = null;
let session = null;
let returnView = "studio";
let publishedGameId = null;
let hostedRoom = null;
let pendingClueImage = "";
let currentView = "library";
let joinedRoom = null;
let hostRoomSnapshot = null;
let roomPollTimer = null;
let timerTick = null;
let hostClueLocation = null;
const localRoomObjects = new Map();

function loadGame() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeGame(JSON.parse(saved)) : createGame();
  } catch {
    return createGame();
  }
}

function voterId() {
  let id = localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(body.error || `Request failed (${response.status}).`);
    requestError.status = response.status;
    throw requestError;
  }
  return body;
}

function allowsLocalFallback(error) {
  return error instanceof TypeError || [404, 501, 503].includes(error?.status);
}

function localLibrary() {
  try { return JSON.parse(localStorage.getItem(LOCAL_LIBRARY_KEY) || "[]"); }
  catch { return []; }
}

function saveGame() {
  game.size = game.boards.length;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}

function fillNumberOptions(select, minimum, maximum) {
  select.replaceChildren(...Array.from({ length: maximum - minimum + 1 }, (_, index) => {
    const option = document.createElement("option");
    option.value = String(minimum + index);
    option.textContent = String(minimum + index);
    return option;
  }));
}

fillNumberOptions(elements.playerCount, LIMITS.minPlayers, LIMITS.maxPlayers);
fillNumberOptions(elements.rowCount, LIMITS.minRows, LIMITS.maxRows);
fillNumberOptions(elements.columnCount, LIMITS.minColumns, LIMITS.maxColumns);

function renderStudio() {
  const board = game.boards[selectedBoard];
  const boss = isBossBoard(board);
  elements.gameName.value = game.name;
  elements.playerCount.value = String(game.num_players);
  elements.difficulty.value = game.difficulty;
  elements.heroPreview.src = game.hero_image || "";
  elements.heroPreview.hidden = !game.hero_image;
  $("#hero-image-copy").hidden = Boolean(game.hero_image);
  $("#remove-hero-button").hidden = !game.hero_image;
  elements.roundCount.textContent = String(game.boards.length);
  elements.deleteBoard.disabled = game.boards.length === 1;
  elements.roundKicker.textContent = `Round ${selectedBoard + 1} · ${boss ? "Boss" : "Standard"}`;
  elements.studioTitle.textContent = boss ? "Build the Boss round" : "Build your board";
  elements.studioHelp.textContent = boss
    ? "The topic appears first; wagers are locked before the clue is revealed."
    : "Name each topic, then open a card to add its clue and response.";
  elements.rowCount.closest("label").hidden = boss;
  elements.columnCount.closest("label").hidden = boss;
  if (!boss) {
    elements.rowCount.value = String(Math.max(...board.columns.map((column) => column.size)));
    elements.columnCount.value = String(board.columns.length);
  }
  renderBoardList();
  renderEditorBoard();
}

function renderBoardList() {
  elements.boardList.replaceChildren(...game.boards.map((board, index) => {
    const boss = isBossBoard(board);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `board-list-item${index === selectedBoard ? " active" : ""}${boss ? " boss" : ""}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", index === selectedBoard ? "true" : "false");
    const topic = board.columns[0]?.topic?.trim();
    button.innerHTML = `<span class="round-number">${boss ? "✦" : index + 1}</span><span><span class="round-label">${escapeHtml(topic || `Round ${index + 1}`)}</span><span class="round-type">${boss ? "Boss round" : `${board.columns.length} topics`}</span></span>`;
    button.addEventListener("click", () => { selectedBoard = index; renderStudio(); });
    return button;
  }));
}

function renderEditorBoard() {
  const board = game.boards[selectedBoard];
  const boss = isBossBoard(board);
  const rows = Math.max(...board.columns.map((column) => column.size));
  const columns = board.columns.length;
  elements.editorBoard.style.gridTemplateColumns = `repeat(${columns}, minmax(100px, 1fr))`;
  const nodes = [];
  board.columns.forEach((column, columnIndex) => {
    const input = document.createElement("input");
    input.className = "topic-input";
    input.value = column.topic;
    input.placeholder = `Topic ${columnIndex + 1}`;
    input.maxLength = 80;
    input.setAttribute("aria-label", `Column ${columnIndex + 1} topic`);
    input.addEventListener("input", () => { column.topic = input.value; saveGame(); renderBoardList(); });
    nodes.push(input);
  });
  for (let row = 0; row < rows; row += 1) {
    board.columns.forEach((column, columnIndex) => {
      if (row >= column.size) {
        const blank = document.createElement("span");
        blank.setAttribute("aria-hidden", "true");
        nodes.push(blank);
        return;
      }
      const clue = column.clues[row];
      const complete = clue.answer.trim() && clue.question.trim();
      const button = document.createElement("button");
      button.type = "button";
      button.className = `clue-cell ${complete ? "complete" : "empty"}`;
      button.textContent = boss ? "Edit clue" : clue.value.toLocaleString();
      button.setAttribute("aria-label", boss
        ? `${column.topic || "Boss topic"} clue${complete ? ", complete" : ", needs content"}`
        : `${column.topic || `Topic ${columnIndex + 1}`} for ${clue.value} points${complete ? ", complete" : ", needs content"}`);
      button.addEventListener("click", () => openClueEditor(columnIndex, row));
      nodes.push(button);
    });
  }
  elements.editorBoard.replaceChildren(...nodes);
}

function openClueEditor(columnIndex, row) {
  editingClue = { columnIndex, row };
  const column = game.boards[selectedBoard].columns[columnIndex];
  const clue = column.clues[row];
  const boss = isBossBoard(game.boards[selectedBoard]);
  $("#clue-location").textContent = boss
    ? `${column.topic || "Boss topic"} · Wager round`
    : `${column.topic || `Topic ${columnIndex + 1}`} · ${clue.value.toLocaleString()}`;
  $("#clue-value-field").hidden = boss;
  $("#clue-value").required = !boss;
  $("#clue-value").value = boss ? "" : clue.value;
  $("#clue-answer").value = clue.answer;
  $("#clue-question").value = clue.question;
  pendingClueImage = clue.image || "";
  renderClueImagePreview();
  elements.clueDialog.showModal();
  $("#clue-answer").focus();
}

function renderClueImagePreview() {
  const preview = $("#clue-image-preview");
  preview.src = pendingClueImage;
  preview.hidden = !pendingClueImage;
  $("#remove-clue-image").hidden = !pendingClueImage;
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("That image could not be read.")));
    reader.readAsDataURL(blob);
  });
}

async function readImage(file) {
  if (!file?.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 8_000_000) throw new Error("Images must be 8 MB or smaller.");
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1280 / bitmap.width, 720 / bitmap.height);
  let output;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    output = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82 - attempt * 0.12));
    if (output.size <= 350_000) break;
    scale *= 0.75;
  }
  bitmap.close();
  return blobAsDataUrl(output);
}

function addBoard(boss = false) {
  game.boards.push(boss ? createBossBoard() : createBoard());
  game.size = game.boards.length;
  selectedBoard = game.boards.length - 1;
  saveGame();
  renderStudio();
  toast(`${boss ? "Boss" : "Standard"} round added.`);
}

function updateBoardSize() {
  const rows = Number(elements.rowCount.value);
  const columns = Number(elements.columnCount.value);
  resizeBoard(game.boards[selectedBoard], rows, columns);
  saveGame();
  renderStudio();
}

function downloadJson(filename, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name) {
  return (name || "opentrivia").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "opentrivia";
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data && typeof data === "object" && "game" in data) {
      game = normalizeGame(data);
      authoredGame = game;
      selectedBoard = 0;
      toast(`Imported “${game.name}”.`);
    } else if (data && typeof data === "object" && "board" in data) {
      game.boards.push(normalizeBoard(data));
      game.size = game.boards.length;
      selectedBoard = game.boards.length - 1;
      toast("Board imported as a new round.");
    } else {
      throw new Error("Choose a JSON file containing a top-level “game” or “board” object.");
    }
    saveGame();
    renderStudio();
  } catch (error) {
    toast(error instanceof Error ? error.message : "That file could not be imported.", true);
  } finally {
    elements.fileInput.value = "";
  }
}

function showSetup(source = "studio", gameId = null) {
  if (source === "studio") {
    game.name = elements.gameName.value.trim() || "Untitled game";
    saveGame();
  }
  returnView = source === "studio" ? "studio" : source === "host" ? "host" : "library";
  publishedGameId = gameId;
  elements.playerFields.replaceChildren(...Array.from({ length: game.num_players }, (_, index) => {
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
    session = {
      players,
      boardIndex: 0,
      used: game.boards.map((board) => board.columns.map((column) => column.clues.map(() => false))),
      bossPhase: "category",
    };
    elements.playGameName.textContent = game.name;
    if (publishedGameId) api(`/api/games/${publishedGameId}/plays`, { method: "POST" }).catch(() => recordLocalPlay(publishedGameId));
    switchView("play");
    renderPlayRound();
  } catch (error) {
    toast(error.message, true);
  }
}

function switchView(view) {
  if (view === "studio" && game !== authoredGame) game = authoredGame;
  currentView = view;
  for (const name of ["library", "studio", "setup", "join", "host", "play"]) elements[name].hidden = view !== name;
  elements.editorActions.hidden = view !== "studio";
  elements.exitPlay.hidden = !["setup", "play", "host"].includes(view);
  document.querySelectorAll(".main-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "studio") renderStudio();
  if (view === "library") loadLibrary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderScoreboard() {
  elements.scoreboard.replaceChildren(...session.players.map((player) => {
    const chip = document.createElement("div");
    chip.className = `score-chip${player.eliminated ? " eliminated" : ""}`;
    chip.innerHTML = `<strong>${escapeHtml(player.name)}</strong><span>${player.points.toLocaleString()}</span>`;
    return chip;
  }));
}

function renderPlayRound() {
  const board = game.boards[session.boardIndex];
  elements.playKicker.textContent = `Round ${session.boardIndex + 1} of ${game.boards.length} · ${isBossBoard(board) ? "Boss" : "Standard"}`;
  renderScoreboard();
  if (isBossBoard(board)) renderBossRound();
  else renderStandardRound();
}

function renderStandardRound() {
  const board = game.boards[session.boardIndex];
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
        const used = session.used[session.boardIndex][columnIndex][row];
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
  const usedCount = session.used[session.boardIndex].flat().filter(Boolean).length;
  const total = board.columns.reduce((sum, column) => sum + column.size, 0);
  const footer = document.createElement("div");
  footer.className = "round-footer";
  footer.innerHTML = `<span>${usedCount} of ${total} cards played</span>`;
  const next = document.createElement("button");
  next.className = "button primary";
  next.type = "button";
  next.textContent = session.boardIndex === game.boards.length - 1 ? "Finish game" : "Next round →";
  next.disabled = usedCount < total;
  next.addEventListener("click", nextRound);
  footer.append(next);
  elements.playStage.replaceChildren(grid, footer);
}

function openPlayCard(columnIndex, row) {
  if (session.hosted) {
    openHostedPlayCard(columnIndex, row);
    return;
  }
  const board = game.boards[session.boardIndex];
  const column = board.columns[columnIndex];
  const clue = column.clues[row];
  session.used[session.boardIndex][columnIndex][row] = true;
  elements.cardContent.innerHTML = `
    <div class="dialog-topline">
      <div class="eyebrow">${escapeHtml(column.topic)} · ${clue.value.toLocaleString()} points</div>
      <button class="icon-button" id="dismiss-card-button" type="button" aria-label="Close card">×</button>
    </div>
    <h2>Clue</h2>
    ${clue.image ? `<img class="play-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}
    <p class="revealed-answer">${formatText(clue.answer || "No clue was provided.")}</p>
    <button class="button secondary" id="reveal-response-button" type="button">Reveal correct response</button>
    <div id="response-area" hidden></div>`;
  $("#dismiss-card-button").addEventListener("click", () => elements.cardDialog.close());
  $("#reveal-response-button").addEventListener("click", (event) => {
    event.currentTarget.hidden = true;
    const response = $("#response-area");
    response.hidden = false;
    response.innerHTML = `<div class="correct-response"><strong>Correct response</strong><br>${formatText(clue.question || "No response was provided.")}</div><div class="scoring-grid" id="normal-scoring"></div><div class="dialog-actions"><button class="button primary" id="close-card-button" type="button">Back to board</button></div>`;
    renderNormalScoring($("#normal-scoring"), clue.value);
    $("#close-card-button").addEventListener("click", () => { elements.cardDialog.close(); renderPlayRound(); });
  });
  elements.cardDialog.showModal();
}

function renderNormalScoring(container, value) {
  container.replaceChildren(...session.players.map((player) => {
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
  const board = game.boards[session.boardIndex];
  const column = board.columns[0];
  const clue = column.clues[0];
  const card = document.createElement("div");
  card.className = "boss-card";
  const stage = document.createElement("div");
  stage.className = "boss-stage";
  stage.append(card);
  elements.playStage.replaceChildren(stage);

  if (session.bossPhase === "category") {
    card.innerHTML = `<div class="boss-symbol" aria-hidden="true">✦</div><div class="eyebrow">Boss topic</div><h2>${escapeHtml(column.topic || "Untitled topic")}</h2><p>The topic is revealed first. Next, every active player locks in a wager.</p><div class="boss-actions"><button class="button primary" id="begin-wagers" type="button">Begin wagering</button></div>`;
    $("#begin-wagers").addEventListener("click", () => { session.bossPhase = "wager"; renderBossRound(); });
  } else if (session.bossPhase === "wager") {
    const active = session.players.filter((player) => !player.eliminated);
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
        form.querySelectorAll("input[data-player]").forEach((input) => setWager(session.players[Number(input.dataset.player)], Number(input.value)));
        session.bossPhase = "clue";
        renderBossRound();
      } catch (error) { toast(error.message, true); }
    });
  } else if (session.bossPhase === "clue") {
    card.innerHTML = `<div class="eyebrow">${escapeHtml(column.topic)}</div>${clue.image ? `<img class="boss-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}<h2>${formatText(clue.answer || "No clue was provided.")}</h2><p>Wagers are locked. Give every player time to think before collecting responses.</p><div class="boss-actions"><button class="button primary" id="collect-guesses" type="button">Collect responses</button></div>`;
    $("#collect-guesses").addEventListener("click", () => { session.bossPhase = "guess"; renderBossRound(); });
  } else if (session.bossPhase === "guess") {
    const eligible = session.players.filter((player) => !player.eliminated && player.wager);
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
      form.querySelectorAll("input[data-player]").forEach((input) => { session.players[Number(input.dataset.player)].guess = input.value.trim(); });
      session.bossPhase = "grade";
      renderBossRound();
    });
  } else {
    renderBossGrading(card, clue);
  }
}

function renderBossGrading(card, clue) {
  const eligible = session.players.filter((player) => !player.eliminated && player.wager);
  card.innerHTML = `<div class="eyebrow">Correct response</div><h2>${formatText(clue.question || "No response was provided.")}</h2><p>Mark each response. Correct players win their wager; incorrect players lose it.</p><div class="grading-list" id="grading-list"></div><div class="boss-actions"><button class="button primary" id="finish-boss" type="button">${session.boardIndex === game.boards.length - 1 ? "Finish game" : "Next round →"}</button></div>`;
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
  if (session.boardIndex >= game.boards.length - 1) {
    renderFinal();
    return;
  }
  session.boardIndex += 1;
  session.bossPhase = "category";
  for (const player of session.players) {
    player.wager = null;
    player.guess = "";
    player.graded = false;
  }
  renderPlayRound();
}

function renderFinal() {
  const ranked = [...session.players].sort((a, b) => b.points - a.points);
  if (hostedRoom) closeHostedRoom({ quiet: true });
  elements.playKicker.textContent = "Game complete";
  elements.playStage.innerHTML = `<div class="final-stage"><div class="final-card"><div class="boss-symbol" aria-hidden="true">★</div><div class="eyebrow">Final standings</div><h2>${escapeHtml(ranked[0].name)} wins!</h2><div class="final-standings">${ranked.map((player, index) => `<div class="standing"><strong>${index + 1}. ${escapeHtml(player.name)}</strong><span>${player.points.toLocaleString()} points</span></div>`).join("")}</div>${publishedGameId ? `<div class="rate-game"><strong>How was this game?</strong><div><button class="rating-button" data-vote="1" type="button" aria-label="Thumbs up">👍</button><button class="rating-button" data-vote="-1" type="button" aria-label="Thumbs down">👎</button></div></div>` : ""}<button class="button primary" id="return-after-game" type="button">${returnView === "studio" ? "Return to studio" : "Back to games"}</button></div></div>`;
  document.querySelectorAll(".rating-button").forEach((button) => button.addEventListener("click", () => rateGame(Number(button.dataset.vote))));
  $("#return-after-game").addEventListener("click", () => switchView(returnView === "studio" ? "studio" : "library"));
}

function recordLocalPlay(id) {
  const games = localLibrary();
  const item = games.find((entry) => entry.id === id);
  if (!item) return;
  item.plays = [...(item.plays || []), Date.now()];
  localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(games));
}

function summarizeLocal(entry) {
  return {
    id: entry.id,
    title: entry.game.name,
    hero_image: entry.game.hero_image,
    difficulty: entry.game.difficulty,
    score: entry.score || 0,
    weekly_plays: (entry.plays || []).filter((playedAt) => playedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000).length,
  };
}

async function loadLibrary() {
  elements.libraryStatus.textContent = "Loading the library…";
  try {
    const result = await api("/api/games");
    renderLibrary(result.games);
    elements.libraryStatus.textContent = `${result.games.length} public game${result.games.length === 1 ? "" : "s"}, powered by D1.`;
  } catch {
    const games = localLibrary().map(summarizeLocal);
    renderLibrary(games);
    elements.libraryStatus.textContent = games.length
      ? `${games.length} game${games.length === 1 ? "" : "s"} saved in this local preview.`
      : "No games yet. Create and publish the first one.";
  }
}

function renderLibrary(games) {
  if (!games.length) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.innerHTML = `<div aria-hidden="true">✦</div><h3>The shelves are waiting.</h3><p>Build a game, add a great cover, and publish it for everyone to play.</p><button class="button primary" type="button">Create the first game</button>`;
    empty.querySelector("button").addEventListener("click", () => switchView("studio"));
    elements.gameGrid.replaceChildren(empty);
    return;
  }
  elements.gameGrid.replaceChildren(...games.map((entry) => {
    const card = document.createElement("article");
    card.className = "game-card";
    const image = entry.hero_image
      ? `<img class="game-card-image" src="${escapeHtml(entry.hero_image)}" alt="">`
      : `<div class="game-card-image game-card-placeholder" aria-hidden="true"><span>?</span></div>`;
    card.innerHTML = `${image}<div class="game-card-body"><div class="difficulty ${escapeHtml(entry.difficulty)}"><span aria-hidden="true">${difficultySymbol(entry.difficulty)}</span> ${escapeHtml(entry.difficulty)}</div><h3>${escapeHtml(entry.title)}</h3><div class="game-stats"><span title="Community score">👍 ${Number(entry.score).toLocaleString()}</span><span title="Plays in the past seven days">▶ ${Number(entry.weekly_plays).toLocaleString()} this week</span></div><div class="game-card-actions"><button class="button secondary" data-action="host" type="button">Host</button><button class="button primary" data-action="play" type="button">Play</button></div></div>`;
    card.querySelector('[data-action="play"]').addEventListener("click", () => playPublished(entry.id));
    card.querySelector('[data-action="host"]').addEventListener("click", () => hostPublished(entry.id));
    return card;
  }));
}

async function getPublishedGame(id) {
  try {
    const result = await api(`/api/games/${id}`);
    return result.game.data;
  } catch (remoteError) {
    const entry = localLibrary().find((item) => item.id === id);
    if (entry) return entry.game;
    throw remoteError;
  }
}

async function playPublished(id) {
  try {
    const selected = normalizeGame(await getPublishedGame(id));
    authoredGame = currentView === "studio" ? game : authoredGame;
    game = selected;
    showSetup("library", id);
  } catch (error) { toast(error.message, true); }
}

async function publishGame() {
  game.name = elements.gameName.value.trim() || "Untitled game";
  saveGame();
  const clean = normalizeGame({ ...game, size: game.boards.length });
  try {
    const result = await api("/api/games", { method: "POST", body: JSON.stringify({ game: clean }) });
    toast(`“${result.game.title}” is now public.`);
  } catch (error) {
    if (!allowsLocalFallback(error)) {
      toast(error.message, true);
      return;
    }
    const games = localLibrary();
    const entry = { id: crypto.randomUUID(), game: clean, score: 0, votes: {}, plays: [], created_at: Date.now() };
    games.unshift(entry);
    localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(games));
    toast(`“${clean.name}” was published to this local preview.`);
  }
  switchView("library");
}

function localRoomStore() {
  try { return JSON.parse(localStorage.getItem("opentrivia.rooms.v0.3") || "{}"); }
  catch { return {}; }
}

function saveLocalRooms(rooms) {
  localStorage.setItem("opentrivia.rooms.v0.3", JSON.stringify(rooms));
}

function localRoomObject(code) {
  if (localRoomObjects.has(code)) return localRoomObjects.get(code);
  const storage = {
    async get(key) { return key === "room" ? localRoomStore()[code] : undefined; },
    async put(key, value) {
      if (key !== "room") return;
      const rooms = localRoomStore();
      rooms[code] = value;
      saveLocalRooms(rooms);
    },
    async deleteAll() {
      const rooms = localRoomStore();
      delete rooms[code];
      saveLocalRooms(rooms);
    },
    async setAlarm() {},
    async deleteAlarm() {},
  };
  const object = new TriviaRoom({ storage });
  localRoomObjects.set(code, object);
  return object;
}

async function localRoomFetch(code, action = "", options = {}) {
  const response = await localRoomObject(code).fetch(new Request(`https://room/${action}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...(options.body === undefined ? {} : { body: options.body }),
  }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(result.error || `Request failed (${response.status}).`);
    requestError.status = response.status;
    throw requestError;
  }
  return result;
}

async function makeLocalRoom(selected) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const rooms = localRoomStore();
  let code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  while (rooms[code]) {
    const retry = crypto.getRandomValues(new Uint8Array(6));
    code = [...retry].map((byte) => alphabet[byte % alphabet.length]).join("");
  }
  const created = await localRoomFetch(code, "create", { method: "POST", body: JSON.stringify({ game: selected }) });
  return { code, ...created };
}

async function roomRequest(code, action = "", options = {}) {
  const path = `/api/rooms/${code}${action ? `/${action}` : ""}`;
  try {
    return await api(path, options);
  } catch (remoteError) {
    if (!allowsLocalFallback(remoteError)) throw remoteError;
    return localRoomFetch(code, action, options);
  }
}

async function hostPublished(id) {
  try {
    const selected = normalizeGame(await getPublishedGame(id));
    authoredGame = currentView === "studio" ? game : authoredGame;
    game = selected;
    try {
      hostedRoom = await api("/api/rooms", { method: "POST", body: JSON.stringify({ game: selected }) });
    } catch (error) {
      if (!allowsLocalFallback(error)) throw error;
      hostedRoom = await makeLocalRoom(selected);
    }
    hostedRoom.gameId = id;
    elements.hostCode.textContent = hostedRoom.code;
    $("#host-game-name").textContent = `Hosting “${selected.name}”`;
    renderHostPlayers({ players: [], started: false });
    switchView("host");
    scheduleRoomPoll("host", 0);
  } catch (error) { toast(error.message, true); }
}

async function closeHostedRoom({ quiet = false } = {}) {
  if (!hostedRoom) return;
  const room = hostedRoom;
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
  hostedRoom = null;
  hostRoomSnapshot = null;
  stopRoomPolling();
  if (!quiet) {
    toast("Room closed.");
    switchView("library");
  }
}

async function joinRoom(code, name) {
  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (normalized.length !== 6) throw new Error("Enter the complete six-character room code.");
  const result = await roomRequest(normalized, "players", { method: "POST", body: JSON.stringify({ name }) });
  joinedRoom = { code: normalized, player_id: result.player_id, player_token: result.player_token, revision: -1 };
  scheduleRoomPoll("player", 0);
  return result.room;
}

function hostHeaders() {
  return { "x-host-token": hostedRoom?.host_token || "" };
}

function playerHeaders() {
  return { "x-player-token": joinedRoom?.player_token || "" };
}

function stopRoomPolling() {
  clearTimeout(roomPollTimer);
  roomPollTimer = null;
}

function scheduleRoomPoll(role, delay = 600) {
  stopRoomPolling();
  roomPollTimer = setTimeout(async () => {
    const connection = role === "host" ? hostedRoom : joinedRoom;
    if (!connection) return;
    try {
      const result = await roomRequest(connection.code, "", {
        headers: role === "host" ? hostHeaders() : playerHeaders(),
      });
      if (role === "host") syncHostRoom(result.room);
      else syncPlayerRoom(result.room);
    } catch (error) {
      if (error.status === 404) {
        if (role === "host") hostedRoom = null;
        else renderPlayerDisconnected(error.message);
        return;
      }
    }
    scheduleRoomPoll(role);
  }, delay);
}

function renderHostPlayers(room) {
  const expected = game.num_players;
  const names = room.players.map((player) => `<span>${escapeHtml(player.name)}</span>`).join("");
  elements.hostPlayerList.innerHTML = `<strong>${room.players.length} of ${expected} players joined</strong><div>${names || "Waiting for players…"}</div>`;
  const start = $("#host-start-button");
  start.disabled = room.started || room.players.length < 2;
  start.textContent = room.started ? "Game started" : room.players.length < 2 ? "Waiting for players" : "Start hosting";
}

function syncHostRoom(room) {
  hostRoomSnapshot = room;
  if (currentView === "host") renderHostPlayers(room);
  if (!session?.hosted) return;
  session.players = room.players.map((serverPlayer) => {
    const local = session.players.find((player) => player.id === serverPlayer.id) || {};
    return { ...local, ...serverPlayer, eliminated: false, wager: local.wager ?? null, guess: local.guess ?? "", graded: local.graded ?? false };
  });
  session.used = room.used;
  renderScoreboard();
  if (room.active_clue && hostClueLocation) {
    renderHostedClue(room);
  } else if (!room.active_clue && hostClueLocation) {
    hostClueLocation = null;
    if (elements.cardDialog.open) elements.cardDialog.close();
    renderPlayRound();
  }
}

async function launchHostedGame() {
  if (!hostedRoom) return;
  try {
    const result = await roomRequest(hostedRoom.code, "start", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ starting_points: 1000 }),
    });
    hostRoomSnapshot = result.room;
    returnView = "host";
    publishedGameId = hostedRoom.gameId || null;
    session = {
      players: result.room.players.map((player) => ({ ...player, eliminated: false, wager: null, guess: "", graded: false })),
      boardIndex: 0,
      used: result.room.used,
      bossPhase: "category",
      hosted: true,
    };
    elements.playGameName.textContent = game.name;
    if (publishedGameId) api(`/api/games/${publishedGameId}/plays`, { method: "POST" }).catch(() => recordLocalPlay(publishedGameId));
    switchView("play");
    renderPlayRound();
    scheduleRoomPoll("host", 0);
  } catch (error) {
    toast(error.message, true);
  }
}

async function openHostedPlayCard(columnIndex, row) {
  try {
    const result = await roomRequest(hostedRoom.code, "clues", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ board_index: session.boardIndex, column_index: columnIndex, row }),
    });
    hostClueLocation = { boardIndex: session.boardIndex, columnIndex, row };
    if (!elements.cardDialog.open) elements.cardDialog.showModal();
    syncHostRoom(result.room);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderHostedClue(room) {
  const active = room.active_clue;
  if (!active || !hostClueLocation) return;
  const board = game.boards[active.board_index];
  const column = board.columns[active.column_index];
  const clue = column.clues[active.row];
  const previous = room.last_result && active.attempt > 1
    ? `<p class="attempt-notice">${escapeHtml(room.last_result.player_name)} ${room.last_result.outcome === "timeout" ? "ran out of time" : "was ruled incorrect"}. The clue is open again.</p>`
    : "";
  if (active.phase === "open") {
    elements.cardContent.innerHTML = `<div class="eyebrow">${escapeHtml(column.topic)} · ${clue.value.toLocaleString()} points</div><h2>Clue</h2>${previous}${clue.image ? `<img class="play-clue-image" src="${escapeHtml(clue.image)}" alt="Image for this clue">` : ""}<p class="revealed-answer">${formatText(clue.answer || "No clue was provided.")}</p><div class="buzz-open"><span class="live-dot" aria-hidden="true"></span> Buzzers are open${active.attempt > 1 ? ` · attempt ${active.attempt}` : ""}</div>`;
    return;
  }
  if (active.phase === "answering") {
    elements.cardContent.innerHTML = `<div class="eyebrow">First buzz</div><h2>${escapeHtml(active.buzzer.name)} buzzed first.</h2><p class="clue-hidden-note">The clue is hidden while ${escapeHtml(active.buzzer.name)} answers.</p><div class="buzz-timer" data-deadline="${active.deadline}">30</div><p>Waiting for an answer…</p>`;
    updateBuzzTimers();
    return;
  }
  elements.cardContent.innerHTML = `<div class="eyebrow">Answer submitted</div><h2>${escapeHtml(active.buzzer.name)} answered</h2><blockquote class="submitted-answer">${formatText(active.submitted_answer || "")}</blockquote><div class="correct-response"><strong>Correct response</strong><br>${formatText(clue.question || "No response was provided.")}</div><div class="ruling-actions"><button class="score-button negative" data-ruling="false" type="button">Incorrect · −${clue.value.toLocaleString()}</button><button class="score-button positive" data-ruling="true" type="button">Correct · +${clue.value.toLocaleString()}</button></div>`;
  elements.cardContent.querySelectorAll("[data-ruling]").forEach((button) => button.addEventListener("click", () => submitHostRuling(button.dataset.ruling === "true")));
}

async function submitHostRuling(correct) {
  elements.cardContent.querySelectorAll("[data-ruling]").forEach((button) => { button.disabled = true; });
  try {
    const result = await roomRequest(hostedRoom.code, "ruling", {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ correct }),
    });
    syncHostRoom(result.room);
  } catch (error) {
    toast(error.message, true);
  }
}

function syncPlayerRoom(room) {
  if (!joinedRoom || joinedRoom.revision === room.revision) return;
  joinedRoom.revision = room.revision;
  renderPlayerRoom(room);
}

function playerScoreboard(room) {
  return `<div class="player-scores">${room.players.map((player) => `<span${player.id === joinedRoom.player_id ? " class=\"you\"" : ""}>${escapeHtml(player.name)} <strong>${player.points.toLocaleString()}</strong></span>`).join("")}</div>`;
}

function renderPlayerRoom(room) {
  elements.joinResult.hidden = false;
  elements.joinResult.className = "join-result player-console";
  $("#join-form").hidden = true;
  const viewer = room.viewer || { id: joinedRoom.player_id, name: "Player" };
  if (!room.started) {
    elements.joinResult.innerHTML = `<div class="joined-check" aria-hidden="true">✓</div><div><strong>You’re in, ${escapeHtml(viewer.name)}.</strong><p>Waiting for the host to start “${escapeHtml(room.game.name)}”.</p>${playerScoreboard(room)}</div>`;
    return;
  }
  const active = room.active_clue;
  if (!active) {
    const result = room.last_result;
    const message = result ? `${escapeHtml(result.player_name)} ${result.outcome === "correct" ? "got it right" : result.outcome === "timeout" ? "ran out of time" : "was ruled incorrect"}.` : "Waiting for the host to choose a clue.";
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
    const result = await roomRequest(joinedRoom.code, "buzz", { method: "POST", headers: playerHeaders(), body: "{}" });
    joinedRoom.revision = -1;
    syncPlayerRoom(result.room);
  } catch (error) {
    toast(error.message, error.status !== 409);
    joinedRoom.revision = -1;
    scheduleRoomPoll("player", 0);
  }
}

async function submitPlayerAnswer(event) {
  event.preventDefault();
  const input = $("#player-answer");
  event.currentTarget.querySelector("button").disabled = true;
  try {
    const result = await roomRequest(joinedRoom.code, "answer", { method: "POST", headers: playerHeaders(), body: JSON.stringify({ answer: input.value }) });
    joinedRoom.revision = -1;
    syncPlayerRoom(result.room);
  } catch (error) {
    toast(error.message, true);
    event.currentTarget.querySelector("button").disabled = false;
  }
}

function updateBuzzTimers() {
  document.querySelectorAll(".buzz-timer[data-deadline]").forEach((element) => {
    const state = buzzTimer(Number(element.dataset.deadline));
    element.textContent = String(state.seconds);
    element.classList.toggle("overtime", state.overtime);
    element.setAttribute("aria-label", `${state.seconds} seconds remaining${state.overtime ? " in overtime" : ""}`);
  });
}

function renderPlayerDisconnected(message) {
  stopRoomPolling();
  joinedRoom = null;
  elements.joinResult.hidden = false;
  elements.joinResult.className = "join-result";
  elements.joinResult.innerHTML = `<div><strong>Room closed</strong><p>${escapeHtml(message)}</p></div>`;
  $("#join-form").hidden = false;
}

async function rateGame(value) {
  try {
    const result = await api(`/api/games/${publishedGameId}/vote`, { method: "POST", headers: { "x-opentrivia-voter": voterId() }, body: JSON.stringify({ value }) });
    toast(`Thanks! This game’s score is now ${result.score}.`);
  } catch {
    const games = localLibrary();
    const item = games.find((entry) => entry.id === publishedGameId);
    if (item) {
      const previous = item.votes?.[voterId()] || 0;
      item.score = (item.score || 0) - previous + value;
      item.votes = { ...(item.votes || {}), [voterId()]: value };
      localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(games));
      toast(`Thanks! This game’s score is now ${item.score}.`);
    } else toast("Your rating could not be saved.", true);
  }
  document.querySelectorAll(".rating-button").forEach((button) => { button.disabled = true; });
}

function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatText(value) { return escapeHtml(value).replace(/\n/g, "<br>"); }

elements.gameName.addEventListener("input", () => { game.name = elements.gameName.value; saveGame(); });
elements.playerCount.addEventListener("change", () => { game.num_players = Number(elements.playerCount.value); saveGame(); });
elements.difficulty.addEventListener("change", () => {
  if (DIFFICULTIES.includes(elements.difficulty.value)) game.difficulty = elements.difficulty.value;
  saveGame();
});
elements.heroInput.addEventListener("change", async () => {
  try {
    game.hero_image = await readImage(elements.heroInput.files[0]);
    saveGame();
    renderStudio();
  } catch (error) { toast(error.message, true); }
  elements.heroInput.value = "";
});
$("#remove-hero-button").addEventListener("click", () => { game.hero_image = ""; saveGame(); renderStudio(); });
elements.rowCount.addEventListener("change", updateBoardSize);
elements.columnCount.addEventListener("change", updateBoardSize);
$("#add-board-button").addEventListener("click", () => addBoard(false));
$("#add-boss-button").addEventListener("click", () => addBoard(true));
elements.deleteBoard.addEventListener("click", () => {
  if (game.boards.length === 1) return;
  game.boards.splice(selectedBoard, 1);
  selectedBoard = Math.min(selectedBoard, game.boards.length - 1);
  saveGame();
  renderStudio();
  toast("Round deleted.");
});
elements.clueForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const clue = game.boards[selectedBoard].columns[editingClue.columnIndex].clues[editingClue.row];
  if (isBossBoard(game.boards[selectedBoard])) delete clue.value;
  else clue.value = Number($("#clue-value").value);
  clue.answer = $("#clue-answer").value;
  clue.question = $("#clue-question").value;
  clue.image = pendingClueImage;
  saveGame();
  elements.clueDialog.close();
  renderEditorBoard();
  toast("Card saved.");
});
$("#clue-image-input").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  try { pendingClueImage = await readImage(input.files[0]); renderClueImagePreview(); }
  catch (error) { toast(error.message, true); }
  input.value = "";
});
$("#remove-clue-image").addEventListener("click", () => { pendingClueImage = ""; renderClueImagePreview(); });
$("#cancel-clue-button").addEventListener("click", () => elements.clueDialog.close());
$("#import-button").addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => { if (elements.fileInput.files[0]) importFile(elements.fileInput.files[0]); });
elements.exportButton.addEventListener("click", () => {
  elements.exportMenu.hidden = !elements.exportMenu.hidden;
  elements.exportButton.setAttribute("aria-expanded", String(!elements.exportMenu.hidden));
});
$("#export-board-button").addEventListener("click", () => {
  downloadJson(`${safeFilename(game.name)}-round-${selectedBoard + 1}.json`, exportBoard(game.boards[selectedBoard]));
  elements.exportMenu.hidden = true;
  elements.exportButton.setAttribute("aria-expanded", "false");
});
$("#export-game-button").addEventListener("click", () => {
  downloadJson(`${safeFilename(game.name)}.json`, exportGame(game));
  elements.exportMenu.hidden = true;
  elements.exportButton.setAttribute("aria-expanded", "false");
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrap")) {
    elements.exportMenu.hidden = true;
    elements.exportButton.setAttribute("aria-expanded", "false");
  }
});
$("#play-button").addEventListener("click", () => showSetup("studio"));
$("#publish-button").addEventListener("click", publishGame);
$("#cancel-setup-button").addEventListener("click", () => switchView(returnView));
$("#launch-button").addEventListener("click", launchGame);
elements.exitPlay.addEventListener("click", () => {
  if (currentView === "host") closeHostedRoom();
  else switchView(returnView);
});
$("#home-button").addEventListener("click", () => switchView("library"));
$("#hero-create-button").addEventListener("click", () => switchView("studio"));
$("#refresh-library-button").addEventListener("click", loadLibrary);
document.querySelectorAll(".main-nav button").forEach((button) => button.addEventListener("click", async () => {
  if (currentView === "host" && button.dataset.view !== "host") {
    await closeHostedRoom({ quiet: true });
    if (hostedRoom) return;
  }
  switchView(button.dataset.view);
}));
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
elements.hostCode.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(elements.hostCode.textContent); toast("Room code copied."); }
  catch { toast("Select the code and copy it to share."); }
});
$("#close-room-button").addEventListener("click", () => closeHostedRoom());
$("#host-start-button").addEventListener("click", launchHostedGame);
elements.cardDialog.addEventListener("close", () => {
  if (session && !elements.play.hidden && !hostClueLocation) renderPlayRound();
});
elements.cardDialog.addEventListener("cancel", (event) => {
  if (session?.hosted && hostClueLocation) event.preventDefault();
});
window.addEventListener("pagehide", () => {
  if (!hostedRoom) return;
  fetch(`/api/rooms/${hostedRoom.code}/close`, { method: "POST", headers: { "x-host-token": hostedRoom.host_token }, keepalive: true }).catch(() => {});
  const rooms = localRoomStore();
  delete rooms[hostedRoom.code];
  saveLocalRooms(rooms);
});

timerTick = setInterval(updateBuzzTimers, 250);
renderStudio();
switchView("library");
