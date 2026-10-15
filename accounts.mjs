import { cookieValue, fail, json, readBody, resolveAccount, validMutation } from './auth.mjs';
import { normalizeGame } from './core.mjs';

export async function handleAccounts(request, env) {
  if (!env.DB) return fail('Accounts need the Cloudflare server.', 503);
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/account') return json({ account: await resolveAccount(request, env) });
  return fail('Use the Better Auth endpoints at /api/auth/.', 410);
}

function gameSummary(row) {
  return { id: row.id, title: row.title, revision: row.revision, published_id: row.published_id, updated_at: row.updated_at };
}
export async function handleAccountGames(request, env) {
  const DB = env.DB;
  if (!DB) return fail('Cloud games need the Cloudflare server.', 503);
  const account = await resolveAccount(request, env);
  if (!account) return fail('Sign in to access your games.', 401);
  const expected = request.headers.get('x-opentrivia-account');
  if (expected && expected !== account.id) return fail('Your account changed in another tab. Reload to continue.', 409);
  if (request.method !== 'GET' && !validMutation(request)) return fail('Invalid request origin or content type.', 403);
  const path = new URL(request.url).pathname;
  if (path === '/api/account/games' && request.method === 'GET') {
    const rows = await DB.prepare('SELECT id, title, revision, published_id, updated_at FROM account_games WHERE account_id = ? ORDER BY updated_at DESC, id').bind(account.id).all();
    return json({ games: rows.results.map(gameSummary) });
  }
  const match = path.match(/^\/api\/account\/games\/([a-f0-9-]{36})(\/publish)?$/);
  if (!match) return fail('Cloud game route not found.', 404);
  const id = match[1];
  const row = await DB.prepare('SELECT * FROM account_games WHERE id = ? AND account_id = ?').bind(id, account.id).first();
  if (request.method === 'GET' && !match[2]) return row ? json({ game: { ...gameSummary(row), data: JSON.parse(row.game_json) } }) : fail('Game not found.', 404);
  if (request.method === 'PUT' && !match[2]) {
    let body, game;
    try { body = await readBody(request, 1_800_000); game = normalizeGame(body.game); } catch (error) { return fail(error.message); }
    if (!Number.isInteger(body.revision) || body.revision < 0) return fail('A game revision is required.');
    if (!row && body.revision !== 0 || row && row.revision !== body.revision) return fail('This game changed on another device. Open the cloud version or save your edits as a new game.', 409);
    let saved;
    if (!row) {
      try { saved = await DB.prepare('INSERT INTO account_games (id, account_id, title, game_json) VALUES (?, ?, ?, ?) RETURNING id, title, revision, published_id, updated_at').bind(id, account.id, game.name, JSON.stringify(game)).first(); }
      catch (error) { if (/UNIQUE/.test(error.message)) return fail('This game changed. Save your edits as a new game.', 409); throw error; }
    } else {
      saved = await DB.prepare(`UPDATE account_games SET title = ?, game_json = ?, revision = revision + 1, updated_at = datetime('now')
        WHERE id = ? AND account_id = ? AND revision = ? RETURNING id, title, revision, published_id, updated_at`).bind(game.name, JSON.stringify(game), id, account.id, body.revision).first();
      if (!saved) return fail('This game changed on another device. Save your edits as a new game.', 409);
    }
    return json({ game: gameSummary(saved) });
  }
  if (!row) return fail('Game not found.', 404);
  if (request.method === 'POST' && match[2]) {
    let body;
    try { body = await readBody(request); } catch (error) { return fail(error.message); }
    if (body.revision !== row.revision) return fail('Save the latest changes before publishing.', 409);
    const game = JSON.parse(row.game_json);
    if (game.boards.some(b => b.columns.some(c => c.clues.some(q => !q.clue.trim() || !q.answer.trim())))) return fail('Complete every clue and response before publishing.');
    const published = row.published_id || crypto.randomUUID();
    // One batch serializes publishing with concurrent saves. A stale revision does not publish.
    const results = await DB.batch([
      DB.prepare(`INSERT INTO games (id, title, hero_image, difficulty, game_json, account_id)
        SELECT COALESCE(published_id, ?), title, ?, ?, game_json, account_id FROM account_games WHERE id = ? AND account_id = ? AND revision = ?
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, hero_image = excluded.hero_image, difficulty = excluded.difficulty, game_json = excluded.game_json
        WHERE games.account_id = excluded.account_id`).bind(published, game.hero_image, game.difficulty, id, account.id, body.revision),
      DB.prepare('UPDATE account_games SET published_id = COALESCE(published_id, ?) WHERE id = ? AND account_id = ? AND revision = ?').bind(published, id, account.id, body.revision),
    ]);
    if (!results[0].meta.changes) return fail('This game changed. Save and review it again before publishing.', 409);
    const current = await DB.prepare('SELECT published_id FROM account_games WHERE id = ? AND account_id = ?').bind(id, account.id).first();
    return json({ game: { id: current.published_id, title: game.name } });
  }
  return fail('Cloud game route not found.', 404);
}

// Read-only preview uses the same guest eligibility rules as the atomic claim.
export async function previewDailyClaim(request, DB, account) {
  if (!account) return fail('Sign in before reviewing guest scores.', 401);
  const guest = cookieValue(request, 'opentrivia_daily');
  const empty = { days: 0, answers: 0, overlappingDays: 0, overlappingAnswers: 0 };
  if (!/^[a-f0-9-]{36}$/.test(guest)) return json(empty);
  const eligible = await DB.prepare(`SELECT id FROM daily_players WHERE id = ? AND account_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM daily_claims WHERE player_id = ?)`).bind(guest, guest).first();
  if (!eligible) return json(empty);
  const summary = await DB.prepare(`SELECT COUNT(*) AS days,
    SUM(EXISTS (SELECT 1 FROM daily_attempts WHERE player_id = ? AND day = g.day)) AS answers,
    SUM(EXISTS (SELECT 1 FROM daily_runs WHERE player_id = ? AND day = g.day)) AS overlappingDays,
    SUM(EXISTS (SELECT 1 FROM daily_attempts WHERE player_id = ? AND day = g.day)
      AND EXISTS (SELECT 1 FROM daily_attempts WHERE player_id = ? AND day = g.day)) AS overlappingAnswers
    FROM daily_runs g WHERE g.player_id = ?`).bind(guest, account.id, guest, account.id, guest).first();
  return json(Object.fromEntries(Object.keys(empty).map(key => [key, Number(summary[key] || 0)])));
}

export async function claimDaily(request, DB, account) {
  if (!account) return fail('Sign in before claiming guest scores.', 401);
  if (request.headers.get('x-opentrivia-account') && request.headers.get('x-opentrivia-account') !== account.id) return fail('Your account changed. Reload to continue.', 409);
  if (!validMutation(request)) return fail('Invalid request origin or content type.', 403);
  const guest = cookieValue(request, 'opentrivia_daily');
  if (!/^[a-f0-9-]{36}$/.test(guest)) return json({ claimed: false });
  // The claim row is the atomic ownership lock. Every transfer statement is guarded by it.
  await DB.batch([
    DB.prepare(`INSERT INTO daily_claims (player_id, account_id) SELECT id, ? FROM daily_players
      WHERE id = ? AND account_id IS NULL ON CONFLICT(player_id) DO NOTHING`).bind(account.id, guest),
    DB.prepare(`INSERT INTO daily_runs (day, player_id, started_at, voided)
      SELECT day, ?, started_at, voided FROM daily_runs WHERE player_id = ? AND EXISTS (SELECT 1 FROM daily_claims WHERE player_id = ? AND account_id = ?)
      ON CONFLICT(day, player_id) DO UPDATE SET started_at = MIN(started_at, excluded.started_at), voided = 1`).bind(account.id, guest, guest, account.id),
    DB.prepare(`INSERT INTO daily_attempts (day, player_id, answer, points, submitted_at, completion_ms)
      SELECT day, ?, answer, points, submitted_at, completion_ms FROM daily_attempts WHERE player_id = ? AND EXISTS (SELECT 1 FROM daily_claims WHERE player_id = ? AND account_id = ?)
      ON CONFLICT(day, player_id) DO NOTHING`).bind(account.id, guest, guest, account.id),
    DB.prepare(`UPDATE daily_attempts SET completion_ms = NULL WHERE player_id = ? AND day IN (SELECT day FROM daily_runs WHERE player_id = ? AND voided = 1)`).bind(account.id, account.id),
    DB.prepare('DELETE FROM daily_attempts WHERE player_id = ? AND EXISTS (SELECT 1 FROM daily_claims WHERE player_id = ? AND account_id = ?)').bind(guest, guest, account.id),
    DB.prepare('DELETE FROM daily_runs WHERE player_id = ? AND EXISTS (SELECT 1 FROM daily_claims WHERE player_id = ? AND account_id = ?)').bind(guest, guest, account.id),
  ]);
  const claim = await DB.prepare('SELECT account_id FROM daily_claims WHERE player_id = ?').bind(guest).first();
  return json({ claimed: claim?.account_id === account.id }, 200, { 'set-cookie': `opentrivia_daily=; HttpOnly; SameSite=Lax; Path=/api/daily; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` });
}
