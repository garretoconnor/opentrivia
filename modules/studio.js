import {
  DIFFICULTIES,
  LIMITS,
  createBoard,
  createBossBoard,
  exportBoard,
  exportGame,
  isBossBoard,
  normalizeBoard,
  normalizeGame,
  resizeBoard,
} from "../core.mjs?v=0.3.1";
import { $, elements, escapeHtml, fillNumberOptions, toast } from "./render.js";
import { saveGame, state } from "./state.js";

export function renderStudio() {
  const board = state.game.boards[state.selectedBoard];
  const boss = isBossBoard(board);
  elements.gameName.value = state.game.name;
  elements.playerCount.value = String(state.game.num_players);
  elements.difficulty.value = state.game.difficulty;
  elements.heroPreview.src = state.game.hero_image || "";
  elements.heroPreview.hidden = !state.game.hero_image;
  $("#hero-image-copy").hidden = Boolean(state.game.hero_image);
  $("#remove-hero-button").hidden = !state.game.hero_image;
  elements.roundCount.textContent = String(state.game.boards.length);
  elements.deleteBoard.disabled = state.game.boards.length === 1;
  elements.roundKicker.textContent = `Round ${state.selectedBoard + 1} · ${boss ? "Boss" : "Standard"}`;
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
  elements.boardList.replaceChildren(...state.game.boards.map((board, index) => {
    const boss = isBossBoard(board);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `board-list-item${index === state.selectedBoard ? " active" : ""}${boss ? " boss" : ""}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", index === state.selectedBoard ? "true" : "false");
    const topic = board.columns[0]?.topic?.trim();
    button.innerHTML = `<span class="round-number">${boss ? "✦" : index + 1}</span><span><span class="round-label">${escapeHtml(topic || `Round ${index + 1}`)}</span><span class="round-type">${boss ? "Boss round" : `${board.columns.length} topics`}</span></span>`;
    button.addEventListener("click", () => {
      state.selectedBoard = index;
      renderStudio();
    });
    return button;
  }));
}

export function renderEditorBoard() {
  const board = state.game.boards[state.selectedBoard];
  const boss = isBossBoard(board);
  const rows = Math.max(...board.columns.map((column) => column.size));
  elements.editorBoard.style.gridTemplateColumns = `repeat(${board.columns.length}, minmax(100px, 1fr))`;
  const nodes = [];
  board.columns.forEach((column, columnIndex) => {
    const input = document.createElement("input");
    input.className = "topic-input";
    input.value = column.topic;
    input.placeholder = `Topic ${columnIndex + 1}`;
    input.maxLength = 80;
    input.setAttribute("aria-label", `Column ${columnIndex + 1} topic`);
    input.addEventListener("input", () => {
      column.topic = input.value;
      saveGame();
      renderBoardList();
    });
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
  state.editingClue = { columnIndex, row };
  const column = state.game.boards[state.selectedBoard].columns[columnIndex];
  const clue = column.clues[row];
  const boss = isBossBoard(state.game.boards[state.selectedBoard]);
  $("#clue-location").textContent = boss
    ? `${column.topic || "Boss topic"} · Wager round`
    : `${column.topic || `Topic ${columnIndex + 1}`} · ${clue.value.toLocaleString()}`;
  $("#clue-value-field").hidden = boss;
  $("#clue-value").required = !boss;
  $("#clue-value").value = boss ? "" : clue.value;
  $("#clue-answer").value = clue.answer;
  $("#clue-question").value = clue.question;
  state.pendingClueImage = clue.image || "";
  renderClueImagePreview();
  elements.clueDialog.showModal();
  $("#clue-answer").focus();
}

function renderClueImagePreview() {
  const preview = $("#clue-image-preview");
  preview.src = state.pendingClueImage;
  preview.hidden = !state.pendingClueImage;
  $("#remove-clue-image").hidden = !state.pendingClueImage;
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
  state.game.boards.push(boss ? createBossBoard() : createBoard());
  state.game.size = state.game.boards.length;
  state.selectedBoard = state.game.boards.length - 1;
  saveGame();
  renderStudio();
  toast(`${boss ? "Boss" : "Standard"} round added.`);
}

function updateBoardSize() {
  resizeBoard(state.game.boards[state.selectedBoard], Number(elements.rowCount.value), Number(elements.columnCount.value));
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
      state.game = normalizeGame(data);
      state.authoredGame = state.game;
      state.selectedBoard = 0;
      toast(`Imported “${state.game.name}”.`);
    } else if (data && typeof data === "object" && "board" in data) {
      state.game.boards.push(normalizeBoard(data));
      state.game.size = state.game.boards.length;
      state.selectedBoard = state.game.boards.length - 1;
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

export function initStudio() {
  fillNumberOptions(elements.playerCount, LIMITS.minPlayers, LIMITS.maxPlayers);
  fillNumberOptions(elements.rowCount, LIMITS.minRows, LIMITS.maxRows);
  fillNumberOptions(elements.columnCount, LIMITS.minColumns, LIMITS.maxColumns);

  elements.gameName.addEventListener("input", () => { state.game.name = elements.gameName.value; saveGame(); });
  elements.playerCount.addEventListener("change", () => { state.game.num_players = Number(elements.playerCount.value); saveGame(); });
  elements.difficulty.addEventListener("change", () => {
    if (DIFFICULTIES.includes(elements.difficulty.value)) state.game.difficulty = elements.difficulty.value;
    saveGame();
  });
  elements.heroInput.addEventListener("change", async () => {
    try {
      state.game.hero_image = await readImage(elements.heroInput.files[0]);
      saveGame();
      renderStudio();
    } catch (error) {
      toast(error.message, true);
    }
    elements.heroInput.value = "";
  });
  $("#remove-hero-button").addEventListener("click", () => { state.game.hero_image = ""; saveGame(); renderStudio(); });
  elements.rowCount.addEventListener("change", updateBoardSize);
  elements.columnCount.addEventListener("change", updateBoardSize);
  $("#add-board-button").addEventListener("click", () => addBoard(false));
  $("#add-boss-button").addEventListener("click", () => addBoard(true));
  elements.deleteBoard.addEventListener("click", () => {
    if (state.game.boards.length === 1) return;
    state.game.boards.splice(state.selectedBoard, 1);
    state.selectedBoard = Math.min(state.selectedBoard, state.game.boards.length - 1);
    saveGame();
    renderStudio();
    toast("Round deleted.");
  });
  elements.clueForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const clue = state.game.boards[state.selectedBoard].columns[state.editingClue.columnIndex].clues[state.editingClue.row];
    if (isBossBoard(state.game.boards[state.selectedBoard])) delete clue.value;
    else clue.value = Number($("#clue-value").value);
    clue.answer = $("#clue-answer").value;
    clue.question = $("#clue-question").value;
    clue.image = state.pendingClueImage;
    saveGame();
    elements.clueDialog.close();
    renderEditorBoard();
    toast("Card saved.");
  });
  $("#clue-image-input").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    try {
      state.pendingClueImage = await readImage(input.files[0]);
      renderClueImagePreview();
    } catch (error) {
      toast(error.message, true);
    }
    input.value = "";
  });
  $("#remove-clue-image").addEventListener("click", () => { state.pendingClueImage = ""; renderClueImagePreview(); });
  $("#cancel-clue-button").addEventListener("click", () => elements.clueDialog.close());
  $("#import-button").addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => { if (elements.fileInput.files[0]) importFile(elements.fileInput.files[0]); });
  elements.exportButton.addEventListener("click", () => {
    elements.exportMenu.hidden = !elements.exportMenu.hidden;
    elements.exportButton.setAttribute("aria-expanded", String(!elements.exportMenu.hidden));
  });
  $("#export-board-button").addEventListener("click", () => {
    downloadJson(`${safeFilename(state.game.name)}-round-${state.selectedBoard + 1}.json`, exportBoard(state.game.boards[state.selectedBoard]));
    closeExportMenu();
  });
  $("#export-game-button").addEventListener("click", () => {
    downloadJson(`${safeFilename(state.game.name)}.json`, exportGame(state.game));
    closeExportMenu();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-wrap")) closeExportMenu();
  });
}

function closeExportMenu() {
  elements.exportMenu.hidden = true;
  elements.exportButton.setAttribute("aria-expanded", "false");
}
