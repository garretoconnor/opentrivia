import { fail, json, readBody, resolveAccount, validMutation } from './auth.mjs';

import { triviaDay } from './daily.mjs';

const defaults = { bio: '', picture: '', visibility: 'public', stats_visibility: 'public', games_visibility: 'public', friends_visibility: 'private' };
const scopes = ['visibility', 'stats_visibility', 'games_visibility', 'friends_visibility'];
const visible = (scope, owner, friend) => owner || scope === 'public' || scope === 'friends' && friend;
const pair = (DB, a, b) => DB.prepare('SELECT * FROM friendships WHERE (requester = ? AND recipient = ?) OR (requester = ? AND recipient = ?)').bind(a, b, b, a).first();

export async function dailyStats(DB, id, now = Date.now()) {
  const day = triviaDay(now);
  const attempts = (await DB.prepare('SELECT day, points FROM daily_attempts WHERE player_id = ? AND day <= ? ORDER BY day DESC').bind(id, day).all()).results;
  let cursor = Date.parse(day), streak = 0;
  if (attempts[0]?.day !== day) cursor -= 86400000;
  for (const attempt of attempts) {
    if (attempt.day !== new Date(cursor).toISOString().slice(0, 10)) break;
    streak++; cursor -= 86400000;
  }
  const season = await DB.prepare('SELECT id, name FROM daily_seasons WHERE starts_on <= ? AND ends_on > ?').bind(day, day).first();
  const rank = season && await DB.prepare(`SELECT rank FROM (
    SELECT a.player_id, RANK() OVER (ORDER BY AVG(a.completion_ms)) AS rank
    FROM daily_attempts a JOIN daily_challenges c ON c.day = a.day
    WHERE c.season_id = ? AND a.points = 1 AND a.completion_ms IS NOT NULL GROUP BY a.player_id
  ) WHERE player_id = ?`).bind(season.id, id).first();
  return { streak, plays: attempts.length, correct: attempts.filter(a => a.points === 1).length, season: season?.name || null, rank: rank?.rank || null };
}

export async function handleProfiles(request, env) {
  const DB = env.DB;
  if (!DB) return fail('Profiles need the Cloudflare server.', 503);
  const url = new URL(request.url), account = await resolveAccount(request, env);
  if (request.method !== 'GET') {
    if (!account) return fail('Log in to continue.', 401);
    if (!validMutation(request)) return fail('Invalid request origin or content type.', 403);
    if (request.headers.has('x-opentrivia-account') && request.headers.get('x-opentrivia-account') !== account.id) return fail('Your account changed. Reload to continue.', 409);
  }
  if (url.pathname === '/api/profiles' && request.method === 'GET') {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (query.length < 2) return json({ profiles: [] });
    const rows = await DB.prepare(`SELECT u.id, u.name, u.username FROM auth_users u LEFT JOIN profiles p ON p.account_id = u.id
      WHERE u.emailVerified = 1 AND COALESCE(p.visibility, 'public') = 'public' AND instr(lower(u.name), lower(?)) > 0
      ORDER BY u.name, u.id LIMIT 30`).bind(query).all();
    return json({ profiles: rows.results });
  }
  const match = url.pathname.match(/^\/api\/profiles\/([^/]+)(\/friend)?$/);
  if (!match) return fail('Profile not found.', 404);
  const reference = decodeURIComponent(match[1]);
  const byUsername = reference.startsWith('@');
  const user = await DB.prepare(byUsername
    ? 'SELECT id, name, username FROM auth_users WHERE username = ? AND emailVerified = 1'
    : 'SELECT id, name, username FROM auth_users WHERE id = ? AND emailVerified = 1').bind(byUsername ? reference.slice(1).toLowerCase() : reference).first();
  if (!user) return fail('Profile not found.', 404);
  const id = user.id;
  const owner = account?.id === id;
  const relationship = account && !owner ? await pair(DB, account.id, id) : null;
  const friend = relationship?.status === 'accepted';
  const profile = { ...defaults, ...await DB.prepare('SELECT * FROM profiles WHERE account_id = ?').bind(id).first() };
  if (match[2]) {
    if (!account || owner) return fail('Choose another user.', 400);
    if (request.method === 'DELETE') {
      await DB.prepare('DELETE FROM friendships WHERE (requester = ? AND recipient = ?) OR (requester = ? AND recipient = ?)').bind(account.id, id, id, account.id).run();
      return json({ ok: true });
    }
    if (request.method === 'POST') {
      if (!visible(profile.visibility, owner, friend)) return fail('This profile is private.', 403);
      await DB.prepare('INSERT INTO friendships (requester, recipient) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(account.id, id).run();
      return json({ ok: true });
    }
    if (request.method === 'PUT') {
      const result = await DB.prepare("UPDATE friendships SET status = 'accepted' WHERE requester = ? AND recipient = ? AND status = 'pending'").bind(id, account.id).run();
      return result.meta.changes ? json({ ok: true }) : fail('No incoming friend request.', 409);
    }
    return fail('Method not allowed.', 405);
  }
  if (request.method === 'PUT') {
    if (!owner) return fail('You can only edit your own profile.', 403);
    let body;
    try { body = await readBody(request, 400000); } catch (error) { return fail(error.message); }
    if (typeof body.bio !== 'string' || body.bio.length > 2000) return fail('Bio must be at most 2,000 characters.');
    if (scopes.some(key => !['public', 'private', 'friends'].includes(body[key]))) return fail('Choose a valid privacy setting.');
    // Only bounded raster data URLs; no SVG, remote URLs, or executable content.
    if (typeof body.picture !== 'string' || body.picture.length > 350000 || body.picture && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.picture)) return fail('Choose a PNG, JPEG, or WebP picture under 250 KB.');
    const username = body.username === undefined ? user.username : typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (body.username !== undefined && !/^[a-z0-9_]{3,30}$/.test(username)) return fail('Use 3–30 letters, numbers, or underscores for your username.');
    if (username && await DB.prepare('SELECT id FROM auth_users WHERE username = ? AND id != ?').bind(username,id).first()) return fail('That username is already taken.',409);
    const statements = [];
    if (username) statements.push(DB.prepare('UPDATE auth_users SET name = ?, username = ? WHERE id = ?').bind(username,username,id));
    statements.push(DB.prepare(`INSERT INTO profiles (account_id, bio, picture, visibility, stats_visibility, games_visibility, friends_visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET bio=excluded.bio, picture=excluded.picture,
      visibility=excluded.visibility, stats_visibility=excluded.stats_visibility, games_visibility=excluded.games_visibility, friends_visibility=excluded.friends_visibility`)
      .bind(id, body.bio.trim(), body.picture, ...scopes.map(key => body[key])));
    try { await DB.batch(statements); }
    catch (error) { if (/UNIQUE.*username/i.test(error.message)) return fail('That username is already taken.',409); throw error; }
    return json({ ok: true });
  }
  if (request.method !== 'GET') return fail('Method not allowed.', 405);
  if (!visible(profile.visibility, owner, friend)) return fail('This profile is private.', 403);
  const result = { id, name: user.name, username: user.username, bio: profile.bio, picture: profile.picture, owner, relationship: friend ? 'friends' : relationship ? relationship.recipient === account.id ? 'incoming' : 'outgoing' : 'none' };
  result.stats = visible(profile.stats_visibility, owner, friend) ? await dailyStats(DB, id) : null;
  result.games = visible(profile.games_visibility, owner, friend) ? (await DB.prepare(`SELECT id, title, hero_image, difficulty, COALESCE(json_extract(game_json, '$.adult_content'), 0) AS adult_content FROM games WHERE account_id = ? ORDER BY created_at DESC, id`).bind(id).all()).results : null;
  result.friends = visible(profile.friends_visibility, owner, friend) ? (await DB.prepare(`SELECT u.id, u.name, u.username, CASE WHEN p.visibility != 'private' THEN p.picture ELSE '' END AS picture FROM friendships f
    JOIN auth_users u ON u.id = CASE WHEN f.requester = ? THEN f.recipient ELSE f.requester END
    LEFT JOIN profiles p ON p.account_id = u.id
    WHERE (f.requester = ? OR f.recipient = ?) AND f.status = 'accepted'
    AND (? = 1 OR u.id = ? OR COALESCE(p.visibility,'public') = 'public' OR
      p.visibility = 'friends' AND EXISTS (SELECT 1 FROM friendships v WHERE v.status = 'accepted'
        AND ((v.requester = u.id AND v.recipient = ?) OR (v.recipient = u.id AND v.requester = ?))))
    ORDER BY u.name, u.id`).bind(id, id, id, owner ? 1 : 0, account?.id || '', account?.id || '', account?.id || '').all()).results : null;
  if (owner) {
    result.privacy = Object.fromEntries(scopes.map(key => [key, profile[key]]));
    result.requests = (await DB.prepare(`SELECT u.id, u.name, u.username, CASE WHEN f.recipient = ? THEN 'incoming' ELSE 'outgoing' END AS direction
      FROM friendships f JOIN auth_users u ON u.id = CASE WHEN f.requester = ? THEN f.recipient ELSE f.requester END
      WHERE (f.requester = ? OR f.recipient = ?) AND f.status = 'pending' ORDER BY u.name`).bind(id,id,id,id).all()).results;
  }
  return json({ profile: result });
}
