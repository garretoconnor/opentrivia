export function cookieValue(request, name) {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export async function resolveAccount(request, env) {
  if (!env.DB || !/(?:^|;\s*)(?:__Secure-)?opentrivia\.session_token=/.test(request.headers.get('cookie') || '')) return null;
  const { getAuth } = await import('./better-auth-server.mjs');
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  if (!session?.user?.emailVerified) return null;
  const user = session.user;
  await env.DB.prepare(`INSERT INTO daily_players (id, name, account_id) VALUES (?, ?, ?)
    ON CONFLICT DO NOTHING`).bind(user.id, user.name, user.id).run();
  return { id: user.id, name: user.name, needsUsername: !user.username };
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
export function fail(error, status = 400) { return json({ error }, status); }
export function validMutation(request) {
  const origin = request.headers.get('origin');
  return (!origin || origin === new URL(request.url).origin) && request.headers.get('sec-fetch-site') !== 'cross-site'
    && request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
}
export async function readBody(request, limit = 8192) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('A JSON body is required.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; }
  catch { throw new Error('Invalid JSON.'); }
}
