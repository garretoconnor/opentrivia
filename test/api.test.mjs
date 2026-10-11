import test from "node:test";
import assert from "node:assert/strict";
import { TriviaRoom, handleApi } from "../api.mjs";
import { createGame } from "../core.mjs";

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
      score: this.db.votes.filter((vote) => vote.game_id === game.id).reduce((sum, vote) => sum + vote.value, 0),
      weekly_plays: this.db.plays.filter((play) => play.game_id === game.id && play.played_at >= Date.now() - 604_800_000).length,
    };
  }

  async all() {
    if (this.sql.includes("FROM games g LEFT JOIN votes")) {
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
  game.boards[0].columns[0].clues[0].answer = "A ringed planet";
  game.boards[0].columns[0].clues[0].question = "What is Saturn?";
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
  assert.equal("clue" in attempts[winnerIndex].body.room.active_clue, false, "the clue disappears after the first buzz");

  await roomCall(live.room, "answer", { method: "POST", playerToken: winner.player_token, body: { answer: "Saturn" } });
  const incorrect = await roomCall(live.room, "ruling", { method: "POST", hostToken: live.hostToken, body: { correct: false } });
  assert.equal(incorrect.body.room.active_clue.phase, "open");
  assert.equal(incorrect.body.room.active_clue.attempt, 2);
  assert.equal(incorrect.body.room.players.find((player) => player.id === winner.player_id).points, 800);

  const secondBuzz = await roomCall(live.room, "buzz", { method: "POST", playerToken: loser.player_token, body: {} });
  assert.equal(secondBuzz.response.status, 200);
  await roomCall(live.room, "answer", { method: "POST", playerToken: loser.player_token, body: { answer: "What is Saturn?" } });
  const correct = await roomCall(live.room, "ruling", { method: "POST", hostToken: live.hostToken, body: { correct: true } });
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
