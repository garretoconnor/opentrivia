import test from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
  reorderClue,
  LIMITS,
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
} from "../core.mjs";
import { TriviaRoom } from "../api.mjs";

test("new games use the required defaults", () => {
  const game = createGame();
  assert.equal(game.num_players, 3);
  assert.equal(game.boards.length, 1);
  assert.equal(game.boards[0].columns.length, 6);
  assert.equal(game.boards[0].columns[0].size, 5);
  assert.equal(game.boards[0].columns[0].clues.length, 5);
  assert.equal(game.difficulty, "medium");
  assert.equal(game.hero_image, "");
});

test("boards support every allowed size and reject out-of-range sizes", () => {
  assert.equal(createBoard(1, 1).columns.length, 1);
  assert.equal(createBoard(16, 16).columns[15].clues.length, 16);
  assert.throws(() => createBoard(0, 6), /1 to 16/);
  assert.throws(() => createBoard(5, 17), /1 to 16/);
});

test("resizing preserves existing cards and fills new cards", () => {
  const board = createBoard(2, 2);
  board.columns[0].clues[0].answer = "Keep me";
  resizeBoard(board, 4, 3);
  assert.equal(board.columns[0].clues[0].answer, "Keep me");
  assert.equal(board.columns.length, 3);
  assert.equal(board.columns[2].clues.length, 4);
  resizeBoard(board, 1, 1);
  assert.equal(board.columns.length, 1);
  assert.equal(board.columns[0].clues.length, 1);
});

test("Boss boards are exactly one topic and one card", () => {
  const boss = createBossBoard();
  assert.equal(isBossBoard(boss), true);
  assert.equal("value" in boss.columns[0].clues[0], false, "Boss clues are wager based and have no point value");
  assert.equal(isBossBoard(createBoard(2, 1)), false);
});

test("board JSON round trips through the specified wrapper", () => {
  const board = createBoard(2, 3);
  const parsed = JSON.parse(exportBoard(board));
  assert.deepEqual(normalizeBoard(parsed), board);
  assert.deepEqual(Object.keys(parsed), ["board"]);
});

test("game JSON round trips and size matches the board count", () => {
  const game = createGame();
  game.name = "Friday trivia";
  game.boards.push(createBossBoard());
  game.difficulty = "hard";
  game.hero_image = "data:image/png;base64,hero";
  game.boards[0].columns[0].clues[0].image = "data:image/png;base64,clue";
  const parsed = JSON.parse(exportGame(game));
  assert.equal(parsed.game.size, 2);
  assert.equal(normalizeGame(parsed).boards.length, 2);
  assert.equal(parsed.game.hero_image, game.hero_image);
  assert.equal(parsed.game.boards[0].columns[0].clues[0].image, "data:image/png;base64,clue");
  assert.equal("value" in parsed.game.boards[1].columns[0].clues[0], false);
});

test("v0.1 games migrate to v0.2 image and difficulty defaults", () => {
  const legacy = createGame();
  delete legacy.difficulty;
  delete legacy.hero_image;
  for (const board of legacy.boards) {
    for (const column of board.columns) for (const clue of column.clues) delete clue.image;
  }
  const migrated = normalizeGame(legacy);
  assert.equal(migrated.difficulty, "medium");
  assert.equal(migrated.hero_image, "");
  assert.equal(migrated.boards[0].columns[0].clues[0].image, "");
});

test("difficulty uses the specified colored-shape categories", () => {
  assert.deepEqual(DIFFICULTIES, ["easy", "medium", "hard"]);
  assert.equal(difficultySymbol("easy"), "●");
  assert.equal(difficultySymbol("medium"), "■");
  assert.equal(difficultySymbol("hard"), "◆");
  const invalid = createGame();
  invalid.difficulty = "impossible";
  assert.throws(() => normalizeGame(invalid), /difficulty/);
});

test("imports enforce the declared schema", () => {
  const board = createBoard();
  board.columns[0].clues.pop();
  assert.throws(() => normalizeBoard({ board }), /exactly 5 clues/);
  const game = createGame();
  game.num_players = LIMITS.maxPlayers + 1;
  assert.throws(() => normalizeGame({ game }), /2 to 8/);
  assert.throws(() => normalizeGame({ game: { ...createGame(), size: 2 } }), /exactly 2 boards/);
});

test("Boss wagering is bounded by each player's current points", () => {
  const [player] = createPlayers(["A", "B"], 500);
  assert.throws(() => setWager(player, 0), /1 to 500/);
  assert.throws(() => setWager(player, 501), /1 to 500/);
  setWager(player, 200);
  assert.equal(player.wager, 200);
});

test("correct Boss responses win the wager and incorrect ones lose it", () => {
  const [correct, incorrect] = createPlayers(["Correct", "Incorrect"], 100);
  setWager(correct, 40);
  setWager(incorrect, 100);
  gradeBossGuess(correct, true);
  gradeBossGuess(incorrect, false);
  assert.equal(correct.points, 140);
  assert.equal(incorrect.points, 0);
  assert.equal(incorrect.eliminated, false, "zero is not fewer than zero");
});

test("players below zero after Boss grading are eliminated", () => {
  const [player] = createPlayers(["A", "B"], 100);
  player.points = 25;
  player.wager = 30;
  gradeBossGuess(player, false);
  assert.equal(player.points, -5);
  assert.equal(player.eliminated, true);
});

test("buzz timer shows 30 seconds followed by a red five-second overtime", () => {
  const deadline = 100_000;
  assert.deepEqual(buzzTimer(deadline, 65_000), { seconds: 30, overtime: false, expired: false });
  assert.deepEqual(buzzTimer(deadline, 95_000), { seconds: 5, overtime: true, expired: false });
  assert.deepEqual(buzzTimer(deadline, 100_000), { seconds: 0, overtime: true, expired: true });
});

test("hosted rooms expose a game, reject non-host closure, and cease to exist after host closure", async () => {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async deleteAll() { values.clear(); },
    async setAlarm(value) { values.set("alarm", value); },
    async deleteAlarm() { values.delete("alarm"); },
  };
  const room = new TriviaRoom({ storage });
  const created = await room.fetch(new Request("https://room/create", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: createGame() }),
  }));
  assert.equal(created.status, 201);
  const { host_token } = await created.json();
  assert.equal((await room.fetch(new Request("https://room/"))).status, 200);
  assert.equal((await room.fetch(new Request("https://room/close", { method: "POST", headers: { "x-host-token": "wrong" } }))).status, 403);
  assert.equal((await room.fetch(new Request("https://room/close", { method: "POST", headers: { "x-host-token": host_token } }))).status, 200);
  assert.equal((await room.fetch(new Request("https://room/"))).status, 404);
});


test("row values follow reordered clues across all standard rounds and exports", () => {
  const game = createGame();
  game.row_values[0] = 125; game.row_values[1] = 375;
  game.boards.push(createBoard(2, 2), createBossBoard());
  const column = game.boards[0].columns[0];
  column.clues[0].answer = "First"; column.clues[0].question = "Response"; column.clues[0].image = "image";
  column.clues[1].answer = "Second";
  assert.equal(reorderClue(game, 0, 0, 0, 1), true);
  assert.equal(column.clues[1].answer, "First");
  assert.equal(column.clues[1].question, "Response");
  assert.equal(column.clues[1].image, "image");
  assert.equal(column.clues[1].value, 375);
  column.clues[1].value = 9999; // Publishing must disregard stale per-clue values.
  const published = JSON.parse(exportGame(game)).game;
  assert.equal(published.boards[0].columns[0].clues[1].value, 375);
  assert.equal(published.boards[1].columns[1].clues[0].value, 125);
  assert.equal("value" in published.boards[2].columns[0].clues[0], false);
  assert.equal(reorderClue(game, 0, 0, 0, -1), false);
  assert.equal(reorderClue(game, 2, 0, 0, 1), false);
});

test("legacy games adopt the first topic's row values and default to all ages", () => {
  const legacy = createGame(); delete legacy.row_values; delete legacy.adult_content;
  legacy.boards[0].columns[0].clues[0].value = 150;
  const clean = normalizeGame(legacy);
  assert.equal(clean.row_values[0], 150);
  assert.equal(clean.boards[0].columns[1].clues[0].value, 150);
  assert.equal(clean.adult_content, false);
});

test("game settings survive round trips and reject invalid point values and age flags", () => {
  const game = createGame(); game.adult_content = true;
  delete game.boards[0].columns[0].clues[0].value;
  assert.equal(normalizeGame(JSON.parse(exportGame(game))).adult_content, true);
  for (const invalid of [null, [], [0], [-1], [1.5], ["200"], [Number.MAX_SAFE_INTEGER + 1], Array(17).fill(200)]) {
    assert.throws(() => normalizeGame({ ...game, row_values: invalid }), /row_values/);
  }
  assert.throws(() => normalizeGame({ ...game, adult_content: "yes" }), /adult_content/);
});
