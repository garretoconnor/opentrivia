function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  } });
}
function fail(error, status = 400) { return json({ error }, status); }

async function authorized(request, secret) {
  const supplied = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
  if (!supplied || supplied.length > 1024) return false;
  const encode = value => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([supplied, secret].map(value => crypto.subtle.digest('SHA-256', encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Enter question details.');
  const field = (name, max, required = false) => {
    const value = body[name] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error(`${name.replaceAll('_', ' ')} must be ${required ? '1' : '0'}–${max} characters.`);
    }
    return value.trim();
  };
  const question = { topic: field('topic', 120), clue: field('clue', 2000, true),
    answer: field('answer', 300, true), image: field('image', 2000), explanation: field('explanation', 2000) };
  if (question.image) {
    let url;
    try { url = new URL(question.image); } catch { throw new Error('Image must be an HTTPS URL.'); }
    if (url.protocol !== 'https:') throw new Error('Image must be an HTTPS URL.');
  }
  const alternatives = body.accepted_answers ?? [];
  if (!Array.isArray(alternatives) || alternatives.length > 30 || alternatives.some(value =>
    typeof value !== 'string' || !value.trim() || value.length > 300)) {
    throw new Error('Use up to 30 alternative answers, each 1–300 characters.');
  }
  question.accepted_answers = [...new Set(alternatives.map(value => value.trim()))];
  if (typeof body.enabled !== 'boolean') throw new Error('Choose whether the question is ready for daily play.');
  question.enabled = body.enabled;
  if (!Number.isSafeInteger(body.queue_order) || Math.abs(body.queue_order) > 2147483647) {
    throw new Error('Queue order must be a whole number between -2147483647 and 2147483647.');
  }
  question.queue_order = body.queue_order;
  // The browser retains this ID after a failed request, so retrying cannot add a duplicate.
  if (typeof body.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.id)) {
    throw new Error('A valid question ID is required.');
  }
  question.id = body.id;
  return question;
}

export async function handleAdmin(request, env) {
  if (typeof env.ADMIN_TOKEN !== 'string' || !env.ADMIN_TOKEN) return fail('Admin access is not configured. Set the ADMIN_TOKEN Worker secret.', 503);
  if (!await authorized(request, env.ADMIN_TOKEN)) return fail('Enter a valid admin access key.', 401);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return fail('Invalid request origin.', 403);
  if (!env.DB) return fail('The daily question bank is not configured.', 503);
  if (url.pathname !== '/api/admin/questions') return fail('Admin route not found.', 404);
  if (request.method === 'GET') {
    const questions = await env.DB.prepare(`SELECT q.id, q.topic, q.clue, q.enabled, q.queue_order,
      (SELECT day FROM daily_challenges WHERE question_id = q.id) AS used_on
      FROM daily_questions q ORDER BY used_on IS NOT NULL, q.queue_order, q.id LIMIT 100`).all();
    const counts = await env.DB.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(enabled = 0 AND NOT EXISTS (SELECT 1 FROM daily_challenges WHERE question_id = daily_questions.id)), 0) AS drafts,
      COALESCE(SUM(enabled = 1 AND NOT EXISTS (SELECT 1 FROM daily_challenges WHERE question_id = daily_questions.id)), 0) AS ready,
      (SELECT COUNT(*) FROM daily_challenges) AS used FROM daily_questions`).first();
    return json({ questions: questions.results, counts });
  }
  if (request.method !== 'POST' && request.method !== 'PATCH') return fail('Method not allowed.', 405);
  let question;
  try {
    const text = await request.text();
    if (text.length > 20000) return fail('Question is too large.', 413);
    let body;
    try { body = JSON.parse(text); } catch { return fail('Invalid JSON.'); }
    if (request.method === 'PATCH') {
      if (typeof body?.id !== 'string' || !body.id || body.id.length > 200 || typeof body.enabled !== 'boolean') {
        return fail('A question ID and ready status are required.');
      }
      const updated = await env.DB.prepare(`UPDATE daily_questions SET enabled = ? WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM daily_challenges WHERE question_id = daily_questions.id)`)
        .bind(Number(body.enabled), body.id).run();
      if (!updated.meta.changes) return fail('Question not found or already used. Refresh the bank.', 409);
      return json({ updated: true });
    }
    question = validate(body);
  } catch (error) { return fail(error.message); }
  const { id, topic, clue, answer, image, accepted_answers, explanation, enabled, queue_order } = question;
  const result = await env.DB.prepare(`INSERT INTO daily_questions
    (id, topic, clue, answer, image, accepted_answers, explanation, enabled, queue_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, topic, clue, answer, image, JSON.stringify(accepted_answers), explanation, Number(enabled), queue_order).run();
  if (!result.meta.changes) {
    const existing = await env.DB.prepare('SELECT * FROM daily_questions WHERE id = ?').bind(id).first();
    const expected = { ...question, enabled: Number(enabled), accepted_answers: JSON.stringify(accepted_answers) };
    if (!existing || Object.entries(expected).some(([key, value]) => existing[key] !== value)) {
      return fail('This question ID has already been saved with different details. Reload the page before adding another question.', 409);
    }
    return json({ question: { id, topic, clue, enabled, queue_order } });
  }
  return json({ question: { id, topic, clue, enabled, queue_order } }, 201);
}
