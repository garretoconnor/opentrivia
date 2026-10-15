import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../core.mjs';

// Minimal DOM adapter: exercise the real editor event handlers and persisted data.
class Element {
  constructor() { this.value = ''; this.dataset = {}; this.children = []; this.listeners = {}; this.style = { setProperty() {} }; this.classList = { add() {}, remove() {}, toggle() {} }; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, once: options?.once }); }
  async fire(type, extra = {}) {
    const handlers = [...(this.listeners[type] || [])];
    this.listeners[type] = (this.listeners[type] || []).filter(item => !item.once);
    await Promise.all(handlers.map(({ fn }) => fn({ target: this, preventDefault() {}, ...extra })));
  }
  setAttribute() {}
  setPointerCapture() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get options() { return this.children; }
  closest() { return this; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === 'input' ? descendants.filter(child => child.tagName === 'input') : descendants;
  }
  showModal() { this.open = true; }
  close(value) { if (value !== undefined) this.returnValue = value; this.open = false; void this.fire('close'); }
  focus() { document.activeElement = this; }
  remove() {}
}
const nodes = new Map();
const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
globalThis.document = Object.assign(new Element(), { querySelector: get, getElementById: id => get(`#${id}`), querySelectorAll: () => [], createElement: tag => Object.assign(new Element(), { tagName: tag }), dispatchEvent(event) { void this.fire(event.type); } });
globalThis.window = { scrollTo() {} };
globalThis.Option = class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = String(value); } };
const storage = new Map();
let failSave = false;
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failSave) throw new Error('Quota exceeded'); storage.set(key, value); } };
const { state, saveGame, STORAGE_KEY } = await import('../modules/state.js?v=0.10.2');
const { initStudio, renderStudio, editStudioClue } = await import('../modules/studio.js');
initStudio();
function reset() { failSave = false; state.game = createGame(); state.authoredGame = state.game; state.selectedBoard = 0; renderStudio(); saveGame(); }
const clue = () => state.game.boards[0].columns[0].clues[0];

test('dirty dismissal can keep editing or discard without committing', async () => {
  reset(); editStudioClue(0, 0, 0);
  const before = storage.get(STORAGE_KEY);
  get('#clue-text').value = 'Unsaved clue';
  let pending = get('#close-clue-button').fire('click');
  assert.equal(get('#studio-confirm').open, true);
  get('#studio-confirm').close('cancel'); await pending;
  assert.equal(get('#clue-dialog').open, true);
  pending = get('#clue-dialog').fire('cancel');
  get('#studio-confirm').close('accept'); await pending;
  assert.equal(get('#clue-dialog').open, false);
  assert.equal(storage.get(STORAGE_KEY), before);
});

test('save and next persists the clue and advances editing', async () => {
  reset(); editStudioClue(0, 0, 0);
  get('#clue-text').value = 'A test clue'; get('#clue-answer').value = 'A response';
  get('#clue-aliases').value = '  Alternative  \nAnother'; get('#clue-explanation').value = 'Reason';
  await get('#clue-form').fire('submit', { submitter: { value: 'next' } });
  assert.equal(clue().clue, 'A test clue');
  assert.deepEqual(clue().accepted_answers, ['Alternative', 'Another']);
  assert.equal(clue().explanation, 'Reason');
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).boards[0].columns[0].clues[0].answer, 'A response');
  assert.equal(state.editingClue.row, 1);
  assert.equal(get('#clue-dialog').open, true);
});

test('storage failure keeps the editor draft open and does not commit it', async () => {
  reset(); editStudioClue(0, 0, 0); const before = structuredClone(clue());
  get('#clue-text').value = 'Keep this draft'; failSave = true;
  await get('#clue-form').fire('submit', { submitter: { value: 'save' } });
  assert.deepEqual(clue(), before);
  assert.equal(get('#clue-dialog').open, true);
  assert.equal(get('#clue-text').value, 'Keep this draft');
  assert.match(get('#clue-save-status').textContent, /Could not save/);
  assert.equal(get('#save-status').dataset.error, 'true');
  failSave = false;
});

test('shrinking populated topics requires consent and supports undo', async () => {
  reset(); const board = state.game.boards[0];
  board.columns[1].clues[0].clue = 'Preserve this'; saveGame();
  const before = structuredClone(board);
  get('#column-count').value = '1';
  let pending = get('#column-count').fire('change');
  get('#studio-confirm').close('cancel'); await pending;
  assert.deepEqual(state.game.boards[0], before);
  get('#column-count').value = '1';
  pending = get('#column-count').fire('change');
  get('#studio-confirm').close('accept'); await pending;
  assert.equal(state.game.boards[0].columns.length, 1);
  await get('#undo-button').fire('click');
  assert.deepEqual(state.game.boards[0], before);
});

test('deleting a round can be undone with its content intact', async () => {
  reset(); await get('#add-board-button').fire('click');
  const before = structuredClone(state.game.boards);
  const pending = get('#delete-board-button').fire('click');
  get('#studio-confirm').close('accept'); await pending;
  assert.equal(state.game.boards.length, before.length - 1);
  await get('#undo-button').fire('click');
  assert.deepEqual(state.game.boards, before);
});


const firstHandle = () => get('#editor-board').children[0].children[1].children[1];

test('keyboard reordering persists row values and supports undo', async () => {
  reset(); clue().clue = 'Move me'; saveGame();
  await firstHandle().fire('keydown', { key: 'ArrowDown' });
  assert.equal(state.game.boards[0].columns[0].clues[1].clue, 'Move me');
  assert.equal(state.game.boards[0].columns[0].clues[1].value, 400);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).boards[0].columns[0].clues[1].value, 400);
  await get('#undo-button').fire('click');
  assert.equal(clue().clue, 'Move me'); assert.equal(clue().value, 200);
});

test('row presets and custom values save game-wide and age marking persists', async () => {
  reset();
  get('#adult-content').checked = true; await get('#adult-content').fire('change');
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).adult_content, true);
  await get('#settings-button').fire('click');
  get('#row-values-preset').value = '100'; await get('#row-values-preset').fire('change');
  await get('#row-values-form').fire('submit');
  assert.equal(clue().value, 100); assert.equal(state.game.row_values[15], 1600);
  await get('#settings-button').fire('click');
  get('#row-values-fields').querySelectorAll('input')[0].value = '175';
  await get('#row-values-fields').fire('input'); await get('#row-values-form').fire('submit');
  assert.equal(state.game.boards[0].columns[5].clues[0].value, 175);
});

test('failed reorder and row point saves restore the previous data', async () => {
  reset(); clue().clue = 'Keep here'; saveGame(); failSave = true;
  await firstHandle().fire('keydown', { key: 'ArrowDown' });
  assert.equal(clue().clue, 'Keep here');
  await get('#settings-button').fire('click');
  get('#row-values-fields').querySelectorAll('input')[0].value = '999';
  await get('#row-values-form').fire('submit');
  assert.equal(clue().value, 200);
  assert.match(get('#row-values-error').textContent, /Could not save/);
  failSave = false;
});


test('pointer dragging moves only within the original column', async () => {
  reset(); clue().clue = 'Dragged clue'; saveGame();
  let handle = firstHandle();
  await handle.fire('pointerdown', { button: 0, pointerId: 1 });
  document.elementFromPoint = () => get('#editor-board').children[1].children[2];
  await handle.fire('pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
  await handle.fire('pointerup', { pointerId: 1 });
  assert.equal(clue().clue, 'Dragged clue');
  handle = firstHandle();
  await handle.fire('pointerdown', { button: 0, pointerId: 2 });
  document.elementFromPoint = () => get('#editor-board').children[0].children[3];
  await handle.fire('pointermove', { pointerId: 2, clientX: 0, clientY: 0 });
  await handle.fire('pointerup', { pointerId: 2 });
  assert.equal(state.game.boards[0].columns[0].clues[2].clue, 'Dragged clue');
  assert.equal(state.game.boards[0].columns[0].clues[2].value, 600);
});

test('round titles persist through normalization and appear in round navigation', async () => {
  reset();
  get('#round-title').value = 'Science & Nature';
  await get('#round-title').fire('change');
  assert.equal(state.game.boards[0].title, 'Science & Nature');
  assert.match(get('#board-list').children[0].innerHTML, /Science &amp; Nature/);
  const { normalizeGame } = await import('../core.mjs');
  assert.equal(normalizeGame(JSON.parse(storage.get(STORAGE_KEY))).boards[0].title, 'Science & Nature');
  failSave = true;
  get('#round-title').value = 'Unsaved title';
  await get('#round-title').fire('change');
  assert.equal(state.game.boards[0].title, 'Science & Nature');
  failSave = false;
});

test('preview plays the selected round in isolation and restores the editor on exit', async () => {
  reset();
  const { initLocalPlay, previewRound } = await import('../modules/local-play.js?v=0.10.2');
  const { switchView } = await import('../modules/render.js?v=0.10.2');
  const { createBossBoard } = await import('../core.mjs');
  initLocalPlay({});
  state.game.boards.push(createBossBoard());
  const authored = state.game, originalSession = { fixture: true };
  state.session = originalSession;
  state.publishedGameId = 'existing-game';
  const saved = storage.get(STORAGE_KEY);
  previewRound();
  assert.equal(state.currentView, 'play');
  assert.equal(state.session.preview, true);
  assert.notEqual(state.game, authored);
  assert.equal(state.publishedGameId, null);
  const grid = get('#play-stage').children[0];
  assert.equal(grid.className, 'play-board');
  await grid.children[authored.boards[0].columns.length].fire('click');
  assert.equal(get('#card-dialog').open, true);
  assert.match(get('#card-dialog-content').innerHTML, /Reveal correct response/);
  get('#card-dialog').close();
  switchView('studio');
  assert.equal(state.game, authored);
  assert.equal(state.session, originalSession);
  assert.equal(state.publishedGameId, 'existing-game');
  assert.equal(storage.get(STORAGE_KEY), saved);
  state.selectedBoard = 1;
  previewRound();
  assert.equal(state.session.boardIndex, 1);
  assert.equal(get('#play-stage').children[0].className, 'boss-stage');
  switchView('studio');
});
