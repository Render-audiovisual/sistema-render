import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { registerNavigationGuard, installUnsavedNavigation } from '../shared/navigation/unsaved.js';
import { createGoalDraftMemory } from '../shared/navigation/goalDraftMemory.js';

// Execute the canonical getter and real navigation kernel. No mounted React,
// native browser dialog, HTTP, storage or backend authority claims.
const source = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClientesObjetivos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
function nodes(root, predicate) { const result = []; function walk(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, walk); } walk(root); return result; }
const piece = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PieceDetail');
assert.ok(piece);
const declarations = nodes(piece, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'contentNavigationStatus');
assert.equal(declarations.length, 1);
const getterNode = declarations[0].initializer;
function getter(deps) { return Function(...Object.keys(deps), `return (${getterNode.getText(file)});`)(...Object.values(deps)); }
function observation(extra = {}) {
  let current = true;
  const draft = { title: 'Título observado', copy: 'Copy observado' };
  const deps = { ...draft, editing: false, pending: { current: false }, editBaseline: { current: JSON.stringify(draft) },
    capture: () => ({ current: () => current }), readRetainedDraft: () => null, ...extra };
  return { deps, read: () => getter(deps)(), obsolete: () => { current = false; } };
}
class Target {
  listeners = new Map();
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); return !event.defaultPrevented; }
}
const event = (type, extra = {}) => ({ type, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
function kernel(h) {
  const win = new Target();
  win.location = new URL('https://render.test/clientes?cliente=9&periodo=2026-10');
  win.navigation = new Target();
  let accepted = false;
  const prompts = [];
  win.confirm = message => { prompts.push(message); return accepted; };
  const installation = installUnsavedNavigation(win);
  const unregister = registerNavigationGuard(win, h.read);
  const send = (type, extra) => { const e = event(type, extra); win.dispatchEvent(e); return e; };
  return { win, prompts, accept: value => { accepted = value; },
    leave: () => send('render:before-navigation', { detail: { href: '/reportes' } }),
    unload: () => send('beforeunload'),
    cleanup() { unregister(); installation.dispose(); } };
}

test('PieceDetail mounts its own named getter unconditionally, without replacing save or local-close logic', () => {
  const hooks = nodes(piece, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useNavigationGuard');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].arguments[0].getText(file), 'contentNavigationStatus');
  assert.ok(ts.isExpressionStatement(hooks[0].parent));
  assert.equal(hooks[0].parent.parent, piece.body);
  assert.equal(nodes(getterNode, n => ts.isCallExpression(n) && /^set|request|saved|close/.test(n.expression.getText(file))).length, 0);
});

test('actual getter distinguishes unchanged editor, edited title/copy, pending and obsolete ownership', () => {
  const h = observation();
  assert.deepEqual(h.read(), { dirty: false, busy: false });
  h.deps.editing = true; assert.deepEqual(h.read(), { dirty: false, busy: false });
  h.deps.title += ' editado'; assert.deepEqual(h.read(), { dirty: true, busy: false });
  h.deps.title = 'Título observado'; h.deps.copy += '\nBorrador'; assert.equal(h.read().dirty, true);
  h.deps.pending.current = true; assert.deepEqual(h.read(), { dirty: true, busy: true });
  h.obsolete(); assert.deepEqual(h.read(), { dirty: false, busy: false });
});

test('real kernel cancel preserves dirty draft and URL; consent never clears or writes the editor', () => {
  const h = observation({ editing: true, copy: 'Borrador sin guardar' }), k = kernel(h);
  try {
    const before = { title: h.deps.title, copy: h.deps.copy, baseline: h.deps.editBaseline.current, href: k.win.location.href };
    assert.equal(k.leave().defaultPrevented, true); assert.equal(k.prompts.length, 1);
    assert.equal(k.unload().defaultPrevented, true); assert.equal(k.prompts.length, 1, 'beforeunload does not invoke custom confirmation');
    k.accept(true); assert.equal(k.leave().defaultPrevented, false);
    assert.deepEqual({ title: h.deps.title, copy: h.deps.copy, baseline: h.deps.editBaseline.current, href: k.win.location.href }, before);
    assert.equal(h.read().dirty, true, 'Permission to leave is not an implicit save/reset');
  } finally { k.cleanup(); }
});

test('synchronous pending blocks exit and beforeunload even without dirty changes; cleanup releases only this guard', () => {
  const h = observation({ editing: true }), k = kernel(h);
  try {
    assert.equal(k.leave().defaultPrevented, false);
    h.deps.pending.current = true; // No React state flush is required.
    assert.equal(k.leave().defaultPrevented, true);
    assert.equal(k.unload().defaultPrevented, true);
    assert.equal(k.prompts.length, 0, 'Busy is not a discardable dirty prompt');
    h.deps.pending.current = false;
    assert.equal(k.leave().defaultPrevented, false); assert.equal(k.unload().defaultPrevented, false);
    h.deps.copy = 'Privado pendiente'; h.deps.pending.current = true;
    h.obsolete(); assert.equal(k.leave().defaultPrevented, false); assert.equal(k.unload().defaultPrevented, false);
    assert.equal(h.deps.copy, 'Privado pendiente', 'Getter does not mutate stale state');
  } finally { k.cleanup(); }
  assert.equal([...k.win.listeners.values()].every(listeners => listeners.size === 0), true);
  assert.equal([...k.win.navigation.listeners.values()].every(listeners => listeners.size === 0), true);
});

test('actual dirty editor also protects supported same-document browser traversal', () => {
  const h = observation({ editing: true, title: 'Nuevo título' }), k = kernel(h);
  try {
    const back = event('navigate', { navigationType: 'traverse', destination: { sameDocument: true, url: 'https://render.test/workspace/tareas?task=81' } });
    k.win.navigation.dispatchEvent(back); assert.equal(back.defaultPrevented, true);
    assert.equal(h.deps.title, 'Nuevo título'); assert.equal(k.prompts.length, 1);
  } finally { k.cleanup(); }
});

test('real retained draft exempts link/traverse only; unload still warns and pending stays busy', () => {
  const memory = createGoalDraftMemory({ isCurrent: () => true });
  const draft = memory.retain({ pieceId: 3, taskId: 9, clientId: 7, period: '2026-10',
    title: 'Retained', copy: 'Retained copy', baseline: JSON.stringify({ title: 'Original', copy: 'Original copy' }),
    taskRevision: 6, taskVersion: '2026-10-20T11:00:00.123Z' });
  assert.ok(draft);
  const h = observation({ editing: true, title: draft.title, copy: draft.copy,
    editBaseline: { current: draft.baseline }, readRetainedDraft: () => memory.getSnapshot() });
  const read = type => getter(h.deps)({ type });
  for (const type of ['link', 'traverse']) assert.deepEqual(read(type), { dirty: false, busy: false });
  assert.deepEqual(read('unload'), { dirty: true, busy: false });
  assert.deepEqual(h.read(), { dirty: true, busy: false });
  h.deps.pending.current = true;
  for (const type of ['link', 'traverse']) assert.deepEqual(read(type), { dirty: false, busy: true });
  assert.deepEqual(read('unload'), { dirty: true, busy: true });
  h.deps.pending.current = false; memory.clear(draft);
  for (const type of ['link', 'traverse', 'unload']) assert.deepEqual(read(type), { dirty: true, busy: false });
});
