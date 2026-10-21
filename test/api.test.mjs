import test from "node:test";
import assert from "node:assert/strict";
import { TriviaRoom, handleApi } from "../src/server/api.mjs";
import { createGame, createBoard, createBossBoard } from "../src/shared/core.mjs";

class MemoryD1 {
  constructor() {
    this.games = [];
    this.plays = [];
    this.votes = [];
  }

  prepare(sql) { return new MemoryStatement(this, sql); }
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) { this.values = values; return this; }

  summary(game) {
    return {
      ...game,
      adult_content: JSON.parse(game.game_json).adult_content ?? false,
      score: this.db.votes.filter((vote) => vote.game_id === game.id).reduce((sum, vote) => sum + vote.value, 0),
      weekly_plays: this.db.plays.filter((play) => play.game_id === game.id && play.played_at >= Date.now() - 604_800_000).length,
    };
  }

  async all() {
    if (this.sql.includes("FROM games g LEFT JOIN auth_users")) {
      return { results: this.db.games.map((game) => this.summary(game)) };
    }
    throw new Error(`Unhandled all query: ${this.sql}`);
  }

  async first(column) {
    let result;
    if (this.sql.startsWith("SELECT g.*")) {
      const game = this.db.games.find((entry) => entry.id === this.values[0]);
      result = game ? this.summary(game) : null;
    } else if (this.sql === "SELECT id FROM games WHERE id = ?") {
      const game = this.db.games.find((entry) => entry.id === this.values[0]);
      result = game ? { id: game.id } : null;
    } else if (this.sql.startsWith("SELECT COALESCE(SUM(value)")) {
      result = { score: this.db.votes.filter((vote) => vote.game_id === this.values[0]).reduce((sum, vote) => sum + vote.value, 0) };
    } else throw new Error(`Unhandled first query: ${this.sql}`);
    return column ? result?.[column] ?? null : result;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO games")) {
      const [id, title, hero_image, difficulty, game_json] = this.values;
      this.db.games.push({ id, title, hero_image, difficulty, game_json, created_at: new Date().toISOString() });
    } else if (this.sql.startsWith("INSERT INTO plays")) {
      const [id, game_id] = this.values;
      this.db.plays.push({ id, game_id, played_at: Date.now() });
    } else if (this.sql.startsWith("INSERT INTO votes")) {
      const [game_id, voter_id, value] = this.values;
      const existing = this.db.votes.find((vote) => vote.game_id === game_id && vote.voter_id === voter_id);
      if (existing) existing.value = value;
      else this.db.votes.push({ game_id, voter_id, value });
    } else throw new Error(`Unhandled run query: ${this.sql}`);
    return { success: true };
  }
}

async function body(response) { return response.json(); }

test("D1 API publishes, lists, selects, counts plays, and records one vote per browser", async () => {
  const DB = new MemoryD1();
  const game = createGame();
  game.name = "Public test game";
  game.difficulty = "hard";
  game.hero_image = "data:image/jpeg;base64,hero";

  const publishedResponse = await handleApi(new Request("https://example.test/api/games", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game }),
  }), { DB });
  assert.equal(publishedResponse.status, 201);
  const published = await body(publishedResponse);

  const selected = await body(await handleApi(new Request(`https://example.test/api/games/${published.game.id}`), { DB }));
  assert.equal(selected.game.data.name, game.name);
  assert.equal(selected.game.data.hero_image, game.hero_image);

  assert.equal((await handleApi(new Request(`https://example.test/api/games/${published.game.id}/plays`, { method: "POST" }), { DB })).status, 201);
  const voteUrl = `https://example.test/api/games/${published.game.id}/vote`;
  await handleApi(new Request(voteUrl, { method: "POST", headers: { "content-type": "application/json", "x-opentrivia-voter": "browser-a" }, body: "{\"value\":1}" }), { DB });
  const changedVote = await body(await handleApi(new Request(voteUrl, { method: "POST", headers: { "content-type": "application/json", "x-opentrivia-voter": "browser-a" }, body: "{\"value\":-1}" }), { DB }));
  assert.equal(changedVote.score, -1, "changing a vote replaces rather than duplicates it");

  const listing = await body(await handleApi(new Request("https://example.test/api/games"), { DB }));
  assert.equal(listing.games.length, 1);
  assert.equal(listing.games[0].title, game.name);
  assert.equal(listing.games[0].difficulty, "hard");
  assert.equal(listing.games[0].weekly_plays, 1);
  assert.equal(listing.games[0].score, -1);
});

class MemoryRoomStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async deleteAll() { this.values.clear(); }
  async setAlarm(value) { this.values.set("alarm", value); }
  async deleteAlarm() { this.values.delete("alarm"); }
}

async function roomCall(room, path, { method = "GET", hostToken = "", playerToken = "", body: requestBody } = {}) {
  const response = await room.fetch(new Request(`https://room/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-host-token": hostToken, "x-player-token": playerToken },
    ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
  }));
  return { response, body: await response.json() };
}

async function liveRoom() {
  const room = new TriviaRoom({ storage: new MemoryRoomStorage() });
  let currentTime = 1_000_000;
  room.now = () => currentTime;
  const game = createGame();
  game.boards[0].columns[0].clues[0].clue = "A ringed planet";
  game.boards[0].columns[0].clues[0].answer = "What is Saturn?";
  const created = await roomCall(room, "create", { method: "POST", body: { game } });
  const hostToken = created.body.host_token;
  const ada = await roomCall(room, "players", { method: "POST", body: { name: "Ada" } });
  const grace = await roomCall(room, "players", { method: "POST", body: { name: "Grace" } });
  await roomCall(room, "start", { method: "POST", hostToken, body: { starting_points: 1000 } });
  await roomCall(room, "clues", { method: "POST", hostToken, body: { board_index: 0, column_index: 0, row: 0 } });
  return {
    room,
    hostToken,
    players: [ada.body, grace.body],
    setTime(value) { currentTime = value; },
  };
}

test("room serializes simultaneous buzzes and reopens an incorrect clue for other players", async () => {
  const live = await liveRoom();
  const attempts = await Promise.all(live.players.map((player) => roomCall(live.room, "buzz", {
    method: "POST", playerToken: player.player_token, body: {},
  })));
  assert.deepEqual(attempts.map(({ response }) => response.status).sort(), [200, 409]);
  const winnerIndex = attempts.findIndex(({ response }) => response.status === 200);
  const loserIndex = 1 - winnerIndex;
  const winner = live.players[winnerIndex];
  const loser = live.players[loserIndex];
  assert.equal(attempts[winnerIndex].body.room.active_clue.deadline, 1_035_000);
  assert.equal(attempts[winnerIndex].body.room.active_clue.clue, "A ringed planet", "the clue remains visible after the first buzz");

  await roomCall(live.room, "answer", { method: "POST", playerToken: winner.player_token, body: { answer: "Saturn" } });
  const incorrect = await roomCall(live.room, "ruling", { method: "POST", hostToken: live.hostToken, body: { correct: false } });
  assert.equal(incorrect.body.room.active_clue.phase, "open");
  assert.equal(incorrect.body.room.active_clue.attempt, 2);
  assert.equal(incorrect.body.room.players.find((player) => player.id === winner.player_id).points, 800);

  const secondBuzz = await roomCall(live.room, "buzz", { method: "POST", playerToken: loser.player_token, body: {} });
  assert.equal(secondBuzz.response.status, 200);
  const correct = await roomCall(live.room, "answer", { method: "POST", playerToken: loser.player_token, body: { answer: "What is Saturn?" } });
  assert.equal(correct.body.room.active_clue, null);
  assert.equal(correct.body.room.used[0][0][0], true);
  assert.equal(correct.body.room.players.find((player) => player.id === loser.player_id).points, 1200);
});

test("a 35-second answer timeout deducts the clue value and reopens it", async () => {
  const live = await liveRoom();
  const first = live.players[0];
  const buzz = await roomCall(live.room, "buzz", { method: "POST", playerToken: first.player_token, body: {} });
  live.setTime(buzz.body.room.active_clue.deadline);
  const settled = await roomCall(live.room, "", { hostToken: live.hostToken });
  assert.equal(settled.body.room.players.find((player) => player.id === first.player_id).points, 800);
  assert.equal(settled.body.room.last_result.outcome, "timeout");
  assert.equal(settled.body.room.active_clue.phase, "open");
  assert.ok(settled.body.room.active_clue.excluded_player_ids.includes(first.player_id));
});


test("publication derives clue values from current rows and exposes the 18+ label", async () => {
  const DB = new MemoryD1();
  const game = createGame(); game.adult_content = true; game.row_values[0] = 75;
  game.boards[0].columns[0].clues[0].value = 5000;
  const response = await handleApi(new Request("https://example.test/api/games", {
    method: "POST", body: JSON.stringify({ game }),
  }), { DB });
  assert.equal(response.status, 201);
  const published = await body(response);
  assert.equal(published.game.adult_content, true);
  const selected = await body(await handleApi(new Request(`https://example.test/api/games/${published.game.id}`), { DB }));
  assert.equal(selected.game.data.boards[0].columns[0].clues[0].value, 75);
  const listing = await body(await handleApi(new Request("https://example.test/api/games"), { DB }));
  assert.equal(listing.games[0].adult_content, true);
});

test("existing published games and stored rooms preserve legacy clue meanings", async () => {
  const game = createGame();
  for (const board of game.boards) for (const column of board.columns) {
    column.clues = column.clues.map(clue => {
      const legacy = { ...clue, answer: "A ringed planet", question: "Saturn" };
      delete legacy.clue;
      delete legacy.accepted_answers;
      delete legacy.explanation;
      return legacy;
    });
  }
  const DB = new MemoryD1();
  const id = crypto.randomUUID();
  DB.games.push({ id, title: game.name, hero_image: '', difficulty: 'medium', game_json: JSON.stringify(game) });
  const selected = await body(await handleApi(new Request(`https://example.test/api/games/${id}`), { DB }));
  assert.equal(selected.game.data.boards[0].columns[0].clues[0].clue, "A ringed planet");
  assert.equal(selected.game.data.boards[0].columns[0].clues[0].answer, "Saturn");

  const storage = new MemoryRoomStorage();
  const room = new TriviaRoom({ storage });
  const created = await roomCall(room, 'create', { method: 'POST', body: { game: createGame() } });
  // Simulate a room saved by the old Worker before the content rename.
  const stored = await storage.get('room');
  stored.game = game;
  stored.started = true;
  delete stored.phase;
  delete stored.board_index;
  await storage.put('room', stored);
  const shown = await roomCall(room, 'clues', { method: 'POST', hostToken: created.body.host_token,
    body: { board_index: 0, column_index: 0, row: 0 } });
  assert.equal(shown.response.status, 200);
  assert.equal(shown.body.room.active_clue.clue, "A ringed planet");
  assert.equal(JSON.stringify(shown.body.room).includes('Saturn'), false);
});

async function timedRoom(boards, transitionSeconds = 10) {
  const storage = new MemoryRoomStorage();
  const room = new TriviaRoom({ storage });
  let now = 1_000_000;
  room.now = () => now;
  const game = createGame();
  game.boards = boards;
  game.size = boards.length;
  for (const board of boards) for (const column of board.columns) for (const clue of column.clues) {
    clue.clue = 'A ringed planet'; clue.answer = 'Saturn';
  }
  const created = await roomCall(room, 'create', { method: 'POST', body: { game } });
  const hostToken = created.body.host_token;
  const players = [];
  for (const name of ['Ada', 'Grace']) players.push((await roomCall(room, 'players', { method: 'POST', body: { name } })).body);
  const host = (path, body = {}) => roomCall(room, path, { method: 'POST', hostToken, body });
  const player = (index, path, body = {}) => roomCall(room, path, { method: 'POST', playerToken: players[index].player_token, body });
  await host('settings', { transition_seconds: transitionSeconds });
  await host('start');
  return { room, storage, host, player, hostToken, players,
    time: value => { now = value; },
    read: async (index) => (await roomCall(room, '', index === undefined ? { hostToken } : { playerToken: players[index].player_token })).body.room,
    open: row => host('clues', { board_index: 0, column_index: 0, row }),
  };
}

test('open clues expire at 30 seconds without score changes and reveal answers only on closure', async () => {
  const live = await timedRoom([createBoard(2, 1)]);
  await live.open(0);
  let view = await live.read(0);
  assert.equal(view.active_clue.deadline, 1_030_000);
  assert.equal(JSON.stringify(view).includes('Saturn'), false);
  live.time(1_029_999);
  assert.ok((await live.read()).active_clue);
  live.time(1_030_000);
  await live.room.alarm();
  view = await live.read(0);
  assert.equal(view.active_clue, null);
  assert.equal(view.used[0][0][0], true);
  assert.deepEqual(view.players.map(p => p.points), [1000, 1000]);
  assert.equal(view.last_closed.answer, 'Saturn');
  assert.equal(view.last_closed.outcome, 'unanswered');
  assert.equal((await live.player(0, 'buzz')).response.status, 409);
});

test('wrong answers reopen a fresh 30-second window; closure reveals the answer to every player', async () => {
  const live = await timedRoom([createBoard(2, 1)]);
  await live.open(0);
  await live.player(0, 'buzz');
  assert.equal((await live.read(1)).active_clue.clue, 'A ringed planet');
  live.time(1_010_000);
  await live.player(0, 'answer', { answer: 'Jupiter' });
  await live.host('ruling', { correct: false });
  assert.equal((await live.read()).active_clue.deadline, 1_040_000);
  assert.equal((await live.read(1)).last_closed, null);
  await live.player(1, 'buzz');
  await live.player(1, 'answer', { answer: 'Saturn' });
  await live.host('ruling', { correct: true });
  for (const index of [0, 1]) assert.equal((await live.read(index)).last_closed.answer, 'Saturn');
  assert.deepEqual((await live.read()).players.map(p => p.points), [800, 1200]);
});

async function expireStandardBoard(live) {
  await live.open(0); live.time(1_030_000); await live.read();
  await live.open(1); live.time(1_060_000); await live.read();
}

test('board completion uses a server countdown and starts the next board once', async () => {
  const live = await timedRoom([createBoard(2, 1), createBossBoard()]);
  await expireStandardBoard(live);
  assert.equal((await live.read()).phase, 'transition');
  assert.equal((await live.read()).transition_deadline, 1_070_000);
  assert.equal((await live.host('clues', { board_index: 1, column_index: 0, row: 0 })).response.status, 409);
  live.time(1_070_000); await live.room.alarm();
  const next = await live.read();
  assert.equal(next.board_index, 1);
  assert.equal(next.boss.phase, 'wager');
  assert.equal(next.boss.deadline, 1_100_000);
  assert.equal((await live.host('advance', { board_index: 0 })).response.status, 409);
});

test('host can configure or disable the countdown; players cannot change it or advance', async () => {
  const live = await timedRoom([createBoard(2, 1), createBoard(2, 1)]);
  await expireStandardBoard(live);
  assert.equal((await live.player(0, 'settings', { transition_seconds: 0 })).response.status, 403);
  assert.equal((await live.host('settings', { transition_seconds: -1 })).response.status, 400);
  await live.host('settings', { transition_seconds: 20 });
  assert.equal((await live.read()).transition_deadline, 1_080_000);
  await live.host('settings', { transition_seconds: 0 });
  live.time(1_200_000);
  assert.equal((await live.read()).board_index, 0);
  assert.equal((await live.read()).transition_deadline, null);
  assert.equal((await live.player(0, 'advance', { board_index: 0 })).response.status, 403);
  await live.host('advance', { board_index: 0 });
  assert.equal((await live.read()).board_index, 1);
});

test('Boss phases last 30 seconds each, protect answers, and score once on the server', async () => {
  const live = await timedRoom([createBossBoard()]);
  assert.equal((await live.read(0)).boss.clue, undefined);
  assert.equal((await live.player(0, 'wager', { wager: 1001 })).response.status, 400);
  await live.player(0, 'wager', { wager: 400 });
  await live.player(1, 'wager', { wager: 200 });
  assert.equal((await live.read(0)).boss.phase, 'wager', 'early submissions do not shorten the phase');
  assert.equal((await live.player(0, 'wager', { wager: 300 })).response.status, 409);
  live.time(1_030_000); await live.room.alarm();
  assert.equal((await live.player(0, 'wager', { wager: 300 })).response.status, 409);
  assert.equal((await live.read(0)).boss.clue, 'A ringed planet');
  assert.equal((await live.read(0)).boss.deadline, 1_060_000);
  await live.player(0, 'boss-answer', { answer: 'Saturn' });
  await live.player(1, 'boss-answer', { answer: 'Jupiter' });
  assert.equal((await live.read()).boss.phase, 'answering');
  assert.equal((await live.read(1)).boss.entries, undefined);
  assert.equal((await live.player(0, 'boss-answer', { answer: 'Changed' })).response.status, 409);
  live.time(1_060_000); await live.room.alarm();
  assert.equal((await live.read()).boss.answer, 'Saturn');
  assert.equal((await live.read(0)).boss.answer, undefined);
  assert.equal((await live.player(0, 'boss-ruling', { player_id: live.players[0].player_id, correct: true })).response.status, 403);
  assert.equal((await live.read()).boss.entries[0].automatic, true);
  const ruling = { player_id: live.players[1].player_id, correct: false };
  const responses = await Promise.all([live.host('boss-ruling', ruling), live.host('boss-ruling', ruling)]);
  assert.deepEqual(responses.map(r => r.response.status), [200, 409]);
  const finished = await live.read(0);
  assert.equal(finished.phase, 'finished');
  assert.deepEqual(finished.players.map(p => p.points), [1400, 800]);
  assert.equal(finished.last_closed.answer, 'Saturn');
  await live.room.alarm();
  assert.equal((await live.read(1)).phase, 'finished', 'finishing does not close the room');
  assert.equal((await live.player(0, 'close')).response.status, 403);
  await live.host('close');
  assert.equal((await roomCall(live.room, '')).response.status, 404);
});

test('missed Boss wagers become zero; missed answers lose the wager without host action', async () => {
  const live = await timedRoom([createBossBoard()]);
  await live.player(0, 'wager', { wager: 300 });
  live.time(1_030_000); await live.room.alarm();
  assert.equal((await live.read(1)).boss.entry.wager, 0);
  live.time(1_060_000);
  assert.equal((await live.player(0, 'boss-answer', { answer: 'Too late' })).response.status, 409);
  const finished = await live.read();
  assert.equal(finished.phase, 'finished');
  assert.deepEqual(finished.players.map(p => p.points), [700, 1000]);
});

test('players with negative points can enter a zero Boss wager', async () => {
  const live = await timedRoom([createBossBoard()]);
  const stored = await live.storage.get('room');
  stored.players[0].points = -200;
  await live.storage.put('room', stored);
  assert.equal((await live.player(0, 'wager', { wager: 1 })).response.status, 400);
  assert.equal((await live.player(0, 'wager', { wager: 0 })).response.status, 200);
});

async function setRoomAnswer(live, answer, alternatives = []) {
  const stored = await live.storage.get('room');
  Object.assign(stored.game.boards[0].columns[0].clues[0], { answer, accepted_answers: alternatives });
  await live.storage.put('room', stored);
}

test('approved number alternatives auto-score while different numbers go to the host', async () => {
  const live = await timedRoom([createBoard(2, 1)]);
  await setRoomAnswer(live, 'Henry VIII', ['Henry the 8th']);
  await live.open(0);
  await live.player(0, 'buzz');
  const wrongKing = await live.player(0, 'answer', { answer: 'Henry VII' });
  assert.equal(wrongKing.body.needs_confirmation, undefined);
  assert.equal(wrongKing.body.room.active_clue.phase, 'judging');
  assert.equal(wrongKing.body.room.players[0].points, 1000);
  await live.host('ruling', { correct: false });
  await live.player(1, 'buzz');
  const alternate = await live.player(1, 'answer', { answer: ' HENRY   THE 8TH ' });
  assert.equal(alternate.body.room.active_clue, null);
  assert.equal(alternate.body.room.players[1].points, 1200);
  assert.equal((await live.player(1, 'answer', { answer: 'Henry the 8th' })).response.status, 403);
  assert.equal((await live.host('ruling', { correct: true })).response.status, 409);
});

test('spelling review leaves the clock and score unchanged, hides the answer, and accepts a corrected draft', async () => {
  const live = await timedRoom([createBoard(2, 1)]);
  await live.open(0);
  await live.player(0, 'buzz');
  const deadline = (await live.read()).active_clue.deadline;
  const warning = await live.player(0, 'answer', { answer: 'Satrun' });
  assert.equal(warning.body.needs_confirmation, true);
  assert.equal(warning.body.room.active_clue.phase, 'answering');
  assert.equal(warning.body.room.active_clue.deadline, deadline);
  assert.equal(warning.body.room.players[0].points, 1000);
  assert.equal(JSON.stringify(warning.body).includes('Saturn'), false);
  assert.equal((await live.read(1)).active_clue.typo_warning_answer, undefined);
  assert.equal((await live.player(0, 'answer', { answer: 'Satrun' })).body.needs_confirmation, true);
  const accepted = await live.player(0, 'answer', { answer: 'Saturn' });
  assert.equal(accepted.body.room.active_clue, null);
  assert.equal(accepted.body.room.players[0].points, 1200);
});

test('a player can submit a possible typo unchanged for host review, but cannot extend the deadline', async () => {
  const live = await timedRoom([createBoard(2, 1)]);
  await live.open(0); await live.player(0, 'buzz');
  await live.player(0, 'answer', { answer: 'Satrun' });
  const confirmed = await live.player(0, 'answer', { answer: 'Satrun', confirm_typo: true });
  assert.equal(confirmed.body.room.active_clue.phase, 'judging');
  assert.equal(confirmed.body.room.players[0].points, 1000);
  await live.host('ruling', { correct: false });
  await live.player(1, 'buzz');
  await live.player(1, 'answer', { answer: 'Satrun' });
  live.time((await live.read()).active_clue.deadline);
  assert.equal((await live.player(1, 'answer', { answer: 'Saturn' })).response.status, 403);
  assert.equal((await live.read()).players[1].points, 800);
});

test('Boss corrections stay private; automatic scoring waits for the shared deadline', async () => {
  const live = await timedRoom([createBossBoard()]);
  await setRoomAnswer(live, 'Henry VIII', ['Henry the 8th']);
  await live.player(0, 'wager', { wager: 100 }); await live.player(1, 'wager', { wager: 200 });
  live.time(1_030_000); await live.read();
  await live.player(0, 'boss-answer', { answer: 'Henry the 8th' });
  assert.deepEqual((await live.read(0)).players.map(p => p.points), [1000, 1000]);
  assert.equal((await live.read(0)).boss.entry.correct, undefined);
  await live.player(1, 'boss-answer', { answer: 'Henry VII' });
  live.time(1_060_000); await live.read();
  assert.deepEqual((await live.read()).players.map(p => p.points), [1100, 1000]);
  assert.equal((await live.read()).boss.entries[1].graded, false);
});

test('Boss typo confirmation can be edited or submitted unchanged without revealing candidates', async () => {
  const live = await timedRoom([createBossBoard()]);
  await live.player(0, 'wager', { wager: 100 }); await live.player(1, 'wager', { wager: 200 });
  live.time(1_030_000); await live.read();
  const warning = await live.player(0, 'boss-answer', { answer: 'Satrun' });
  assert.equal(warning.body.needs_confirmation, true);
  assert.equal(warning.body.room.boss.entry.answer, null);
  assert.equal(JSON.stringify(warning.body).includes('Saturn'), false);
  await live.player(0, 'boss-answer', { answer: 'Saturn' });
  await live.player(1, 'boss-answer', { answer: 'Satrun' });
  await live.player(1, 'boss-answer', { answer: 'Satrun', confirm_typo: true });
  live.time(1_060_000);
  assert.equal((await live.read()).boss.entries[0].automatic, true);
  assert.equal((await live.read()).boss.entries[1].graded, false);
});
