import { publishCloudGame } from './accounts.js?v=0.11.0';
import { editStudioClue } from "./studio.js?v=0.11.0";
import { difficultySymbol, normalizeGame } from "../core.mjs?v=0.11.0";
import { allowsLocalFallback, api } from "./data.js?v=0.11.0";
import { $, elements, escapeHtml, switchView, toast } from "./render.js?v=0.11.0";
import { localLibrary, saveGame, saveLocalLibrary, state, voterId } from "./state.js?v=0.11.0";

let showSetup = () => {};
let hostPublishedGame = () => {};

export function initLibrary(dependencies) {
  showSetup = dependencies.showSetup;
  hostPublishedGame = dependencies.hostPublished;
  $("#publish-button").addEventListener("click", reviewPublication);
  $("#confirm-publish").addEventListener("click", async () => {
    const button = $("#confirm-publish");
    button.disabled = true;
    try { await publishGame(); } catch (error) { $("#publish-error").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#refresh-library-button").addEventListener("click", loadLibrary);
}

export function recordLocalPlay(id) {
  const games = localLibrary();
  const item = games.find((entry) => entry.id === id);
  if (!item) return;
  item.plays = [...(item.plays || []), Date.now()];
  saveLocalLibrary(games);
}

function summarizeLocal(entry) {
  return {
    id: entry.id,
    title: entry.game.name,
    hero_image: entry.game.hero_image,
    difficulty: entry.game.difficulty,
    adult_content: entry.game.adult_content ?? false,
    score: entry.score || 0,
    weekly_plays: (entry.plays || []).filter((playedAt) => playedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000).length,
  };
}

export async function loadLibrary() {
  elements.libraryStatus.textContent = "Loading the library…";
  try {
    const result = await api("/api/games");
    renderLibrary(result.games);
    const featured = await api("/api/featured").catch(() => ({ ids: [] }));
    renderFeatured(featured.ids.map(id => result.games.find(game => game.id === id)).filter(Boolean));
    elements.libraryStatus.textContent = `${result.games.length} public game${result.games.length === 1 ? "" : "s"}.`;
  } catch {
    const games = localLibrary().map(summarizeLocal);
    renderLibrary(games);
    renderFeatured([]);
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
    card.innerHTML = `${image}<div class="game-card-body"><div class="game-badges"><div class="difficulty ${escapeHtml(entry.difficulty)}"><span aria-hidden="true">${difficultySymbol(entry.difficulty)}</span> ${escapeHtml(entry.difficulty)}</div>${entry.adult_content ? '<span class="adult-badge">18+</span>' : ""}</div><h3>${escapeHtml(entry.title)}</h3>${byline(entry)}<div class="game-stats"><span title="Community score">👍 ${Number(entry.score).toLocaleString()}</span><span title="Plays in the past seven days">▶ ${Number(entry.weekly_plays).toLocaleString()} this week</span></div><div class="game-card-actions"><button class="button secondary" data-action="host" type="button">Host</button><button class="button primary" data-action="play" type="button">Play</button></div></div>`;
    card.querySelector('[data-action="play"]').addEventListener("click", () => playPublished(entry.id));
    card.querySelector('[data-action="host"]').addEventListener("click", () => hostPublishedGame(entry.id));
    return card;
  }));
}

export async function getPublishedGame(id) {
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
    state.authoredGame = state.currentView === "studio" ? state.game : state.authoredGame;
    state.game = selected;
    showSetup("library", id);
  } catch (error) {
    toast(error.message, true);
  }
}

function reviewPublication() {
  const clues = state.game.boards.flatMap(board => board.columns.flatMap(column => column.clues));
  const missing = [];
  state.game.boards.forEach((board, boardIndex) => board.columns.forEach((column, columnIndex) => column.clues.forEach((clue, row) => {
    if (!clue.clue.trim() || !clue.answer.trim()) missing.push({ boardIndex, columnIndex, row, label: `Round ${boardIndex + 1} · ${column.topic || "Untitled topic"} · Clue ${row + 1}` });
  })));
  $("#publish-error").textContent = "";
  $("#publish-summary").innerHTML = `<h3>${escapeHtml(state.game.name || "Untitled game")}</h3>${state.game.hero_image ? `<img src="${escapeHtml(state.game.hero_image)}" alt="Game cover" />` : ""}${state.game.adult_content ? '<p><span class="adult-badge">18+</span> Contains adult content</p>' : ""}<p>${state.game.boards.length} rounds · ${clues.length - missing.length}/${clues.length} clues complete</p>${missing.length ? '<p>Finish these clues before publishing:</p><ul class="publish-issues"></ul>' : '<p>All clues have a clue and a correct response.</p>'}`;
  missing.forEach(item => {
    const li = document.createElement("li"), button = document.createElement("button");
    button.type = "button"; button.textContent = item.label;
    button.addEventListener("click", () => { $("#publish-review").close(); editStudioClue(item.boardIndex, item.columnIndex, item.row); });
    li.append(button); $(".publish-issues").append(li);
  });
  $("#confirm-publish").disabled = missing.length > 0;
  $("#publish-review").showModal();
}

async function publishGame() {
  state.game.name = elements.gameName.value.trim() || "Untitled game";
  if (!saveGame()) throw new Error("Save failed. Check device storage before publishing.");
  const clean = normalizeGame({ ...state.game, size: state.game.boards.length });
  try {
    const result = state.account ? await publishCloudGame() : await api("/api/games", { method: "POST", body: JSON.stringify({ game: clean }) });
    toast(`“${result.game.title}” is now public.`);
  } catch (error) {
    if (state.account || !allowsLocalFallback(error)) {
      $("#publish-error").textContent = error.message;
      return;
    }
    const games = localLibrary();
    games.unshift({ id: crypto.randomUUID(), game: clean, score: 0, votes: {}, plays: [], created_at: Date.now() });
    saveLocalLibrary(games);
    toast(`“${clean.name}” was published to this local preview.`);
  }
  $("#publish-review").close();
  switchView("library");
}

export async function rateGame(value) {
  try {
    const result = await api(`/api/games/${state.publishedGameId}/vote`, {
      method: "POST",
      headers: { "x-opentrivia-voter": voterId() },
      body: JSON.stringify({ value }),
    });
    toast(`Thanks! This game’s score is now ${result.score}.`);
  } catch {
    const games = localLibrary();
    const item = games.find((entry) => entry.id === state.publishedGameId);
    if (item) {
      const previous = item.votes?.[voterId()] || 0;
      item.score = (item.score || 0) - previous + value;
      item.votes = { ...(item.votes || {}), [voterId()]: value };
      saveLocalLibrary(games);
      toast(`Thanks! This game’s score is now ${item.score}.`);
    } else {
      toast("Your rating could not be saved.", true);
    }
  }
  document.querySelectorAll(".rating-button").forEach((button) => { button.disabled = true; });
}

function byline(game) {
  return game.creator_username ? `<p class="game-byline">by <a href="/@${encodeURIComponent(game.creator_username)}">@${escapeHtml(game.creator_username)}</a></p>` : '';
}
function renderFeatured(games) {
  const mount = $('#featured-carousel');
  if (!games.length) {
    mount.innerHTML = '<div><h1 id="library-title">Find tonight’s trivia game.</h1><p>Choose from community favorites to play together.</p></div>';
    return;
  }
  let index = 0;
  mount.innerHTML = '<div id="featured-slide"></div><div class="carousel-controls"><button type="button" class="button secondary" id="featured-prev" aria-label="Previous featured game">←</button><span id="featured-position" aria-live="polite"></span><button type="button" class="button secondary" id="featured-next" aria-label="Next featured game">→</button></div>';
  const show = () => {
    const game = games[index];
    $('#featured-slide').innerHTML = `${game.hero_image ? `<img class="featured-image" src="${escapeHtml(game.hero_image)}" alt="" />` : ''}<div class="featured-copy"><p class="eyebrow">Featured game</p><h1 id="library-title">${escapeHtml(game.title)}</h1>${byline(game)}<div class="game-badges"><span class="difficulty ${escapeHtml(game.difficulty)}">${escapeHtml(game.difficulty)}</span>${game.adult_content ? '<span class="adult-badge">18+</span>' : ''}</div><div class="game-card-actions"><button type="button" class="button primary" id="featured-play">Play game</button><button type="button" class="button secondary" id="featured-host">Host game</button></div></div>`;
    $('#featured-play').addEventListener('click', () => playPublished(game.id));
    $('#featured-host').addEventListener('click', () => hostPublishedGame(game.id));
    $('#featured-position').textContent = `${index + 1} / ${games.length}`;
    $('#featured-prev').disabled = $('#featured-next').disabled = games.length < 2;
  };
  $('#featured-prev').addEventListener('click', () => { index = (index + games.length - 1) % games.length; show(); });
  $('#featured-next').addEventListener('click', () => { index = (index + 1) % games.length; show(); });
  show();
}
