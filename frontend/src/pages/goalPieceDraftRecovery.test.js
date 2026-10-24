import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createGoalDraftMemory, resolveGoalDraftPiece, makeGoalDraftHref } from '../shared/navigation/goalDraftMemory.js';

// Execute actual callback source against the real document-lifetime store.
// No mounted browser, HTTP, storage or server authority claims.
const source = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClientesObjetivos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
const component = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PieceDetail');
function initializer(name) {
  let found;
  function walk(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(file) === name) found = n.initializer;
    ts.forEachChild(n, walk);
  }
  walk(component); assert.ok(found, name); return found;
}
const evaluate = (name, deps) => Function(...Object.keys(deps), `return (${initializer(name).getText(file)});`)(...Object.values(deps));
const context = { pieceId: 3, taskId: 9, clientId: 7, period: '2026-10' };
const baseline = JSON.stringify({ title: 'Original', copy: 'Original copy' });
const version = '2026-10-20T11:00:00.123Z';
const draft = extra => ({ ...context, title: 'Retained title', copy: 'Retained copy', baseline,
  taskRevision: 6, taskVersion: version, ...extra });
const ack = { revision: 9, updated_at: '2026-10-21T12:00:00.123Z' };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture({ retained = draft(), request } = {}) {
  const memory = createGoalDraftMemory({ isCurrent: () => true });
  if (retained) assert.ok(memory.retain(retained));
  let current = true;
  const calls = [], effects = [], cleared = [], uncertain = [];
  const draftMemory = {
    ...memory,
    clear(token) { cleared.push(token); return memory.clear(token); },
    markUncertain(token) { uncertain.push(token); return memory.markUncertain(token); },
  };
  const scope = {
    current: () => current,
    assertCurrent() { if (!current) throw Object.assign(new Error('Obsolete'), { code: 'session_binding_obsolete' }); },
    async request(url, options) {
      calls.push({ url, options });
      if (request) return request(url, options);
      return options ? ack : { id: 9, revision: 8, updated_at: '2026-10-21T11:00:00.123Z', titulo: 'Current peer title', propiedades_extra: { copy_trabajo: 'Current peer copy' } };
    },
  };
  const deps = {
    draftMemory, draftContext: { ...context }, piece: { id: 3, tarea_id: 9, copy: 'Piece copy' },
    canEditContent: true, pending: { current: false }, editBaseline: { current: baseline },
    editing: false, title: 'Retained title', copy: 'Retained copy', taskVersion: version, taskRevision: 6,
    capture: () => scope, captureLifetime: () => scope,
    goalId: value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647,
    goalTime: value => typeof value === 'string' && Number.isFinite(Date.parse(value)),
    isSessionFailure: error => error.code === 'session_binding_obsolete',
    saved: () => effects.push(['saved']), window: { confirm: () => true }, close: () => effects.push(['close']),
  };
  for (const name of ['Busy', 'Error', 'Editing', 'Title', 'Copy', 'TaskVersion', 'TaskRevision']) {
    deps[`set${name}`] = value => { effects.push([name, value]); deps[name[0].toLowerCase() + name.slice(1)] = value; };
  }
  deps.readRetainedDraft = () => evaluate('readRetainedDraft', deps)();
  deps.discardAllowed = () => evaluate('discardAllowed', deps)();
  return { memory, calls, effects, cleared, uncertain, deps,
    run: (name, ...args) => evaluate(name, deps)(...args), obsolete() { current = false; } };
}

test('actual rememberContent publishes exact draft and held CAS without requests or baseline mutation', () => {
  const h = fixture({ retained: null });
  let notifications = 0; h.memory.subscribe(() => notifications++);
  assert.equal(h.run('rememberContent', 'New title', 'New copy'), true);
  assert.deepEqual(h.memory.getSnapshot(), draft({ title: 'New title', copy: 'New copy', status: 'editing' }));
  assert.equal(notifications, 1);
  assert.equal(h.deps.editBaseline.current, baseline);
  assert.equal(h.deps.taskRevision, 6); assert.equal(h.deps.taskVersion, version);
  assert.deepEqual(h.calls, []);
  assert.equal(h.run('rememberContent', 'Original', 'Original copy'), true);
  assert.equal(h.memory.getSnapshot(), null);
});

test('actual identity reader rejects a mismatch in any expected ID or period', () => {
  const h = fixture(), held = h.memory.getSnapshot();
  assert.equal(h.deps.readRetainedDraft(), held);
  for (const key of Object.keys(context)) {
    h.deps.draftContext = { ...context, [key]: key === 'period' ? '2026-11' : context[key] + 1 };
    assert.equal(h.deps.readRetainedDraft(), null);
  }
});

test('actual beginEdit GET restores retained baseline and old CAS, never current peer content or POST', async () => {
  const h = fixture(), held = h.memory.getSnapshot();
  await h.run('beginEdit');
  assert.deepEqual(h.calls, [{ url: '/api/tareas/9?workspace=render_os', options: undefined }]);
  assert.equal(h.deps.title, held.title); assert.equal(h.deps.copy, held.copy);
  assert.equal(h.deps.editBaseline.current, baseline);
  assert.equal(h.deps.taskRevision, 6); assert.equal(h.deps.taskVersion, version);
  assert.equal(h.deps.editing, true); assert.match(h.deps.error, /revisión original/);
  assert.equal(h.memory.getSnapshot(), held);
});

test('denied capability never GETs or restores retained private content', async () => {
  const h = fixture(); h.deps.canEditContent = false;
  await h.run('beginEdit'); assert.deepEqual(h.calls, []); assert.deepEqual(h.effects, []);
});

for (const saving of [false, true]) {
  test(`other draft or saving token cannot be overwritten (saving=${saving})`, async () => {
    const h = fixture({ retained: draft(saving ? {} : { pieceId: 4 }) });
    if (saving) h.memory.markSaving(h.memory.getSnapshot());
    const held = h.memory.getSnapshot();
    assert.equal(h.run('rememberContent', 'Replacement', 'Replacement copy'), false);
    await h.run('beginEdit');
    assert.equal(h.memory.getSnapshot(), held); assert.deepEqual(h.calls, []);
    assert.equal(h.deps.editing, false); assert.ok(h.deps.error);
  });
}

test('pending and obsolete rememberContent cannot publish', () => {
  const h = fixture({ retained: null }); h.deps.pending.current = true;
  assert.equal(h.run('rememberContent', 'New', 'New'), false);
  h.deps.pending.current = false; h.obsolete();
  assert.equal(h.run('rememberContent', 'New', 'New'), false);
  assert.equal(h.memory.getSnapshot(), null);
});

test('draft replaced during GET cannot paint the stale retained response', async () => {
  const wait = deferred(), h = fixture({ request: () => wait.promise });
  const pending = h.run('beginEdit');
  const newer = h.memory.retain(draft({ title: 'Newer draft' }));
  wait.resolve({ id: 9, revision: 8, updated_at: version, titulo: 'Peer' }); await pending;
  assert.equal(h.memory.getSnapshot(), newer);
  assert.equal(h.deps.editing, false);
  assert.equal(h.effects.some(([name]) => ['Title', 'Copy', 'TaskRevision', 'TaskVersion'].includes(name)), false);
});

test('valid ACK clears precisely the saving token after PATCH with original CAS', async () => {
  const wait = deferred(), h = fixture({ request: () => wait.promise });
  const pending = h.run('saveContent'), token = h.memory.getSnapshot();
  assert.equal(token.status, 'saving');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/cliente-objetivos/piezas/3/contenido');
  assert.equal(h.calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { titulo: 'Retained title', copy: 'Retained copy', expected_updated_at: version, expected_revision: 6 });
  wait.resolve(ack); await pending;
  assert.deepEqual(h.cleared, [token]); assert.deepEqual(h.uncertain, [token]);
  assert.equal(h.memory.getSnapshot(), null);
  assert.equal(h.effects.filter(([name]) => name === 'saved').length, 1);
});

for (const failure of ['conflict', 'invalid ACK', 'lost scope']) {
  test(`${failure} retains uncertain content and original CAS without saved notification`, async () => {
    const wait = deferred(), h = fixture({ request: () => wait.promise });
    const pending = h.run('saveContent'), token = h.memory.getSnapshot();
    if (failure === 'conflict') wait.reject(Object.assign(new Error('Conflict'), { status: 409 }));
    else { if (failure === 'lost scope') h.obsolete(); wait.resolve(failure === 'invalid ACK' ? {} : ack); }
    await pending;
    assert.deepEqual(h.memory.getSnapshot(), { ...token, status: 'uncertain' });
    assert.deepEqual(h.cleared, []); assert.deepEqual(h.uncertain, [token]);
    assert.equal(h.effects.some(([name]) => name === 'saved'), false);
    assert.equal(h.calls.length, 1); assert.equal(h.deps.pending.current, false);
  });
}

test('stale successful save cannot clear or mark uncertain a newer memory token', async () => {
  const wait = deferred(), h = fixture({ request: () => wait.promise });
  const pending = h.run('saveContent'), old = h.memory.getSnapshot();
  h.memory.clear(old);
  const newer = h.memory.retain(draft({ title: 'Newer document draft' }));
  wait.resolve(ack); await pending;
  assert.deepEqual(h.cleared, [old]); assert.deepEqual(h.uncertain, [old]);
  assert.equal(h.memory.getSnapshot(), newer);
});

for (const name of ['closeSafely', 'cancelEdit']) {
  test(`${name} clears only matching retained draft after actual discard check`, () => {
    const h = fixture(), held = h.memory.getSnapshot(); h.deps.editing = true;
    h.deps.window.confirm = () => false; h.run(name);
    assert.equal(h.memory.getSnapshot(), held); assert.deepEqual(h.cleared, []);
    h.deps.window.confirm = () => true; h.run(name);
    assert.equal(h.memory.getSnapshot(), null); assert.deepEqual(h.cleared, [held]);
  });
}

test('pure resolver accepts exact retained URL/context and strict capability, rejects ambiguous or mismatched recovery', () => {
  const held = draft(), piece = { id: 3, tarea_id: 9, puede_editar_contenido: true };
  const data = { periodo: context.period, clientes: [{ cuentas: [{ id: 7 }], piezas: [piece] }] };
  const search = makeGoalDraftHref(held).split('?')[1];
  assert.equal(resolveGoalDraftPiece(data, held, `?${search}`), piece);
  for (const suffix of ['&borrador=3', '&cliente=7', '&periodo=2026-10']) assert.equal(resolveGoalDraftPiece(data, held, `?${search}${suffix}`), null);
  for (const field of ['pieceId', 'taskId', 'clientId', 'period']) {
    assert.equal(resolveGoalDraftPiece(data, { ...held, [field]: field === 'period' ? '2026-11' : 99 }, `?${search}`), null);
  }
  for (const capability of [false, undefined, 'true']) {
    assert.equal(resolveGoalDraftPiece({ ...data, clientes: [{ cuentas: [{ id: 7 }], piezas: [{ ...piece, puede_editar_contenido: capability }] }] }, held, `?${search}`), null);
  }
});
