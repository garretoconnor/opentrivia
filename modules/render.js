import { buzzTimer } from "../core.mjs?v=0.10.0";
import { state } from "./state.js?v=0.10.0";

export const $ = (selector) => document.querySelector(selector);

export const elements = {
  daily: $("#daily-view"), library: $("#library-view"), studio: $("#studio-view"), setup: $("#play-setup-view"),
  join: $("#join-view"), host: $("#host-view"), play: $("#play-view"),
  editorActions: $("#editor-actions"), exitPlay: $("#exit-play-button"), boardList: $("#board-list"),
  editorBoard: $("#editor-board"), gameName: $("#game-name"), playerCount: $("#player-count"),
  difficulty: $("#difficulty"), heroInput: $("#hero-image-input"), heroPreview: $("#hero-image-preview"),
  rowCount: $("#row-count"), columnCount: $("#column-count"), roundCount: $("#round-count"),
  roundKicker: $("#round-kicker"), studioTitle: $("#studio-title"), studioHelp: $("#studio-help"),
  deleteBoard: $("#delete-board-button"), clueDialog: $("#clue-dialog"), clueForm: $("#clue-form"),
  fileInput: $("#file-input"), exportMenu: $("#export-menu"), exportButton: $("#export-button"),
  playerFields: $("#player-name-fields"), startingPoints: $("#starting-points"), scoreboard: $("#scoreboard"),
  playStage: $("#play-stage"), playKicker: $("#play-kicker"), playGameName: $("#play-game-name"),
  cardDialog: $("#card-dialog"), cardContent: $("#card-dialog-content"), toastRegion: $("#toast-region"),
  gameGrid: $("#game-grid"), libraryStatus: $("#library-status"), joinResult: $("#join-result"),
  roomCode: $("#room-code"), hostCode: $("#host-code"), joinPlayerName: $("#join-player-name"),
  hostPlayerList: $("#host-player-list"),
};

let renderStudio = () => {};
let loadLibrary = () => {};
let loadDaily = () => {};

export function configureViewRenderers(renderers) {
  renderStudio = renderers.renderStudio;
  loadLibrary = renderers.loadLibrary;
  loadDaily = renderers.loadDaily;
}

export function switchView(view) {
  if (view === "studio" && state.game !== state.authoredGame) state.game = state.authoredGame;
  state.currentView = view;
  for (const name of ["library", "daily", "studio", "setup", "join", "host", "play"]) {
    elements[name].hidden = view !== name;
  }
  elements.editorActions.hidden = view !== "studio";
  elements.exitPlay.hidden = !["setup", "play", "host"].includes(view);
  document.querySelectorAll(".main-nav button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "studio") renderStudio();
  if (view === "library") loadLibrary();
  if (view === "daily") loadDaily();
  document.dispatchEvent(new Event("opentrivia:view"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function fillNumberOptions(select, minimum, maximum) {
  select.replaceChildren(...Array.from({ length: maximum - minimum + 1 }, (_, index) => {
    const option = document.createElement("option");
    option.value = String(minimum + index);
    option.textContent = String(minimum + index);
    return option;
  }));
}

export function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function updateBuzzTimers() {
  document.querySelectorAll(".buzz-timer[data-deadline]").forEach((element) => {
    const timer = buzzTimer(Number(element.dataset.deadline));
    element.textContent = String(timer.seconds);
    element.classList.toggle("overtime", timer.overtime);
    element.setAttribute("aria-label", `${timer.seconds} seconds remaining${timer.overtime ? " in overtime" : ""}`);
  });
}

export function answerDetails(clue) {
  return `${clue.accepted_answers.length ? `<p>Also accepted: ${clue.accepted_answers.map(formatText).join('; ')}</p>` : ''}${clue.explanation ? `<p>${formatText(clue.explanation)}</p>` : ''}`;
}
