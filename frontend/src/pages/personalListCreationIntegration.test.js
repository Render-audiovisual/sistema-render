import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createPersonalListCreation, reconcilePersonalListCreation } from './personalListCreation.js';
import { personalListId, personalListUrl, keepsPersonalListDrafts } from './personalListLocation.js';
import { createPersonalItemDrafts } from './personalItemDrafts.js';

// Actual effect/callback extraction with the real model. This does not mount
// React or certify native navigation/focus, HTTP persistence or PostgreSQL.
const source = readFileSync(new URL('./PersonalLists.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PersonalLists.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = (root, predicate) => { const result = []; const visit = n => { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); }; visit(root); return result; };
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PersonalListsPage');
const declarations = name => nodes(page, ts.isVariableDeclaration).find(n => n.name.getText(ast) === name).initializer;
const effects = nodes(page, ts.isCallExpression).filter(n => n.expression.getText(ast) === 'useEffect');
const lifecycle = effects.find(n => n.arguments[0].getText(ast).includes('const model=createPersonalListCreation'));
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
const key = '10000000-0000-4000-8000-000000000164';
const row = () => ({ id: '9', titulo: 'Nueva', emoji: '📝', posicion: 0, version: 1, creation_request_id: key,
  created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', bloques: [], secciones: [] });
const pending = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(request) {
  const calls = [], writes = [], states = [], creation = { current: null }, creationOrigin = { current: null }, selection = { current: {} };
  let lists = [], current = true;
  const window = { location: { href: 'https://render.test/lista?lista=2#section' },
    history: { state: { keep: 1 }, replaceState(state, title, url) { writes.push({ state, url }); } } };
  const deps = { creation, creationOrigin, listSelection: selection, mounted: { current: true }, currentSession: () => current,
    itemDrafts: { current: createPersonalItemDrafts() }, renderItemDrafts() {},
    scopedRequest: async (...args) => { calls.push(args); return request(...args); },
    createPersonalListCreation: options => createPersonalListCreation({ ...options, createRequestId: () => key }),
    reconcilePersonalListCreation, personalListId, personalListUrl, window,
    setCreationState: state => states.push(state), updateLists: change => { lists = change(lists); },
    setTemplates() {}, setActiveId() {}, setTemplateOpen() {}, setSaveTemplateOpen() {} };
  const setup = () => evaluate(lifecycle.arguments[0], deps)();
  return { deps, calls, writes, states, creation, creationOrigin, selection, setup, lists: () => lists, retire() { current = false; } };
}

test('actual creation effect cleanup/setup fences late old work without clearing/replacing new setup result', async () => {
  const delayed = pending(); let count = 0;
  const f = fixture(async () => ++count === 1 ? delayed.promise : row());
  const cleanupA = f.setup(), a = f.creation.current;
  f.creationOrigin.current = f.selection.current;
  const old = a.start({ titulo: 'Vieja', emoji: '📝', bloques: [] });
  cleanupA(); const cleanupB = f.setup(), b = f.creation.current;
  assert.notEqual(a, b); assert.equal(a.snapshot().phase, 'denied');
  f.creationOrigin.current = f.selection.current;
  await b.start({ titulo: 'Nueva', emoji: '📝', bloques: [] });
  assert.equal(f.lists().length, 1); assert.equal(f.writes.length, 1);
  const stateCount = f.states.length; delayed.resolve(row()); await old;
  assert.equal(f.states.length, stateCount); assert.equal(f.lists().length, 1); assert.equal(f.writes.length, 1);
  assert.equal(f.creation.current, b); assert.equal(b.snapshot().phase, 'confirmed'); cleanupB();
});

test('actual synchronous navigation getter sees unresolved/busy model before any creation-state repaint', async () => {
  const delayed = pending(), f = fixture(() => delayed.promise), cleanup = f.setup();
  const guard = nodes(page, ts.isCallExpression).find(n => n.expression.getText(ast) === 'useNavigationGuard').arguments[0];
  const read = evaluate(guard, { ...f.deps, keepsPersonalListDrafts, pendingSaves: { current: 0 },
    queue: { current: { snapshot: () => ({ dirty: false, busy: false }) } }, statusRef: { current: 'saved' } });
  const work = f.creation.current.start({ titulo: 'Nueva', emoji: '📝', bloques: [] });
  for (const context of [{ type: 'link', to: '/lista?lista=3' }, { type: 'link', to: '/inicio' }, { type: 'unload' }]) {
    assert.deepEqual(read(context), { dirty: true, busy: true });
  }
  delayed.resolve({ invalid: true }); await work;
  assert.deepEqual(read({ type: 'link', to: '/lista?lista=3' }), { dirty: true, busy: false });
  f.retire(); assert.deepEqual(read({ type: 'link', to: '/inicio' }), { dirty: false, busy: false }); cleanup();
});

test('actual explicit reload may discard queue drafts after consent but never discards/replaces creation intent', async () => {
  const f = fixture(async () => { throw Object.assign(new Error(), { status: 503 }); }), cleanup = f.setup();
  await f.creation.current.start({ titulo: 'Nueva', emoji: '📝', bloques: [] });
  const original = f.creation.current, calls = [];
  await evaluate(declarations('reload'), { ...f.deps, pendingSaves: { current: 0 }, status: 'error',
    window: { confirm: () => true }, queue: { current: { snapshot: () => ({ dirty: false, busy: false }), discard: () => calls.push('discard-queue') } },
    load: async () => calls.push('load') })();
  assert.deepEqual(calls, ['discard-queue', 'load']); assert.equal(f.creation.current, original);
  assert.equal(original.snapshot().phase, 'uncertain'); assert.equal(f.calls.length, 1); cleanup();
});

test('actual structural admission flushes queue before allocating/sending creation and preserves unresolved intent on failed flush', async () => {
  const f = fixture(async () => row()), cleanup = f.setup(), trace = [], held = pending(), counter = { current: 0 };
  const saving = evaluate(declarations('runSaving').arguments[0], { pendingSaves: counter, setStructuralBusy() {}, setStatus() {}, setError() {},
    mounted: { current: true }, currentSession: () => true, queue: { current: { flush: () => { trace.push('flush'); return held.promise; } } } });
  const work = saving(() => { trace.push('start'); return f.creation.current.start({ titulo: 'Nueva', emoji: '📝', bloques: [] }); });
  assert.deepEqual(trace, ['flush']); assert.equal(counter.current, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.creation.current.snapshot().phase, 'idle'); held.resolve(false);
  await assert.rejects(work, error => error.pendingDraft === true);
  assert.equal(f.calls.length, 0); assert.equal(counter.current, 0); cleanup();
});

test('recovery does not become an extra grid child and unresolved creation cannot render Guardado', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const full = nodes(page, ts.isJsxElement).find(n => n.openingElement.tagName.getText(ast) === 'main'
    && n.openingElement.attributes.properties.some(p => p.name?.getText(ast) === 'className' && p.initializer?.expression?.getText(ast).startsWith('`personal-lists-page')));
  assert.ok(full);
  assert.equal(full.children.some(n => ts.isJsxExpression(n) && n.expression?.getText(ast) === '!templateOpen&&creationRecovery'), false);
  const status = declarations('effectiveStatus');
  assert.equal(evaluate(status, { saveState: { status: 'saved', busy: false, dirty: false }, status: 'saved', structuralBusy: false,
    creationState: { busy: false, unresolved: true }, itemDrafts: { current: createPersonalItemDrafts() } }), 'pending');
});
