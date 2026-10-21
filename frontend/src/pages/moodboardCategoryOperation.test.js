import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createMoodboardCategoryOperation, moodboardCategoryDraftDirty } from './moodboardCategoryOperation.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { installUnsavedNavigation, registerNavigationGuard } from '../shared/navigation/unsaved.js';
import { requestAppNavigation } from '../shared/navigation/location.js';
const categories = () => [{ id: 11, nombre: 'One', orden: 1 }, { id: 12, nombre: 'Two', orden: 2 }];
const edits = () => categories().map(row => ({ ...row, changed: true, nombre: `${row.nombre} edited` }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(request, cookie = false) {
  let active = true, origin = {}, captures = 0, reads = 0;
  const store = createBrowserSessionState();
  if (cookie) store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 1, usuario: 'qa', nombre: 'QA', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  let session = cookie ? store.getSession() : { token: 'original', usuario: { id: 1, rol: 'admin' } };
  const original = session, calls = [];
  const capture = () => { captures++; const selected = origin; return createCapturedRequest({ session, readSession: () => session,
    isActive: () => active && origin === selected,
    request: async (url, options) => { calls.push({ url, options }); return request(url, options, calls.length); } }); };
  const refresh = async guard => { reads++; return { categories: await guard.request('/api/moodboards/boards/9/categories', { cache: 'no-store' }) }; };
  const model = createMoodboardCategoryOperation({ boardId: 9, categories: categories(), capture, refresh });
  return { model, calls, capture, original, get captures() { return captures; }, get reads() { return reads; },
    switch() { session = { token: 'replacement', usuario: { id: 2, rol: 'admin' } }; },
    boardABA() { origin = {}; origin = {}; }, unmount() { active = false; } };
}
function ack(url, options, extra = {}) {
  return { id: url.endsWith('/boards/9/categories') ? 13 : Number(url.split('/').at(-1)), board_id: 9,
    nombre: JSON.parse(options.body).name, orden: 1, ...extra };
}
test('one captured immutable ordered plan with synchronous double-submit guard and validated ACK IDs', async () => {
  const first = deferred();
  const f = fixture(async (url, options, count) => {
    if (!options.method) return [...edits(), { id: 13, nombre: 'New', orden: 3 }];
    if (count === 1) await first.promise; return ack(url, options);
  });
  const draft = edits(), pending = f.model.save(draft, ' New ');
  await assert.rejects(f.model.save(draft, 'Duplicate')); await assert.rejects(f.model.remove(12)); assert.equal(f.calls.length, 1);
  draft[1].nombre = 'Mutated'; first.resolve(); const result = await pending;
  assert.deepEqual(f.calls.filter(call => call.options.method).map(call => [call.options.method, JSON.parse(call.options.body).name]),
    [['PATCH', 'One edited'], ['PATCH', 'Two edited'], ['POST', 'New']]);
  assert.equal(f.captures, 1); assert.equal(f.reads, 1); assert.equal(result.scope.current(), true);
  assert.deepEqual(f.model.snapshot.completed.map(row => row.id), [11, 12, 13]); assert.equal(f.model.snapshot.phase, 'complete');
});
for (const status of [409, 500]) test(`middle ${status} keeps confirmed steps; recovery only reads and never resumes later POST`, async () => {
  const f = fixture(async (url, options, count) => {
    if (!options.method) return categories();
    if (count === 2) throw Object.assign(Error('middle failed'), { status }); return ack(url, options);
  });
  await assert.rejects(f.model.save(edits(), 'New'));
  assert.deepEqual(f.model.snapshot.completed.map(row => row.id), [11]); assert.equal(f.calls.length, 2);
  assert.equal(f.model.snapshot.phase, status === 409 ? 'failed' : 'uncertain');
  await assert.rejects(f.model.save(edits(), 'New')); assert.throws(() => f.model.finish());
  await f.model.refresh(); await f.model.refresh();
  assert.equal(f.calls.length, 4); assert.equal(f.calls.filter(call => call.options.method).length, 2);
  assert.equal(f.model.snapshot.failed.id, 12); assert.equal(f.model.finish().scope.current(), true);
  await assert.rejects(f.model.save(edits(), 'New')); assert.equal(f.calls.length, 4);
});
test('uncertain POST is never automatically repeated, matched by name, or inferred as owned from readback', async () => {
  const f = fixture(async (_url, options) => {
    if (options.method === 'POST') throw Error('POST response lost');
    return [...categories(), { id: 99, nombre: 'New', orden: 3 }];
  });
  await assert.rejects(f.model.save(categories(), 'New'));
  assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.model.snapshot.completed.length, 0);
  await f.model.refresh(); assert.equal(f.model.snapshot.completed.length, 0); assert.equal(f.model.snapshot.failed.kind, 'create');
  f.model.finish(); assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
});
test('uncertain DELETE keeps recovery even when refreshed list no longer contains ID, and never repeats DELETE', async () => {
  const f = fixture(async (_url, options) => { if (options.method === 'DELETE') throw Error('lost DELETE response'); return [categories()[1]]; });
  await assert.rejects(f.model.remove(11)); assert.equal(f.model.snapshot.phase, 'uncertain');
  await assert.rejects(f.model.remove(11)); await f.model.refresh();
  assert.equal(f.model.snapshot.completed.length, 0); assert.equal(f.model.snapshot.failed.id, 11);
  assert.throws(() => f.model.acceptRemoval()); assert.equal(f.model.finish().categories.length, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'DELETE').length, 1);
});
test('validated DELETE204 plus fresh scoped read can resume editing; no repeated acknowledged mutation', async () => {
  const f = fixture(async (url, options) => {
    if (options.method === 'DELETE') return null;
    if (!options.method) return [categories()[1]]; return ack(url, options);
  });
  await f.model.remove(11); assert.deepEqual(f.model.snapshot.completed, [{ kind: 'delete', id: 11, name: null }]);
  const removed = f.model.acceptRemoval(); assert.equal(removed.removedId, 11); assert.equal(f.model.snapshot.phase, 'idle');
  await assert.rejects(f.model.remove(11)); assert.equal(f.calls.length, 2);
  await f.model.save([{ id: 12, nombre: 'Two changed', orden: 2, changed: true }]);
  assert.equal(f.calls.filter(call => call.options.method === 'DELETE').length, 1);
});
for (const cookie of [false, true]) for (const change of ['switch','boardABA','unmount']) test(`${cookie ? 'cookie' : 'bearer'} ${change} stops later writes/read/finish from old operation`, async () => {
  const pending = deferred(), f = fixture(async (url, options) => { await pending.promise; return ack(url, options); }, cookie);
  const sent = f.model.save(edits(), 'New'); assert.equal(f.calls.length, 1); f[change]();
  pending.resolve(); await assert.rejects(sent);
  assert.equal(f.model.snapshot.phase, 'blocked'); assert.equal(f.calls.length, 1);
  await assert.rejects(f.model.refresh()); assert.throws(() => f.model.finish()); assert.equal(f.calls.length, 1);
  if (cookie) assert.equal(f.calls[0].options.sessionIntent.session, f.original); else assert.equal(f.calls[0].options.headers.Authorization, 'Bearer original');
});
test('ACK board/category/name validation prevents chaining into another ID or board', async () => {
  for (const patch of [{ id: 999 }, { board_id: 10 }, { nombre: 'Wrong name' }, { orden: '1' }]) {
    const f = fixture(async (url, options) => ack(url, options, patch)); await assert.rejects(f.model.save(edits(), 'New'));
    assert.equal(f.calls.length, 1); assert.equal(f.model.snapshot.completed.length, 0); assert.equal(f.model.snapshot.phase, 'uncertain');
  }
  const f = fixture(async () => undefined); await assert.rejects(f.model.save(edits())); assert.equal(f.calls.length, 1);
});
test('unobserved IDs and blank names fail before any write; malformed current lists never unlock finish', async () => {
  const f = fixture(async () => []);
  await assert.rejects(f.model.save([{ id: 999, nombre: 'Other board', changed: true }], 'New'));
  await assert.rejects(f.model.remove(999)); await assert.rejects(f.model.save([{ id: 11, nombre: ' ', changed: true }], 'New'));
  assert.equal(f.calls.length, 0); assert.equal(f.captures, 0);
  for (const current of [[{ id: 11, nombre: 'One' }], [{ id: 11, nombre: 'One', orden: 1, board_id: 10 }], [{ id: 11, nombre: 'One', orden: 1 }, { id: 11, nombre: 'Duplicate', orden: 2 }], null]) {
    const bad = fixture(async (url, options) => options.method ? ack(url, options) : current);
    await assert.rejects(bad.model.save([edits()[0]])); assert.equal(bad.model.snapshot.phase, 'read_failed');
    assert.throws(() => bad.model.finish()); assert.equal(bad.calls.filter(call => call.options.method).length, 1);
  }
});
test('all mutation ACKs followed by failed read recover with GET only; failed read never replays accepted steps', async () => {
  let reads = 0;
  const f = fixture(async (url, options) => { if (options.method) return ack(url, options); if (++reads === 1) throw Error('read failed'); return categories(); });
  await assert.rejects(f.model.save(edits(), 'New')); assert.equal(f.model.snapshot.completed.length, 3);
  assert.equal(f.model.snapshot.phase, 'read_failed'); await f.model.refresh(); f.model.finish();
  assert.equal(f.calls.filter(call => call.options.method).length, 3); assert.equal(f.reads, 2);
});
const source = readFileSync(new URL('./MoodboardPreview.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('MoodboardPreview.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = (root, predicate) => { const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result; };
const editor = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CategoryEditor');
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps));
const callback = (name, deps) => evaluate(nodes(editor, node => ts.isVariableDeclaration(node) && node.name.getText(file) === name)[0].initializer, deps);
test('actual CategoryEditor captures through parent origin, integrates busy/recovery and has no direct api/chained writes', () => {
  assert.equal(file.parseDiagnostics.length, 0); const text = editor.getText(file);
  assert.match(text, /useMoodboardOperation\(capture/); assert.match(text, /createMoodboardCategoryOperation/);
  assert.doesNotMatch(text, /await api\(|api\(/); assert.match(text, /Actualizar y revisar categorías/);
  assert.match(text, /No lo repetiremos ni continuaremos/); assert.match(text, /no demuestra quién realizó/);
  const entry = nodes(file, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'CategoryEditor')[0].getText(file);
  for (const prop of ['capture={captureOperation}', 'reload={reloadOperation}', 'onBusy={onOperationBusy}', 'scope.assertCurrent()']) assert.ok(entry.includes(prop));
});
test('actual CategoryEditor close cannot discard a partial/uncertain save or close while busy; only explicit reviewed finish calls saved', () => {
  const effects = [], deps = { busy: false, model: { snapshot: { phase: 'uncertain', busy: false } }, approveDiscard: () => true, close: () => effects.push('close'), setError: text => effects.push(text) };
  callback('leave', deps)(); assert.equal(effects.includes('close'), false); assert.equal(effects.length, 1);
  callback('leave', { ...deps, busy: true })(); assert.equal(effects.length, 1);
  callback('leave', { ...deps, model: { snapshot: { phase: 'idle', busy: false } } })(); assert.equal(effects.at(-1), 'close');
  const scope = {}, saved = []; callback('finish', { busy: false, approveDiscard: () => true, run: (action, done) => done(action()), model: { snapshot: { busy: false, reviewed: [] }, finish: () => ({ scope }) }, saved: own => saved.push(own) })();
  assert.deepEqual(saved, [scope]);
});
test('actual hook synchronously owns parent busy/recovery across partial write, review and explicit finish', async () => {
  const hookNode = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useMoodboardOperation');
  let layout, count = 0;
  const ownership = [], painted = [], first = deferred();
  const session = { token: 'owner', usuario: { id: 1, rol: 'admin' } };
  const capture = active => createCapturedRequest({ session, readSession: () => session, isActive: active,
    request: async (url, options) => {
      if (!options.method) return categories();
      if (++count === 1) { await first.promise; return ack(url, options); }
      throw Error('Second rename uncertain');
    } });
  const hook = evaluate(hookNode, { useRef: initial => ({ current: initial }), useState: initial => [typeof initial === 'function' ? initial() : initial, value => painted.push(value)],
    useLayoutEffect: effect => { layout = effect; } });
  const operation = hook(capture, own => createMoodboardCategoryOperation({ boardId: 9, categories: categories(), capture: own,
    refresh: async guard => ({ categories: await guard.request('/api/moodboards/boards/9/categories', {}) }) }),
  (owner, busy, recovery = false) => ownership.push({ owner, busy, recovery }));
  const cleanup = layout(), pending = operation.run(() => operation.model.save(edits(), 'New'));
  await operation.run(() => assert.fail('Synchronous duplicate must not run')); assert.equal(count, 1); assert.equal(ownership[0].busy, true);
  const leaveEffects = [];
  callback('leave', { busy: false, model: operation.model, close: () => leaveEffects.push('closed'), setError: message => leaveEffects.push(message) })();
  assert.deepEqual(leaveEffects, [], 'Live busy check protects close even before React rerenders');
  first.resolve(); await pending;
  assert.equal(operation.model.snapshot.phase, 'uncertain'); assert.deepEqual(ownership.at(-1), { owner: ownership[0].owner, busy: false, recovery: true });
  await operation.run(() => operation.model.refresh()); assert.equal(ownership.at(-1).recovery, true);
  let finished = 0; await operation.run(() => operation.model.finish(), () => { finished++; });
  assert.equal(finished, 1); assert.equal(count, 2); assert.equal(ownership.at(-1).recovery, false);
  assert.ok(ownership.every(item => item.owner === ownership[0].owner)); cleanup();
});
test('draft dirty is value-based, not model phase/changed flag; reverting values clears only genuine local changes', () => {
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), ''), false);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories().map(row => ({ ...row, changed: true })), ''), false);
  assert.equal(moodboardCategoryDraftDirty(categories(), edits(), ''), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), 'New'), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), ' '), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories().slice(1), ''), true);
});
test('actual draft owner/close callbacks consult product guard: cancel preserves fields, route/unload blocked, discard closes without saved classification', () => {
  const win = new EventTarget(); win.location = new URL('https://render.test/moodboards?board=9');
  const CustomEvent = class extends Event { constructor(type, options) { super(type, options); this.detail = options.detail; } };
  win.CustomEvent = CustomEvent; let accept = false, prompts = 0, closed = 0, saved = 0;
  win.confirm = () => { prompts++; return accept; };
  const operationOwners = { current: new Set() }, recoveryOwners = { current: new Set() }, mounted = { current: true };
  const busyNode = nodes(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'onOperationBusy')[0].initializer;
  const onBusy = evaluate(busyNode, { operationOwners, recoveryOwners, mounted, originCurrent: () => true, setOperationBusy() {} });
  const baseline = { current: categories() }, draftObservation = { current: { draft: categories(), newCategory: '' } }, draftOwner = { current: Symbol('draft') };
  const deps = { baseline, draftObservation, draftOwner, onBusy, moodboardCategoryDraftDirty, busy: false,
    model: { snapshot: { phase: 'idle', busy: false } }, setDraft() {}, setNewCategory() {}, saved() { saved++; } };
  deps.syncDraftOwner = callback('syncDraftOwner', deps);
  const layout = nodes(editor, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useLayoutEffect')[0];
  const cleanup = evaluate(layout.arguments[0], deps)();
  const session = { token: 'original', usuario: { id: 1, rol: 'admin' } };
  const statusNode = nodes(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'moodboardNavigationStatus')[0].initializer;
  const status = evaluate(statusNode, { sesion: session, getSesion: () => session, api: () => assert.fail('No mutation on discard'),
    createCapturedRequest, mounted, operationOwners, recoveryOwners });
  const installation = installUnsavedNavigation(win), off = registerNavigationGuard(win, status);
  try {
    const scope = { current: () => true };
    deps.approveDiscard = callback('approveDiscard', { captureCurrent: () => scope, CustomEvent, window: win });
    deps.close = () => { closed++; }; deps.setError = () => assert.fail('Idle draft should use product discard prompt');
    const leave = callback('leave', deps), editName = callback('editName', deps), editNew = callback('editNewName', deps);
    editName(11, 'Unsaved rename'); editNew('Unsaved new category');
    assert.deepEqual(status(), { dirty: true, busy: false }); assert.equal(deps.model.snapshot.phase, 'idle');
    const before = structuredClone(draftObservation.current);
    leave(); assert.equal(closed, 0); assert.equal(prompts, 1); assert.deepEqual(draftObservation.current, before);
    assert.equal(requestAppNavigation(win, '/inicio'), false); assert.deepEqual(draftObservation.current, before);
    const unload = new Event('beforeunload', { cancelable: true }); win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    operationOwners.current.add('pending-other-write'); accept = true; leave(); assert.equal(closed, 0, 'Busy product guard still prevents discard'); operationOwners.current.clear();
    accept = false; editName(11, 'One'); editNew(''); assert.deepEqual(status(), { dirty: false, busy: false });
    editNew('Unsaved again'); accept = true; leave(); assert.equal(closed, 1); assert.equal(saved, 0);
    assert.equal(deps.model.snapshot.phase, 'idle'); assert.equal(status().dirty, true, 'Owner lives until actual close/unmount, not a fabricated save');
    cleanup(); assert.deepEqual(status(), { dirty: false, busy: false });
    assert.equal((editor.getText(file).match(/onClick=\{leave\}/g) || []).length, 3, 'Close, backdrop and Cancel share the guarded path');
  } finally { off(); installation.dispose(); }
});
