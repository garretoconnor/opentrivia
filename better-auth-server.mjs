import { betterAuth } from 'better-auth';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { fail, validMutation } from './auth.mjs';

const instances = new WeakMap();
const MAIL_PATHS = new Set(['/sign-up/email', '/request-password-reset', '/send-verification-email']);
function emailReady(env) { return typeof env.AUTH_EMAIL?.send === 'function' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.AUTH_EMAIL_FROM || ''); }
export async function sendAuthEmail(env, kind, user, url) {
  if (!emailReady(env)) throw new Error('Account email delivery is not configured.');
  const reset = kind === 'reset';
  await env.AUTH_EMAIL.send({
    from: { email: env.AUTH_EMAIL_FROM, name: 'OpenTrivia' }, to: user.email,
    subject: reset ? 'Reset your OpenTrivia password' : 'Verify your OpenTrivia email',
    text: `${reset ? 'Reset your OpenTrivia password' : 'Verify your email to finish creating your OpenTrivia account'}:\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
  });
}
export function getAuth(env) {
  if (!env.DB || typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.length < 32 || !env.BETTER_AUTH_URL) throw new Error('Account authentication is not configured.');
  const baseURL = new URL(env.BETTER_AUTH_URL);
  if (baseURL.pathname !== '/' || baseURL.search || baseURL.hash || baseURL.username || baseURL.password ||
    (baseURL.protocol !== 'https:' && !(baseURL.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseURL.hostname)))) throw new Error('Set BETTER_AUTH_URL to the application origin (HTTPS in production).');
  const cached = instances.get(env.DB);
  if (cached?.env === env) return cached.auth;
  const auth = betterAuth({
    appName: 'OpenTrivia', baseURL: baseURL.origin, basePath: '/api/auth', secret: env.BETTER_AUTH_SECRET,
    database: env.DB, trustedOrigins: [baseURL.origin],
    user: { modelName: 'auth_users', additionalFields: { username: { type: 'string', required: false, input: false } } }, account: { modelName: 'auth_credentials' },
    session: { modelName: 'auth_sessions', expiresIn: 30 * 86400, cookieCache: { enabled: false } },
    verification: { modelName: 'auth_verifications' },
    advanced: { cookiePrefix: 'opentrivia', ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }, database: { generateId: () => crypto.randomUUID() } },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 15, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendAuthEmail(env, 'reset', user, url),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail(env, 'verify', user, url),
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limits', window: 60, max: 100,
      customRules: { '/sign-in/*': { window: 900, max: 15 }, '/sign-up/email': { window: 900, max: 10 }, '/request-password-reset': { window: 900, max: 5 }, '/send-verification-email': { window: 900, max: 5 } } },
    databaseHooks: { user: { create: { before: async user => {
      const username = typeof user.name === 'string' ? user.name.trim().toLowerCase() : '';
      if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new APIError('BAD_REQUEST', { message: 'Use 3–30 letters, numbers, or underscores for your username.' });
      if (await env.DB.prepare('SELECT id FROM auth_users WHERE username = ?').bind(username).first()) throw new APIError('BAD_REQUEST', { message: 'That username is already taken.' });
      return { data: { ...user, name: username, username } };
    } }, update: { before: async user => {
      if (user.name !== undefined || user.username !== undefined) throw new APIError('BAD_REQUEST', { message: 'Change your username from your profile.' });
    } } } },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-in/email') {
        const identity = (ctx.body?.email || '').trim().toLowerCase();
        if (identity) {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))].map(n => n.toString(16).padStart(2, '0')).join('');
          const now = Date.now(), key = `identity:${hash}:${Math.floor(now / 900000)}`;
          const row = await env.DB.prepare(`INSERT INTO auth_rate_limits (id, key, count, lastRequest) VALUES (?, ?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).bind(crypto.randomUUID(), key, now).first();
          await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key LIKE 'identity:%' AND lastRequest < ?").bind(now - 1800000).run();
          if (row.count > 15) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many sign-in attempts. Try again in 15 minutes.' });
        }
      }
      if (MAIL_PATHS.has(ctx.path) && !emailReady(env)) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Account email delivery is not configured. Please try again later.' });
    }) },
  });
  instances.set(env.DB, { env, auth });
  return auth;
}
export async function handleAuth(request, env) {
  if (request.method === 'POST' && !validMutation(request)) return fail('Invalid request origin or content type.', 403);
  let auth;
  try { auth = getAuth(env); } catch { return fail('Accounts are not configured. Please try again later.', 503); }
  if (new URL(request.url).pathname === '/api/auth/sign-out' && request.headers.has('x-opentrivia-account')) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (request.headers.get('x-opentrivia-account') !== (session?.user.id || 'guest')) return fail('Your account changed in another tab. Reload to continue.', 409);
  }
  const response = await auth.handler(request);
  const headers = new Headers(response.headers); headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
