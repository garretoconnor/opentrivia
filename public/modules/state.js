import { applyRowValues, createGame, normalizeGame } from "../../src/shared/core.mjs?v=0.11.0";

export const STORAGE_KEY = "opentrivia.game.v0.2";
export const LEGACY_STORAGE_KEY = "opentrivia.game.v0.1";
export const LOCAL_LIBRARY_KEY = "opentrivia.library.v0.2";
export const VOTER_KEY = "opentrivia.voter.v0.2";

export function loadGuestGame() {
  try {
    const active = localStorage.getItem('opentrivia.guest.drafts.active');
    const drafts = JSON.parse(localStorage.getItem('opentrivia.guest.drafts') || '{}');
    if (active && drafts[active]) return normalizeGame(drafts[active]);
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeGame(JSON.parse(saved)) : createGame();
  } catch {
    return createGame();
  }
}

const initialGame = loadGuestGame();
let persistence = () => null;
export function configurePersistence(handler) { persistence = handler; }

export const state = {
  account: null,
  game: initialGame,
  authoredGame: initialGame,
  selectedBoard: 0,
  editingClue: null,
  session: null,
  returnView: "studio",
  publishedGameId: null,
  hostedRoom: null,
  pendingClueImage: "",
  currentView: "library",
  joinedRoom: null,
  hostRoomSnapshot: null,
  roomPollTimer: null,
  hostClueLocation: null,
};

export function saveGame() {
  state.game.size = state.game.boards.length;
  applyRowValues(state.game);
  const handled = persistence(state.game);
  if (handled !== null) return handled;
  const status = typeof document !== "undefined" ? document.getElementById("save-status") : null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.game));
    if (status) { status.textContent = "Saved on this device"; status.dataset.error = "false"; }
    return true;
  } catch {
    if (status) { status.textContent = "Not saved — device storage unavailable"; status.dataset.error = "true"; }
    return false;
  }
}

export function localLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_LIBRARY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveLocalLibrary(games) {
  localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(games));
}

export function voterId() {
  let id = localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}
