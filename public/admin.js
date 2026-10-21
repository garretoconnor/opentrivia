const $ = id => document.getElementById(id);
let token = '';
let questionId = crypto.randomUUID();
let session = 0;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}
function lock() {
  session++;
  token = '';
  $('token').value = '';
  $('workspace').hidden = true;
  $('login').hidden = false;
  $('questions').replaceChildren();
  $('counts').textContent = '';
  $('question-form').reset();
  questionId = crypto.randomUUID();
}
async function api(method = 'GET', body, path = '/api/admin/questions') {
  const response = await fetch(path, {
    method, cache: 'no-store', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Admin requires the Worker server. Run npm run dev:worker for local use.'); }
  if (!response.ok) {
    if (response.status === 401) lock();
    throw new Error(data.error || 'Unable to access the question bank.');
  }
  return data;
}
async function refresh() {
  const currentSession = session;
  const { questions, counts } = await api();
  if (currentSession !== session) return;
  $('counts').textContent = `${counts.ready} ready · ${counts.drafts} drafts · ${counts.used} used · ${counts.total} total`;
  $('questions').replaceChildren();
  for (const question of questions) {
    const item = document.createElement('li');
    const meta = document.createElement('p');
    meta.className = 'question-meta';
    meta.textContent = `${question.topic || 'No topic'} · ${question.used_on ? `Used ${question.used_on}` : question.enabled ? 'Ready' : 'Draft'} · Order ${question.queue_order}`;
    const clue = document.createElement('p');
    clue.textContent = question.clue;
    item.append(meta, clue);
    if (!question.used_on) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'secondary';
      toggle.textContent = question.enabled ? 'Move to draft' : 'Make ready';
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await api('PATCH', { id: question.id, enabled: !question.enabled });
          await refresh();
          status('Question status updated.');
        } catch (error) { status(error.message, true); }
        finally { toggle.disabled = false; }
      });
      item.append(toggle);
    }
    $('questions').append(item);
  }
  if (!questions.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No questions yet. Add your first question to get started.';
    $('questions').append(empty);
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  token = $('token').value.trim();
  try {
    await refresh();
    await loadFeatured();
    $('token').value = '';
    $('login').hidden = true;
    $('workspace').hidden = false;
    status('Question bank unlocked.');
    $('clue').focus();
  } catch (error) { token = ''; status(error.message, true); }
  finally { button.disabled = false; }
});
$('lock').addEventListener('click', () => { lock(); status('Admin locked.'); $('token').focus(); });
window.addEventListener('pagehide', lock);
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try { await refresh(); status('Question bank refreshed.'); }
  catch (error) { status(error.message, true); }
  finally { $('refresh').disabled = false; }
});
$('question-form').addEventListener('submit', async event => {
  event.preventDefault();
  const currentSession = session;
  const fields = new FormData(event.currentTarget);
  const question = { id: questionId, topic: fields.get('topic'), clue: fields.get('clue'), answer: fields.get('answer'),
    image: fields.get('image'), explanation: fields.get('explanation'),
    accepted_answers: fields.get('alternatives').split('\n').map(value => value.trim()).filter(Boolean),
    queue_order: Number(fields.get('queue_order')), enabled: $('enabled').checked };
  $('save').disabled = true;
  try {
    await api('POST', question);
    if (currentSession !== session) return;
    $('question-form').reset();
    questionId = crypto.randomUUID();
    status(question.enabled ? 'Question added and ready for daily play.' : 'Question saved as a draft.');
    $('clue').focus();
    try { await refresh(); } catch { status('Question saved. The bank could not refresh; use Refresh to reload it.'); }
  } catch (error) { status(error.message, true); }
  finally { $('save').disabled = false; }
});

let featuredGames = [];
function addFeatured(id = '') {
  const row = document.createElement('div'); row.className = 'featured-row';
  const select = document.createElement('select'); select.required = true; select.setAttribute('aria-label', 'Featured game');
  select.append(new Option('Choose a game', ''));
  featuredGames.forEach(game => select.append(new Option(game.title, game.id)));
  select.value = id;
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());
  const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', 'Move game earlier');
  up.addEventListener('click', () => { if (row.previousElementSibling) row.before(row.previousElementSibling); });
  row.append(select, up, remove); $('featured-list').append(row);
}
async function loadFeatured() {
  const currentSession = session;
  const data = await api('GET', undefined, '/api/admin/featured');
  if (currentSession !== session) return;
  featuredGames = data.games; $('featured-list').replaceChildren();
  data.ids.forEach(addFeatured);
}
$('add-featured').addEventListener('click', () => { if ($('featured-list').children.length < 50) addFeatured(); });
$('featured-form').addEventListener('submit', async event => {
  event.preventDefault(); const currentSession = session; event.submitter.disabled = true;
  try {
    const ids = [...$('featured-list').querySelectorAll('select')].map(select => select.value);
    await api('PUT', { ids }, '/api/admin/featured');
    if (currentSession === session) $('featured-status').textContent = `Saved ${ids.length} featured games.`;
  } catch (error) { if (currentSession === session) $('featured-status').textContent = error.message; }
  finally { event.submitter.disabled = false; }
});
