import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
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
} from "../core.mjs";

test("new games use the required defaults", () => {
  const game = createGame();
  assert.equal(game.num_players, 3);
  assert.equal(game.boards.length, 1);
  assert.equal(game.boards[0].columns.length, 6);
  assert.equal(game.boards[0].columns[0].size, 5);
  assert.equal(game.boards[0].columns[0].clues.length, 5);
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
  const parsed = JSON.parse(exportGame(game));
  assert.equal(parsed.game.size, 2);
  assert.equal(normalizeGame(parsed).boards.length, 2);
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
