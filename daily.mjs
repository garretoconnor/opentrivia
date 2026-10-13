import { matchesAnswer } from './core.mjs';
export { normalizeAnswer } from './core.mjs';

const DAY_MS = 86_400_000;
const OFFSET_MS = 7 * 60 * 60 * 1000;
const COOKIE = 'opentrivia_daily';

export function triviaDay(now = Date.now()) {
  return new Date(now - OFFSET_MS).toISOString().slice(0, 10);
}
export function nextRollover(now = Date.now()) {
  return new Date(Date.parse(`${triviaDay(now)}T07:00:00Z`) + DAY_MS).toISOString();
}
export function calendarSeason(day) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const startYear = month < 3 ? year - 1 : year;
  const name = month >= 3 && month <= 5 ? 'Spring'
    : month >= 6 && month <= 8 ? 'Summer'
    : month >= 9 && month <= 11 ? 'Fall' : 'Winter';
  const startMonth = { Spring: '03', Summer: '06', Fall: '09', Winter: '12' }[name];
  const endMonth = { Spring: '06', Summer: '09', Fall: '12', Winter: '03' }[name];
  return {
    id: `${name.toLowerCase()}-${startYear}`,
    name: `${name} ${startYear}${name === 'Winter' ? `–${startYear + 1}` : ''}`,
    starts_on: `${startYear}-${startMonth}-01`,
    ends_on: `${name === 'Winter' ? startYear + 1 : startYear}-${endMonth}-01`,
  };
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers,
  } });
}
function fail(error, status = 400) { return json({ error }, status); }
function playerId(request) {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9-]{36}$/.test(value || '') ? value : null;
}
async function readBody(request) {
  const text = await request.text();
  if (text.length > 4096) throw new Error('Request is too large.');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON.'); }
}
async function current(DB, now) {
  const day = triviaDay(now);
  const defaults = calendarSeason(day);
  // Preserve configured seasons. Create the default once, including under concurrent requests.
  await DB.prepare(`INSERT INTO daily_seasons (id, name, starts_on, ends_on)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM daily_seasons WHERE starts_on < ? AND ends_on > ?
    ) ON CONFLICT(id) DO NOTHING`).bind(defaults.id, defaults.name, defaults.starts_on,
      defaults.ends_on, defaults.ends_on, defaults.starts_on).run();
  const season = await DB.prepare('SELECT * FROM daily_seasons WHERE starts_on <= ? AND ends_on > ?').bind(day, day).first();
  if (!season) return { day, season: null, challenge: null };
  // One atomic statement chooses and snapshots a question. Racing requests share the day PK.
  await DB.prepare(`INSERT INTO daily_challenges
    (day, season_id, question_id, topic, clue, answer, image, accepted_answers, explanation)
    SELECT ?, ?, q.id, q.topic, q.clue, q.answer, q.image, q.accepted_answers, q.explanation
    FROM daily_questions q WHERE q.enabled = 1
      AND NOT EXISTS (SELECT 1 FROM daily_challenges WHERE question_id = q.id)
      AND NOT EXISTS (SELECT 1 FROM daily_challenges WHERE day = ?)
    ORDER BY q.queue_order, q.id LIMIT 1 ON CONFLICT(day) DO NOTHING`).bind(day, season.id, day).run();
  const challenge = await DB.prepare('SELECT * FROM daily_challenges WHERE day = ?').bind(day).first();
  return { day, season, challenge };
}
function result(attempt, challenge) {
  return attempt ? { submitted_answer: attempt.answer, points: attempt.points,
    correct_answer: challenge.answer, explanation: challenge.explanation } : null;
}
async function leaderboard(DB, day, seasonId, scope) {
  const filter = scope === 'daily' ? 'a.day = ?' : 'c.season_id = ?';
  const rows = await DB.prepare(`SELECT p.name, SUM(a.points) AS points, COUNT(*) AS played,
    RANK() OVER (ORDER BY SUM(a.points) DESC) AS rank
    FROM daily_attempts a JOIN daily_players p ON p.id = a.player_id
    JOIN daily_challenges c ON c.day = a.day WHERE ${filter}
    GROUP BY p.id, p.name ORDER BY points DESC, p.name, p.id LIMIT 100`)
    .bind(scope === 'daily' ? day : seasonId).all();
  return rows.results;
}

export async function handleDaily(request, env, now = () => Date.now()) {
  if (!env.DB) return fail('Daily trivia is not configured.', 503);
  const DB = env.DB;
  const path = new URL(request.url).pathname;
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return fail('Invalid request origin.', 403);
  }
  let id = playerId(request);
  if (path === '/api/daily/player' && request.method === 'POST') {
    let body;
    try { body = await readBody(request); } catch (error) { return fail(error.message); }
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 30) return fail('Enter a name of 1–30 characters.');
    const existing = id && await DB.prepare('SELECT * FROM daily_players WHERE id = ?').bind(id).first();
    if (!existing) id = crypto.randomUUID();
    await DB.prepare(`INSERT INTO daily_players (id, name) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name`).bind(id, name).run();
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return json({ player: { name } }, 200, {
      'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/api/daily; Max-Age=31536000${secure}`,
    });
  }
  if (!((path === '/api/daily' && request.method === 'GET') ||
    (path === '/api/daily/answer' && request.method === 'POST'))) return fail('Daily route not found.', 404);

  const timestamp = now();
  const { day, season, challenge } = await current(DB, timestamp);
  const player = id && await DB.prepare('SELECT * FROM daily_players WHERE id = ?').bind(id).first();
  if (path === '/api/daily/answer') {
    if (!player) return fail('Choose a player name first.', 401);
    let body;
    try { body = await readBody(request); } catch (error) { return fail(error.message); }
    if (body?.day !== day || triviaDay(now()) !== day) return fail('The daily question has changed. Refresh to play the new question.', 409);
    if (!challenge) return fail('No question is available today.', 409);
    if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 300) return fail('Enter an answer of 1–300 characters.');
    const points = matchesAnswer({ ...challenge, accepted_answers: JSON.parse(challenge.accepted_answers) }, body.answer) ? 1 : 0;
    const inserted = await DB.prepare(`INSERT INTO daily_attempts (day, player_id, answer, points, submitted_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, player_id) DO NOTHING`)
      .bind(day, id, body.answer.trim(), points, new Date(timestamp).toISOString()).run();
    const attempt = await DB.prepare('SELECT * FROM daily_attempts WHERE day = ? AND player_id = ?').bind(day, id).first();
    return json({ day, result: result(attempt, challenge), already_submitted: inserted.meta.changes === 0 });
  }
  const attempt = player && challenge && await DB.prepare('SELECT * FROM daily_attempts WHERE day = ? AND player_id = ?').bind(day, id).first();
  const [daily, aggregate] = await Promise.all([
    leaderboard(DB, day, season?.id, 'daily'),
    season ? leaderboard(DB, day, season.id, 'season') : [],
  ]);
  return json({ day, server_time: new Date(timestamp).toISOString(), rolls_over_at: nextRollover(timestamp),
    season, player: player ? { name: player.name } : null,
    question: challenge ? { topic: challenge.topic, clue: challenge.clue, image: challenge.image } : null,
    result: result(attempt, challenge),
    unavailable_reason: !season ? 'No season is active yet.' : !challenge ? 'The question bank has no unused published questions. Check back soon.' : null,
    leaderboards: { daily, season: aggregate },
  });
}
