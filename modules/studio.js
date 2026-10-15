import {
  DIFFICULTIES,
  applyRowValues,
  defaultRowValues,
  reorderClue,
  LIMITS,
  createBoard,
  createBossBoard,
  exportBoard,
  exportGame,
  isBossBoard,
  normalizeBoard,
  normalizeGame,
  resizeBoard,
} from "../core.mjs?v=0.10.5";
import { $, elements, escapeHtml, fillNumberOptions, toast } from "./render.js?v=0.10.5";
import { saveGame as persistGame, state } from "./state.js?v=0.10.5";

let undoState = null;
let initialClue = "";
let selectedTopic = 0;
let draggedClue = null;
function saveGame(keepUndo = false) {
  if (!keepUndo) { undoState = null; $("#undo-notice").hidden = true; }
  return persistGame();
}
function rememberChange() {
  undoState = { boards: structuredClone(state.game.boards), selected: state.selectedBoard };
  $("#undo-notice").hidden = false;
}
function confirmChange(message, action) {
  const dialog = $("#studio-confirm");
  $("#confirmation-message").textContent = message;
  $("#confirmation-accept").textContent = action;
  dialog.returnValue = "cancel";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "accept"), { once: true });
    dialog.showModal();
  });
}
function clueDraft() {
  return JSON.stringify([$("#clue-text").value, $("#clue-answer").value, $("#clue-aliases").value, $("#clue-explanation").value, state.pendingClueImage]);
}
async function dismissClue() {
  if (clueDraft() !== initialClue && !await confirmChange("Discard unsaved changes to this clue?", "Discard changes")) return;
  elements.clueDialog.close();
  focusClue();
}
function focusClue() {
  const { columnIndex, row } = state.editingClue;
  elements.editorBoard.querySelector(`[data-column="${columnIndex}"][data-row="${row}"]`)?.focus();
}

export function renderStudio() {
  const board = state.game.boards[state.selectedBoard];
  const boss = isBossBoard(board);
  applyRowValues(state.game);
  $("#adult-content").checked = state.game.adult_content;
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
  $("#round-title").value = board.title || (boss ? "Boss round" : `Round ${state.selectedBoard + 1}`);
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

    button.setAttribute("aria-current", index === state.selectedBoard ? "true" : "false");
    const clues = board.columns.flatMap(column => column.clues);
    const completed = clues.filter(clue => clue.clue.trim() && clue.answer.trim()).length;
    button.innerHTML = `<span class="round-number">${boss ? "✦" : index + 1}</span><span><span class="round-label">${escapeHtml(board.title || (boss ? "Boss round" : `Round ${index + 1}`))}</span><span class="round-type">${completed}/${clues.length} complete</span></span>`;
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
  selectedTopic = Math.min(selectedTopic, board.columns.length - 1);
  const selector = $("#topic-selector");
  selector.replaceChildren(...board.columns.map((column, index) => new Option(column.topic || `Topic ${index + 1}`, index)));
  selector.value = selectedTopic;
  elements.editorBoard.style.setProperty("--topic-count", Math.min(board.columns.length, 5));
  elements.editorBoard.replaceChildren(...board.columns.map((column, columnIndex) => {
    const section = document.createElement("section");
    section.className = `author-topic${columnIndex === selectedTopic ? " selected-topic" : ""}`;
    const label = document.createElement("label");
    label.className = "topic-label";
    label.textContent = boss ? "Boss topic" : `Topic ${columnIndex + 1}`;
    const input = document.createElement("input");
    input.value = column.topic;
    input.placeholder = "Name this topic";
    input.maxLength = 80;
    input.addEventListener("input", () => {
      column.topic = input.value;
      selector.options[columnIndex].textContent = column.topic || `Topic ${columnIndex + 1}`;
      saveGame();
    });
    label.append(input);
    section.append(label);
    column.clues.forEach((clue, row) => {
      const status = !clue.clue.trim() ? "Empty clue" : !clue.answer.trim() ? "Needs response" : "Complete";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `author-clue${status === "Complete" ? " complete" : ""}`;
      button.dataset.column = columnIndex;
      button.dataset.row = row;
      button.setAttribute("aria-label", `${column.topic || "Topic"}, ${boss ? "Boss clue" : `${clue.value} points`}, ${status}`);
      button.innerHTML = `<span class="clue-points">${boss ? "Wager clue" : `${clue.value.toLocaleString()} pts`}</span><span class="clue-excerpt">${escapeHtml(clue.clue || "Add a clue…")}</span><span class="clue-status">${status === "Complete" ? "✓ " : "○ "}${status}${clue.image ? " · Image" : ""}</span>`;
      button.addEventListener("click", () => openClueEditor(columnIndex, row));
      const item = document.createElement("div");
      item.className = "author-clue-item";
      item.dataset.column = columnIndex;
      item.dataset.row = row;
      item.append(button);
      if (!boss && column.clues.length > 1) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "clue-drag-handle";
        handle.textContent = "⠿";
        handle.setAttribute("aria-label", `Move clue ${row + 1} in ${column.topic || "topic"}. Use up and down arrow keys.`);
        handle.addEventListener("keydown", event => {
          if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          moveClue(columnIndex, row, row + (event.key === "ArrowUp" ? -1 : 1));
        });
        handle.addEventListener("pointerdown", event => {
          if (event.button !== 0) return;
          event.preventDefault();
          draggedClue = { boardIndex: state.selectedBoard, columnIndex, row, target: row, pointerId: event.pointerId };
          handle.setPointerCapture(event.pointerId);
          item.classList.add("dragging");
        });
        handle.addEventListener("pointermove", event => {
          if (!draggedClue || draggedClue.pointerId !== event.pointerId) return;
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".author-clue-item");
          elements.editorBoard.querySelectorAll(".drop-target").forEach(node => node.classList.remove("drop-target"));
          draggedClue.target = row;
          if (target && Number(target.dataset.column) === columnIndex) {
            draggedClue.target = Number(target.dataset.row);
            target.classList.add("drop-target");
          }
        });
        handle.addEventListener("pointerup", event => {
          if (!draggedClue || draggedClue.pointerId !== event.pointerId) return;
          const target = draggedClue.target;
          draggedClue = null;
          item.classList.remove("dragging");
          elements.editorBoard.querySelectorAll(".drop-target").forEach(node => node.classList.remove("drop-target"));
          moveClue(columnIndex, row, target);
        });
        handle.addEventListener("pointercancel", () => { draggedClue = null; renderEditorBoard(); });
        item.append(handle);
      }
      section.append(item);
    });
    return section;
  }));
}

function moveClue(columnIndex, from, to) {
  const board = state.game.boards[state.selectedBoard];
  if (to < 0 || to >= board.columns[columnIndex].clues.length || from === to) return;
  rememberChange();
  reorderClue(state.game, state.selectedBoard, columnIndex, from, to);
  if (!saveGame(true)) {
    state.game.boards = undoState.boards;
    undoState = null;
    $("#undo-notice").hidden = true;
    renderEditorBoard();
    toast("Could not save the new order. Check device storage and try again.", true);
    return;
  }
  renderEditorBoard();
  elements.editorBoard.querySelector(`[data-column="${columnIndex}"][data-row="${to}"] .clue-drag-handle`)?.focus();
  toast(`Clue moved to row ${to + 1}. Points now match that row.`);
}

function renderRowValues() {
  $("#row-values-error").textContent = "";
  $("#row-values-preset").value = "custom";
  $("#row-values-fields").replaceChildren(...state.game.row_values.slice(0, Math.max(5, ...state.game.boards.filter(board => !isBossBoard(board)).flatMap(board => board.columns.map(column => column.size)))).map((value, row) => {
    const label = document.createElement("label");
    label.textContent = `Row ${row + 1}`;
    const input = document.createElement("input");
    input.type = "number"; input.min = "1"; input.step = "1"; input.required = true; input.value = value;
    label.append(input);
    return label;
  }));
}

export function editStudioClue(boardIndex, columnIndex, row) {
  state.selectedBoard = boardIndex;
  selectedTopic = columnIndex;
  renderStudio();
  openClueEditor(columnIndex, row);
}

function openClueEditor(columnIndex, row) {
  state.editingClue = { columnIndex, row };
  const column = state.game.boards[state.selectedBoard].columns[columnIndex];
  const clue = column.clues[row];
  const boss = isBossBoard(state.game.boards[state.selectedBoard]);
  $("#clue-location").textContent = boss
    ? `${column.topic || "Boss topic"} · Wager round`
    : `${column.topic || `Topic ${columnIndex + 1}`} · ${clue.value.toLocaleString()}`;
  $("#clue-text").value = clue.clue;
  $("#clue-answer").value = clue.answer;
  $("#clue-aliases").value = clue.accepted_answers.join("\n");
  $("#clue-explanation").value = clue.explanation;
  state.pendingClueImage = clue.image || "";
  renderClueImagePreview();
  initialClue = clueDraft();
  $("#clue-save-status").textContent = "Changes save when you select Save clue.";
  $("#clue-attachment").open = false;
  if (!elements.clueDialog.open) elements.clueDialog.showModal();
  $("#clue-text").focus();
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

async function updateBoardSize() {
  const board = state.game.boards[state.selectedBoard];
  const rows = Number(elements.rowCount.value), columns = Number(elements.columnCount.value);
  const removed = board.columns.flatMap((column, index) => column.clues.filter((clue, row) => (index >= columns || row >= rows) && (clue.clue.trim() || clue.answer.trim() || clue.image || clue.accepted_answers.length || clue.explanation.trim()))).length;
  if (removed && !await confirmChange(`This removes ${removed} authored clue(s). You can undo this change.`, "Remove clues")) { renderStudio(); return; }
  rememberChange();
  resizeBoard(board, rows, columns);
  saveGame(true);
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

  $("#adult-content").addEventListener("change", () => { state.game.adult_content = $("#adult-content").checked; saveGame(); });
  $("#round-title").addEventListener("change", () => {
    const board = state.game.boards[state.selectedBoard];
    const previous = board.title;
    board.title = $("#round-title").value.trim();
    if (!saveGame()) { if (previous === undefined) delete board.title; else board.title = previous; }
    renderStudio();
  });
  $("#row-values-preset").addEventListener("change", () => {
    const step = Number($("#row-values-preset").value);
    if (!step) return;
    $("#row-values-fields").querySelectorAll("input").forEach((input, row) => { input.value = (row + 1) * step; });
  });
  $("#row-values-fields").addEventListener("input", () => { $("#row-values-preset").value = "custom"; });
  $("#row-values-form").addEventListener("submit", event => {
    event.preventDefault();
    const values = [...$("#row-values-fields").querySelectorAll("input")].map(input => Number(input.value));
    if (values.some(value => !Number.isSafeInteger(value) || value < 1)) { $("#row-values-error").textContent = "Enter a positive whole number for every row."; return; }
    const previous = [...state.game.row_values];
    const step = Number($("#row-values-preset").value);
    state.game.row_values = step ? defaultRowValues(step) : [...previous];
    values.forEach((value, row) => { state.game.row_values[row] = value; });
    if (!saveGame()) { state.game.row_values = previous; applyRowValues(state.game); $("#row-values-error").textContent = "Could not save. Check device storage and try again."; return; }
    renderStudio();
    toast("Row points saved for all rounds.");
  });
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
  elements.deleteBoard.addEventListener("click", async () => {
    if (state.game.boards.length === 1) return;
    if (!await confirmChange("Delete this round? You can undo this change.", "Delete round")) return;
    rememberChange();
    state.game.boards.splice(state.selectedBoard, 1);
    state.selectedBoard = Math.min(state.selectedBoard, state.game.boards.length - 1);
    saveGame(true);
    renderStudio();
    toast("Round deleted. Undo is available above the editor.");
  });
  elements.clueForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const clue = state.game.boards[state.selectedBoard].columns[state.editingClue.columnIndex].clues[state.editingClue.row];
    const previous = structuredClone(clue);
    if (isBossBoard(state.game.boards[state.selectedBoard])) delete clue.value;
    clue.clue = $("#clue-text").value;
    clue.answer = $("#clue-answer").value;
    clue.accepted_answers = $("#clue-aliases").value.split("\n").map(answer => answer.trim()).filter(Boolean);
    clue.explanation = $("#clue-explanation").value;
    clue.image = state.pendingClueImage;
    if (!saveGame()) {
      for (const key of Object.keys(clue)) delete clue[key];
      Object.assign(clue, previous);
      $("#clue-save-status").textContent = "Could not save. Free up device storage and try again. Your edits are still here.";
      return;
    }
    renderEditorBoard();
    renderBoardList();
    if (event.submitter?.value === "next") {
      const board = state.game.boards[state.selectedBoard];
      let { columnIndex, row } = state.editingClue;
      row += 1;
      if (row >= board.columns[columnIndex].clues.length) { row = 0; columnIndex += 1; }
      if (columnIndex < board.columns.length) { selectedTopic = columnIndex; renderEditorBoard(); openClueEditor(columnIndex, row); return; }
    }
    elements.clueDialog.close();
    focusClue();
    toast("Clue saved.");
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
  $("#cancel-clue-button").addEventListener("click", dismissClue);
  $("#close-clue-button").addEventListener("click", dismissClue);
  elements.clueDialog.addEventListener("cancel", event => { event.preventDefault(); dismissClue(); });
  elements.clueForm.addEventListener("input", () => { $("#clue-save-status").textContent = "Unsaved changes"; });
  $("#settings-button").addEventListener("click", () => { renderRowValues(); $("#game-settings").showModal(); });
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  $("#topic-selector").addEventListener("change", event => { selectedTopic = Number(event.target.value); renderEditorBoard(); });
  $("#undo-button").addEventListener("click", () => {
    if (!undoState) return;
    state.game.boards = undoState.boards;
    state.selectedBoard = undoState.selected;
    saveGame();
    renderStudio();
  });
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
