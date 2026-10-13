import { handleDaily } from "./daily.mjs";
import { handleAdmin } from "./admin.mjs";
import { normalizeGame } from "./core.mjs?v=0.6.0";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ANSWER_TIME_MS = 35_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("The uploaded game is too large (2 MB maximum).");
  return request.json();
}

function gameSummary(row) {
  return {
    id: row.id,
    title: row.title,
    hero_image: row.hero_image,
    difficulty: row.difficulty,
    adult_content: Boolean(row.adult_content ?? (row.game_json ? JSON.parse(row.game_json).adult_content : false)),
    score: Number(row.score || 0),
    weekly_plays: Number(row.weekly_plays || 0),
  };
}

function randomCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/auth" || path.startsWith("/api/auth/")) {
      const { handleAuth } = await import("./better-auth-server.mjs");
      return await handleAuth(request, env);
    }
    if (path === "/api/account" || path.startsWith("/api/account/")) {
      const { handleAccounts, handleAccountGames } = await import("./accounts.mjs");
      return path.startsWith("/api/account/games") ? await handleAccountGames(request, env) : await handleAccounts(request, env);
    }
    if (path === "/api/admin" || path.startsWith("/api/admin/")) return await handleAdmin(request, env);
    if (path === "/api/daily" || path.startsWith("/api/daily/")) return await handleDaily(request, env);
    if (path === "/api/games" && request.method === "GET") {
      if (!env.DB) return error("The public library is not configured.", 503);
      const result = await env.DB.prepare(`
        SELECT g.id, g.title, g.hero_image, g.difficulty,
          COALESCE(json_extract(g.game_json, '$.adult_content'), 0) AS adult_content,
          COALESCE(SUM(v.value), 0) AS score,
          (SELECT COUNT(*) FROM plays p WHERE p.game_id = g.id AND p.played_at >= datetime('now', '-7 days')) AS weekly_plays
        FROM games g LEFT JOIN votes v ON v.game_id = g.id
        GROUP BY g.id
        ORDER BY weekly_plays DESC, score DESC, g.created_at DESC
      `).all();
      return json({ games: result.results.map(gameSummary) });
    }

    if (path === "/api/games" && request.method === "POST") {
      if (!env.DB) return error("Publishing is not configured.", 503);
      const body = await readJson(request);
      const game = normalizeGame(body.game ?? body);
      if (!game.name.trim()) return error("Give the game a title before publishing.");
      const id = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO games (id, title, hero_image, difficulty, game_json)
        VALUES (?, ?, ?, ?, ?)
      `).bind(id, game.name.trim(), game.hero_image, game.difficulty, JSON.stringify(game)).run();
      return json({ game: { id, title: game.name.trim(), hero_image: game.hero_image, difficulty: game.difficulty, adult_content: game.adult_content, score: 0, weekly_plays: 0 } }, 201);
    }

    const gameMatch = path.match(/^\/api\/games\/([a-f0-9-]+)$/i);
    if (gameMatch && request.method === "GET") {
      if (!env.DB) return error("The public library is not configured.", 503);
      const row = await env.DB.prepare(`
        SELECT g.*,
          COALESCE((SELECT SUM(value) FROM votes WHERE game_id = g.id), 0) AS score,
          (SELECT COUNT(*) FROM plays WHERE game_id = g.id AND played_at >= datetime('now', '-7 days')) AS weekly_plays
        FROM games g WHERE g.id = ?
      `).bind(gameMatch[1]).first();
      if (!row) return error("Game not found.", 404);
      return json({ game: { ...gameSummary(row), data: normalizeGame(JSON.parse(row.game_json)) } });
    }

    const playMatch = path.match(/^\/api\/games\/([a-f0-9-]+)\/plays$/i);
    if (playMatch && request.method === "POST") {
      if (!env.DB) return error("Play tracking is not configured.", 503);
      const game = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(playMatch[1]).first();
      if (!game) return error("Game not found.", 404);
      await env.DB.prepare("INSERT INTO plays (id, game_id) VALUES (?, ?)")
        .bind(crypto.randomUUID(), playMatch[1]).run();
      return json({ recorded: true }, 201);
    }

    const voteMatch = path.match(/^\/api\/games\/([a-f0-9-]+)\/vote$/i);
    if (voteMatch && request.method === "POST") {
      if (!env.DB) return error("Ratings are not configured.", 503);
      const body = await readJson(request);
      if (body.value !== 1 && body.value !== -1) return error("Vote must be 1 or -1.");
      const voter = String(request.headers.get("x-opentrivia-voter") || "").slice(0, 100);
      if (!voter) return error("A voter identifier is required.");
      const game = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(voteMatch[1]).first();
      if (!game) return error("Game not found.", 404);
      await env.DB.prepare(`
        INSERT INTO votes (game_id, voter_id, value) VALUES (?, ?, ?)
        ON CONFLICT(game_id, voter_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).bind(voteMatch[1], voter, body.value).run();
      const score = await env.DB.prepare("SELECT COALESCE(SUM(value), 0) AS score FROM votes WHERE game_id = ?")
        .bind(voteMatch[1]).first("score");
      return json({ score: Number(score || 0), vote: body.value });
    }

    if (path === "/api/rooms" && request.method === "POST") {
      if (!env.ROOMS) return error("Hosting is not configured.", 503);
      const body = await readJson(request);
      const game = normalizeGame(body.game ?? body);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await stub.fetch("https://room/create", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ game }),
        });
        if (response.status === 201) return json({ ...(await response.json()), code }, 201);
      }
      return error("Could not reserve a room code. Try again.", 503);
    }

    const roomMatch = path.match(/^\/api\/rooms\/([A-Z2-9]{6})$/i);
    if (roomMatch && request.method === "GET") {
      if (!env.ROOMS) return error("Hosting is not configured.", 503);
      const code = roomMatch[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch("https://room/", {
        headers: {
          "x-host-token": request.headers.get("x-host-token") || "",
          "x-player-token": request.headers.get("x-player-token") || "",
        },
      });
    }

    const roomActionMatch = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(players|start|clues|buzz|answer|ruling)$/i);
    if (roomActionMatch && request.method === "POST") {
      if (!env.ROOMS) return error("Hosting is not configured.", 503);
      const code = roomActionMatch[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(`https://room/${roomActionMatch[2].toLowerCase()}`, {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-host-token": request.headers.get("x-host-token") || "",
          "x-player-token": request.headers.get("x-player-token") || "",
        },
        body: await request.text(),
      });
    }

    const closeMatch = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/close$/i);
    if (closeMatch && request.method === "POST") {
      if (!env.ROOMS) return error("Hosting is not configured.", 503);
      const code = closeMatch[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch("https://room/close", {
        method: "POST",
        headers: { "x-host-token": request.headers.get("x-host-token") || "" },
      });
    }

    return error("API route not found.", 404);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unexpected server error.";
    return error(message, /JSON|game\.|must|title|large/i.test(message) ? 400 : 500);
  }
}

export class TriviaRoom {
  constructor(state) {
    this.state = state;
    this.mutationQueue = Promise.resolve();
    this.now = () => Date.now();
  }

  async fetch(request) {
    const operation = this.mutationQueue.then(() => this.handleRequest(request));
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }

  async handleRequest(request) {
    const path = new URL(request.url).pathname;
    if (path === "/create" && request.method === "POST") {
      const existing = await this.state.storage.get("room");
      if (existing) return error("Room code already exists.", 409);
      const body = await request.json();
      const host_token = crypto.randomUUID();
      const room = {
        game: normalizeGame(body.game),
        host_token,
        expires_at: this.now() + ROOM_TTL_MS,
        players: [],
        started: false,
        used: body.game.boards.map((board) => board.columns.map((column) => column.clues.map(() => false))),
        active_clue: null,
        last_result: null,
        revision: 0,
      };
      await this.state.storage.put("room", room);
      await this.state.storage.setAlarm(room.expires_at);
      return json({ host_token, expires_at: room.expires_at }, 201);
    }

    const room = await this.state.storage.get("room");
    if (!room || room.expires_at <= this.now()) {
      if (room) await this.state.storage.deleteAll();
      return error("That room is closed or has expired.", 404);
    }
    room.game = normalizeGame(room.game);
    if (await this.settleTimeout(room)) await this.persist(room);

    if (path === "/close" && request.method === "POST") {
      if (!this.isHost(request, room)) return error("Only the host can close this room.", 403);
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      return json({ closed: true });
    }
    if (path === "/" && request.method === "GET") {
      return json({ room: this.snapshot(room, request) });
    }
    if (path === "/players" && request.method === "POST") {
      if (room.started) return error("This game has already started.", 409);
      if (room.players.length >= room.game.num_players) return error("This room is full.", 409);
      const body = await request.json();
      const name = String(body.name || "").trim().slice(0, 30);
      if (!name) return error("Enter a player name.");
      const player = {
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        name,
        points: 1000,
      };
      room.players.push(player);
      await this.persist(room);
      return json({ player_id: player.id, player_token: player.token, room: this.snapshot(room, request, player) }, 201);
    }
    if (path === "/start" && request.method === "POST") {
      if (!this.isHost(request, room)) return error("Only the host can start the game.", 403);
      if (room.started) return error("This game has already started.", 409);
      if (room.players.length < 2) return error("At least two players must join before starting.", 409);
      const body = await request.json().catch(() => ({}));
      const startingPoints = body.starting_points ?? 1000;
      if (!Number.isInteger(startingPoints) || startingPoints < 1) return error("Starting points must be a positive integer.");
      for (const player of room.players) player.points = startingPoints;
      room.started = true;
      await this.persist(room);
      return json({ room: this.snapshot(room, request) });
    }
    if (path === "/clues" && request.method === "POST") {
      if (!this.isHost(request, room)) return error("Only the host can show a clue.", 403);
      if (!room.started) return error("Start the game before showing a clue.", 409);
      if (room.active_clue) return error("Finish the current clue first.", 409);
      const body = await request.json();
      const location = this.clueAt(room, body.board_index, body.column_index, body.row);
      if (!location || location.boss) return error("Choose an unused standard clue.");
      if (room.used[body.board_index][body.column_index][body.row]) return error("That clue has already been played.", 409);
      room.active_clue = {
        board_index: body.board_index,
        column_index: body.column_index,
        row: body.row,
        phase: "open",
        excluded_player_ids: [],
        attempt: 1,
        buzzer_id: null,
        buzzed_at: null,
        deadline: null,
        answer: null,
      };
      room.last_result = null;
      await this.persist(room);
      return json({ room: this.snapshot(room, request) });
    }
    if (path === "/buzz" && request.method === "POST") {
      const player = this.playerFor(request, room);
      if (!player) return error("Join this room before buzzing.", 403);
      const active = room.active_clue;
      if (!active || active.phase !== "open") return error("Buzzing is not open.", 409);
      if (active.excluded_player_ids.includes(player.id)) return error("You already attempted this clue.", 409);
      active.phase = "answering";
      active.buzzer_id = player.id;
      active.buzzed_at = this.now();
      active.deadline = active.buzzed_at + ANSWER_TIME_MS;
      active.answer = null;
      await this.persist(room);
      return json({ first: true, room: this.snapshot(room, request) });
    }
    if (path === "/answer" && request.method === "POST") {
      const player = this.playerFor(request, room);
      const active = room.active_clue;
      if (!player || !active || active.phase !== "answering" || active.buzzer_id !== player.id) {
        return error("Only the first player to buzz can submit this answer.", 403);
      }
      const body = await request.json();
      const answerText = String(body.answer || "").trim().slice(0, 500);
      if (!answerText) return error("Enter an answer before submitting.");
      active.answer = answerText;
      active.phase = "judging";
      active.submitted_at = this.now();
      await this.persist(room);
      return json({ submitted: true, room: this.snapshot(room, request) });
    }
    if (path === "/ruling" && request.method === "POST") {
      if (!this.isHost(request, room)) return error("Only the host can rule on an answer.", 403);
      const active = room.active_clue;
      if (!active || active.phase !== "judging") return error("There is no submitted answer to judge.", 409);
      const body = await request.json();
      if (typeof body.correct !== "boolean") return error("A ruling must be correct or incorrect.");
      this.finishAttempt(room, body.correct ? "correct" : "incorrect");
      await this.persist(room);
      return json({ room: this.snapshot(room, request) });
    }
    return error("Room route not found.", 404);
  }

  isHost(request, room) {
    return request.headers.get("x-host-token") === room.host_token;
  }

  playerFor(request, room) {
    const token = request.headers.get("x-player-token");
    return room.players.find((player) => player.token === token) || null;
  }

  clueAt(room, boardIndex, columnIndex, row) {
    if (![boardIndex, columnIndex, row].every(Number.isInteger)) return null;
    const board = room.game.boards[boardIndex];
    const column = board?.columns[columnIndex];
    const clue = column?.clues[row];
    if (!clue) return null;
    return { board, column, clue, boss: board.columns.length === 1 && column.size === 1 && column.clues.length === 1 };
  }

  finishAttempt(room, outcome) {
    const active = room.active_clue;
    const location = this.clueAt(room, active.board_index, active.column_index, active.row);
    const player = room.players.find((entry) => entry.id === active.buzzer_id);
    if (!location || !player) return;
    const value = location.clue.value;
    player.points += outcome === "correct" ? value : -value;
    const result = { outcome, player_id: player.id, player_name: player.name, value, at: this.now() };
    if (outcome === "correct") {
      room.used[active.board_index][active.column_index][active.row] = true;
      room.active_clue = null;
      room.last_result = result;
      return;
    }
    active.excluded_player_ids.push(player.id);
    room.last_result = result;
    const eligible = room.players.some((entry) => !active.excluded_player_ids.includes(entry.id));
    if (!eligible) {
      room.used[active.board_index][active.column_index][active.row] = true;
      room.active_clue = null;
      return;
    }
    active.phase = "open";
    active.attempt += 1;
    active.buzzer_id = null;
    active.buzzed_at = null;
    active.deadline = null;
    active.answer = null;
    delete active.submitted_at;
  }

  async settleTimeout(room) {
    const active = room.active_clue;
    if (!active || active.phase !== "answering" || active.deadline > this.now()) return false;
    this.finishAttempt(room, "timeout");
    return true;
  }

  snapshot(room, request, explicitPlayer = null) {
    const host = this.isHost(request, room);
    const viewer = explicitPlayer || this.playerFor(request, room);
    const active = room.active_clue;
    let activeClue = null;
    if (active) {
      const location = this.clueAt(room, active.board_index, active.column_index, active.row);
      const buzzer = room.players.find((player) => player.id === active.buzzer_id);
      activeClue = {
        board_index: active.board_index,
        column_index: active.column_index,
        row: active.row,
        phase: active.phase,
        attempt: active.attempt,
        excluded_player_ids: [...active.excluded_player_ids],
        buzzer: buzzer ? { id: buzzer.id, name: buzzer.name } : null,
        deadline: active.deadline,
        topic: location?.column.topic || "Untitled topic",
        value: location?.clue.value || 0,
        ...(active.phase === "open" ? { clue: location?.clue.clue || "No clue was provided.", image: location?.clue.image || "" } : {}),
        ...(host && active.answer !== null ? { submitted_answer: active.answer } : {}),
      };
    }
    return {
      game: { name: room.game.name },
      expires_at: room.expires_at,
      started: room.started,
      players: room.players.map(({ id, name, points }) => ({ id, name, points })),
      used: room.used,
      active_clue: activeClue,
      last_result: room.last_result,
      revision: room.revision,
      viewer: viewer ? { id: viewer.id, name: viewer.name } : null,
    };
  }

  async persist(room) {
    room.revision += 1;
    await this.state.storage.put("room", room);
    const deadline = room.active_clue?.phase === "answering" ? room.active_clue.deadline : room.expires_at;
    await this.state.storage.setAlarm(Math.min(deadline, room.expires_at));
  }

  async alarm() {
    const operation = this.mutationQueue.then(async () => {
      const room = await this.state.storage.get("room");
      if (!room || room.expires_at <= this.now()) {
        await this.state.storage.deleteAll();
        return;
      }
      await this.settleTimeout(room);
      await this.persist(room);
    });
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }
}
