import test from 'node:test';
import assert from 'node:assert/strict';
import { D1 } from './support/d1.mjs';
import { handleApi } from '../api.mjs';
import { dailyStats } from '../profiles.mjs';
import { createGame } from '../core.mjs';

function setup() {
  const DB = new D1();
  const env = { DB, BETTER_AUTH_URL: 'https://example.test', BETTER_AUTH_SECRET: 'profile-test-secret-only-012345678901234567890' };
  for (const id of ['alice', 'bob', 'carol']) {
    DB.sqlite.prepare('INSERT INTO auth_users(id,name,email,emailVerified) VALUES(?,?,?,1)').run(id,id,id+'@example.test');
    DB.sqlite.prepare('INSERT INTO auth_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id,id,id,Date.now()+3600000,Date.now(),Date.now());
    DB.sqlite.prepare('INSERT INTO daily_players(id,name,account_id) VALUES(?,?,?)').run(id,id,id);
  }
  return { DB, async call(path, user, body, method = body ? 'PUT' : 'GET', headers = {}) {
    // Use Better Auth's own cookie signature instead of bypassing request authentication.
    const { makeSignature } = await import('better-auth/crypto');
    const token = user ? user + '.' + await makeSignature(user, env.BETTER_AUTH_SECRET) : '';
    return handleApi(new Request('https://example.test/api'+path, { method, headers: {
      'content-type': 'application/json', origin: 'https://example.test',
      cookie: token ? '__Secure-opentrivia.session_token='+encodeURIComponent(token) : '',
      'x-opentrivia-account': user || 'guest', ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  } };
}
const prefs = (extra = {}) => ({ bio: 'A longer biography. '.repeat(20), picture: '', visibility: 'public', stats_visibility: 'friends', games_visibility: 'friends', friends_visibility: 'private', ...extra });
test('profile privacy is enforced for guests, strangers, friends and owners; requests require consent', async () => {
  const c = setup();
  assert.equal((await c.call('/profiles/alice','alice',prefs())).status,200);
  c.DB.sqlite.prepare('INSERT INTO games(id,title,game_json,account_id,difficulty) VALUES(?,?,?,?,?)').run('published','Published game',JSON.stringify(createGame()),'alice','medium');
  c.DB.sqlite.prepare('INSERT INTO account_games(id,title,game_json,account_id) VALUES(?,?,?,?)').run('draft','Secret draft',JSON.stringify(createGame()),'alice');
  let p = (await (await c.call('/profiles/alice')).json()).profile;
  assert.equal(p.games,null); assert.equal(p.stats,null); assert.equal(p.friends,null); assert.ok(p.bio.length > 200);
  assert.equal((await c.call('/profiles/alice','bob',prefs())).status,403);
  assert.equal((await c.call('/profiles/alice','alice',prefs(), 'PUT', {origin:'https://evil.test'})).status,403);
  assert.equal((await c.call('/profiles/alice','alice',prefs(),'PUT',{'x-opentrivia-account':'bob'})).status,409);
  assert.equal((await c.call('/profiles/alice/friend','bob',{},'POST')).status,200);
  assert.equal((await c.call('/profiles/alice/friend','bob',{},'PUT')).status,409);
  assert.equal((await c.call('/profiles/bob/friend','alice',{},'PUT')).status,200);
  p = (await (await c.call('/profiles/alice','bob')).json()).profile;
  assert.equal(p.relationship,'friends'); assert.equal(p.games.length,1); assert.equal(p.games[0].title,'Published game'); assert.equal(p.stats.plays,0); assert.equal(p.friends,null);
  p = (await (await c.call('/profiles/alice','alice')).json()).profile;
  assert.equal(p.games.length,1); assert.equal(p.friends[0].id,'bob');
  await c.call('/profiles/alice','alice',prefs({ visibility:'friends' }));
  assert.equal((await c.call('/profiles/alice','bob')).status,200);
  assert.equal((await c.call('/profiles/alice','carol')).status,403);
  assert.equal((await c.call('/profiles?q=ali')).status,200);
  assert.deepEqual((await (await c.call('/profiles?q=ali')).json()).profiles,[]);
  await c.call('/profiles/alice/friend','bob',{},'DELETE');
  assert.equal((await c.call('/profiles/alice','bob')).status,403);
  await c.call('/profiles/alice','alice',prefs({ visibility:'private' }));
  assert.equal((await c.call('/profiles/alice')).status,403);
  assert.equal((await c.call('/profiles/alice','alice')).status,200);
});

test('profile input validation rejects oversized bios and unsafe picture formats', async () => {
  const c = setup();
  for (const body of [prefs({bio:'x'.repeat(2001)}),prefs({picture:'https://example.test/p.png'}),prefs({picture:'data:image/svg+xml;base64,PHN2Zz4='}),prefs({games_visibility:'everyone'})]) {
    assert.equal((await c.call('/profiles/alice','alice',body)).status,400);
  }
  assert.equal((await c.call('/profiles/alice',null,prefs())).status,401);
  assert.equal((await c.call('/profiles/alice/friend','alice',{},'POST')).status,400);
});

test('stats count submitted days, correct answers, 07:00 UTC streaks, and uncapped seasonal rank', async () => {
  const {DB} = setup(), db=DB.sqlite;
  db.exec("INSERT INTO daily_seasons VALUES('s','Autumn','2026-10-01','2027-01-01')");
  for (const [day,points,time] of [['2026-10-12',1,1000],['2026-10-13',0,null],['2026-10-14',1,3000]]) {
    db.prepare('INSERT INTO daily_questions(id,clue,answer) VALUES(?,?,?)').run(day,'Q','A');
    db.prepare('INSERT INTO daily_challenges(day,season_id,question_id,topic,clue,answer,image,accepted_answers,explanation) VALUES(?,?,?,?,?,?,?,?,?)').run(day,'s',day,'T','Q','A','','[]','');
    db.prepare('INSERT INTO daily_attempts(day,player_id,answer,points,completion_ms,submitted_at) VALUES(?,?,?,?,?,?)').run(day,'alice','A',points,time,day+'T12:00:00Z');
  }
  db.prepare('INSERT INTO daily_attempts(day,player_id,answer,points,completion_ms,submitted_at) VALUES(?,?,?,?,?,?)').run('2026-10-14','bob','A',1,500,'2026-10-14T12:00:00Z');
  let stats = await dailyStats(DB,'alice',Date.parse('2026-10-15T06:59:00Z'));
  assert.deepEqual(stats,{streak:3,plays:3,correct:2,season:'Autumn',rank:2});
  stats = await dailyStats(DB,'alice',Date.parse('2026-10-15T07:01:00Z')); assert.equal(stats.streak,3);
  stats = await dailyStats(DB,'alice',Date.parse('2026-10-16T07:01:00Z')); assert.equal(stats.streak,0);
});

test('friend list visibility follows all three privacy scopes and private profiles are not disclosed in lists', async () => {
  const c = setup();
  await c.call('/profiles/alice/friend','bob',{},'POST');
  await c.call('/profiles/alice/friend','bob',{},'POST');
  await c.call('/profiles/bob/friend','alice',{},'POST');
  assert.equal(c.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM friendships').get().n,1);
  await c.call('/profiles/bob/friend','alice',{},'PUT');
  for (const scope of ['public','friends','private']) {
    await c.call('/profiles/alice','alice',prefs({friends_visibility:scope}));
    for (const viewer of [null,'carol','bob','alice']) {
      const p = (await (await c.call('/profiles/alice',viewer)).json()).profile;
      const allowed = viewer === 'alice' || scope === 'public' || scope === 'friends' && viewer === 'bob';
      assert.equal(Array.isArray(p.friends),allowed);
    }
  }
  await c.call('/profiles/alice','alice',prefs({friends_visibility:'public'}));
  await c.call('/profiles/bob','bob',prefs({visibility:'private'}));
  const guest = (await (await c.call('/profiles/alice')).json()).profile;
  assert.deepEqual(guest.friends,[]);
  assert.equal(JSON.stringify(guest).includes('email'),false);
});

test('a single unique username changes the profile URL and all names without changing ownership', async () => {
  const c = setup();
  let response = await c.call('/profiles/alice','alice',prefs({username:'Alex_Morgan'}));
  assert.equal(response.status,200);
  let p = (await (await c.call('/profiles/@ALEX_MORGAN')).json()).profile;
  assert.equal(p.id,'alice'); assert.equal(p.name,'alex_morgan'); assert.equal(p.username,'alex_morgan');
  assert.equal(c.DB.sqlite.prepare("SELECT name FROM daily_players WHERE id='alice'").get().name,'alex_morgan');
  assert.equal((await c.call('/profiles/bob','bob',prefs({username:'ALEX_MORGAN'}))).status,409);
  assert.equal((await c.call('/profiles/bob','bob',prefs({username:'bad-name'}))).status,400);
  await c.call('/profiles/alice/friend','bob',{},'POST');
  await c.call('/profiles/bob/friend','alice',{},'PUT');
  await c.call('/profiles/alice','alice',prefs({username:'alex_new'}));
  assert.equal((await c.call('/profiles/@alex_morgan')).status,404);
  p = (await (await c.call('/profiles/@alex_new','bob')).json()).profile;
  assert.equal(p.relationship,'friends'); assert.equal(p.id,'alice');
  assert.equal((await c.call('/profiles/alice')).status,200);
  const session = (await (await c.call('/account','alice')).json()).account;
  assert.equal(session.name,'alex_new'); assert.equal(session.needsUsername,false);
  const results = (await (await c.call('/profiles?q=alex_new')).json()).profiles;
  assert.equal(results[0].username,'alex_new');
});
