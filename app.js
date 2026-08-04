import {
  LIMITS,
  adjustScore,
  createBoard,
  createBossBoard,
  createGame,
  createPlayers,
  exportBoard,
  exportGame,
  gradeBossGuess,
  isBossBoard,
  normalizeBoard,
  normalizeGame,
  resizeBoard,
  setWager,
} from "./core.mjs";

const STORAGE_KEY = "opentrivia.game.v0.1";
const $ = (selector) => document.querySelector(selector);
const elements = {
  studio: $("#studio-view"), setup: $("#play-setup-view"), play: $("#play-view"),
  editorActions: $("#editor-actions"), exitPlay: $("#exit-play-button"), boardList: $("#board-list"),
  editorBoard: $("#editor-board"), gameName: $("#game-name"), playerCount: $("#player-count"),
  rowCount: $("#row-count"), columnCount: $("#column-count"), roundCount: $("#round-count"),
  roundKicker: $("#round-kicker"), studioTitle: $("#studio-title"), studioHelp: $("#studio-help"),
  sizeControls: $("#size-controls"), deleteBoard: $("#delete-board-button"), clueDialog: $("#clue-dialog"),
  clueForm: $("#clue-form"), fileInput: $("#file-input"), exportMenu: $("#export-menu"),
  exportButton: $("#export-button"), playerFields: $("#player-name-fields"), startingPoints: $("#starting-points"),
  scoreboard: $("#scoreboard"), playStage: $("#play-stage"), playKicker: $("#play-kicker"),
  playGameName: $("#play-game-name"), cardDialog: $("#card-dialog"), cardContent: $("#card-dialog-content"),
  toastRegion: $("#toast-region"),
};

let game = loadGame();
let selectedBoard = 0;
let editingClue = null;
let session = null;

function loadGame() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeGame(JSON.parse(saved)) : createGame();
  } catch {
    return createGame();
  }
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
      button.textContent = clue.value.toLocaleString();
      button.setAttribute("aria-label", `${column.topic || `Topic ${columnIndex + 1}`} for ${clue.value} points${complete ? ", complete" : ", needs content"}`);
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
  $("#clue-location").textContent = `${column.topic || `Topic ${columnIndex + 1}`} · ${clue.value.toLocaleString()}`;
  $("#clue-value").value = clue.value;
  $("#clue-answer").value = clue.answer;
  $("#clue-question").value = clue.question;
  elements.clueDialog.showModal();
  $("#clue-answer").focus();
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

function showSetup() {
  game.name = elements.gameName.value.trim() || "Untitled game";
  saveGame();
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
    switchView("play");
    renderPlayRound();
  } catch (error) {
    toast(error.message, true);
  }
}

function switchView(view) {
  elements.studio.hidden = view !== "studio";
  elements.setup.hidden = view !== "setup";
  elements.play.hidden = view !== "play";
  elements.editorActions.hidden = view !== "studio";
  elements.exitPlay.hidden = view === "studio";
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
    card.innerHTML = `<div class="eyebrow">${escapeHtml(column.topic)}</div><h2>${formatText(clue.answer || "No clue was provided.")}</h2><p>Wagers are locked. Give every player time to think before collecting responses.</p><div class="boss-actions"><button class="button primary" id="collect-guesses" type="button">Collect responses</button></div>`;
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
  elements.playKicker.textContent = "Game complete";
  elements.playStage.innerHTML = `<div class="final-stage"><div class="final-card"><div class="boss-symbol" aria-hidden="true">★</div><div class="eyebrow">Final standings</div><h2>${escapeHtml(ranked[0].name)} wins!</h2><div class="final-standings">${ranked.map((player, index) => `<div class="standing"><strong>${index + 1}. ${escapeHtml(player.name)}</strong><span>${player.points.toLocaleString()} points</span></div>`).join("")}</div><button class="button primary" id="return-studio" type="button">Return to studio</button></div></div>`;
  $("#return-studio").addEventListener("click", () => switchView("studio"));
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
  clue.value = Number($("#clue-value").value);
  clue.answer = $("#clue-answer").value;
  clue.question = $("#clue-question").value;
  saveGame();
  elements.clueDialog.close();
  renderEditorBoard();
  toast("Card saved.");
});
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
$("#play-button").addEventListener("click", showSetup);
$("#cancel-setup-button").addEventListener("click", () => switchView("studio"));
$("#launch-button").addEventListener("click", launchGame);
elements.exitPlay.addEventListener("click", () => switchView("studio"));
$("#home-button").addEventListener("click", () => switchView("studio"));
elements.cardDialog.addEventListener("close", () => {
  if (session && !elements.play.hidden) renderPlayRound();
});

renderStudio();
