import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';
import { verifiedGoalPreparationAck,goalPreparationBody } from './clientGoalQuota.js';

// Execute the actual hook/callback source with injected effects, not mounted React.
const source = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClientesObjetivos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = n => n.getText(file);
function nodes(root, predicate) { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); } visit(root); return result; }
const owner = name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
const callback = (component, name, deps) => evaluate(nodes(owner(component), n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer, deps);
const goalId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const goalTime = value => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
const done = piece => ['finalizada', 'publicada'].includes(piece.estado);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(request) {
  const store = createBrowserSessionState();
  function accept(id) { store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); }
  accept(7); let live = store.getSession(), view = createSessionView(sessionViewInputs(live));
  const refs = []; let cursor = 0, layout, cleanup;
  const calls = [];
  const hook = evaluate(owner('useGoalSession'), { useSessionView: () => view, useRef: initial => refs[cursor++] ||= { current: initial },
    useLayoutEffect: effect => { layout ||= effect; }, useCallback: fn => fn, getSesion: () => live, createCapturedRequest,
    apiRequest: (url, options) => { calls.push({ url, options }); return request(url, options); } });
  const render = context => { cursor = 0; return hook(live, context); };
  assert.equal(render('A').capture().current(), false); cleanup = layout();
  const scopes = render('A');
  return { ...scopes, calls, render, unmount: () => cleanup(), switch() { accept(8); live = store.getSession(); view = createSessionView(sessionViewInputs(live)); render('A'); } };
}
function detail(request, piece = {}) {
  const f = fixture(request), effects = [];
  const deps = { draftMemory: null, readRetainedDraft: () => null, useGoalDraftMemory: () => null,
    capture: f.capture, captureLifetime: f.captureLifetime, pending: { current: false }, canManage: true, canEditContent: true, finalizable: true,
    piece: { id: 3, tarea_id: 9, estado: 'aprobada', tarea_revision: 4, tarea_updated_at: '2026-10-20T10:00:00.123Z', ...piece },
    title: 'Nuevo', copy: 'Copy', editBaseline: { current: null }, taskRevision: 6, taskVersion: '2026-10-20T11:00:00.123Z', goalId, goalTime, done, isSessionFailure,
    window: { confirm: () => true }, saved: () => effects.push(['saved']),
    ...Object.fromEntries(['Busy','Error','TaskVersion','TaskRevision','Title','Copy','Editing'].map(name => [`set${name}`, value => effects.push([name, value])])) };
  return { ...f, deps, effects, run: name => callback('PieceDetail', name, deps)() };
}

test('source parses; zero raw fetch/JSON readers, genuine session retained and layout mounted before child effects', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.equal(nodes(file, n => ts.isCallExpression(n) && (text(n.expression) === 'fetch' || text(n.expression).endsWith('.json'))).length, 0);
  assert.match(text(owner('useGoalSession')), /session: view.session/);
  assert.match(text(owner('useGoalSession')), /useLayoutEffect/);
  assert.match(text(owner('ClientesObjetivosPage')), /key=\{identity.current.epoch\}/);
});

test('actual hook rejects A/B, unmount and client/period ABA while lifetime cleanup stays available', async () => {
  const wait = deferred(), f = fixture(() => wait.promise), scope = f.capture(), life = f.captureLifetime();
  const pending = scope.request('/api/cliente-objetivos');
  f.render('B'); f.render('A'); assert.equal(scope.current(), false); assert.equal(life.current(), true);
  wait.resolve({}); await assert.rejects(pending, { code: 'session_binding_obsolete' });
  assert.ok(f.calls[0].options.sessionIntent); assert.equal(f.calls[0].options.headers.Authorization, undefined);
  const fresh = f.render('A').capture(); f.switch(); assert.equal(fresh.current(), false); assert.equal(life.current(), false);
  f.unmount(); assert.equal(f.render('A').capture().current(), false);
});

test('finish uses held observation directly, no GET/rebase, and prevents duplicate dispatch', async () => {
  const wait = deferred(), f = detail(() => wait.promise);
  const a = f.run('finish'), b = f.run('finish');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { estado: 'finalizada', expected_updated_at: f.deps.piece.tarea_updated_at, expected_revision: 4 });
  wait.resolve({ id: 9, revision: 5, estado: 'finalizada' }); await Promise.all([a,b]);
  assert.equal(f.effects.filter(([name]) => name === 'saved').length, 1);
});

test('finish requires approval and held revision, never silently refreshes', async () => {
  const f = detail(() => { throw Error('unexpected'); }); f.deps.finalizable = false;
  await f.run('finish'); assert.equal(f.calls.length, 0);
  f.deps.finalizable = true; f.deps.piece.tarea_revision = null;
  await f.run('finish'); assert.equal(f.calls.length, 0); assert.ok(f.effects.some(([name]) => name === 'Error'));
});

test('late finish success/error under B neither paints nor notifies, no retry', async () => {
  for (const fail of [false,true]) {
    const wait = deferred(), f = detail(() => wait.promise), promise = f.run('finish');
    f.switch(); const count = f.effects.length;
    if (fail) wait.reject(new Error('private A')); else wait.resolve({ id: 9, revision: 5, estado: 'finalizada' });
    await promise; assert.equal(f.effects.length, count); assert.equal(f.calls.length, 1);
  }
});

test('content captures displayed revision; conflict retains draft and never rebases/retries', async () => {
  const f = detail(async () => { throw Object.assign(new Error('Conflicto: revisá los cambios.'), { status: 409 }); });
  await f.run('saveContent');
  assert.equal(JSON.parse(f.calls[0].options.body).expected_revision, 6);
  assert.equal(f.calls.length, 1); assert.ok(f.effects.some(([name]) => name === 'Error'));
  assert.equal(f.effects.some(([name]) => ['saved','Editing','Title','Copy','TaskRevision'].includes(name)), false);
});

test('invalid ACK cannot report success; beginEdit validates real task identity before displaying fields', async () => {
  const f = detail(async () => ({})); await f.run('saveContent');
  assert.equal(f.effects.some(([name]) => name === 'saved'), false);
  const g = detail(async () => ({ id: 10, revision: 7, updated_at: '2026-10-20T11:00:00Z', titulo: 'Wrong task' }));
  await g.run('beginEdit'); assert.equal(g.effects.some(([name]) => name === 'Editing'), false);
  const h = detail(async () => ({ id: 9, revision: 7, updated_at: '2026-10-20T11:00:00Z', titulo: 'Actual', propiedades_extra: { copy_trabajo: 'Actual copy' } }));
  await h.run('beginEdit'); assert.ok(h.effects.some(([name,value]) => name === 'TaskRevision' && value === 7));
});

test('period URL validation rejects duplicate/invalid dates including popstate; valid historic month retained', () => {
  const parse = evaluate(owner('goalPeriod'), { URLSearchParams, currentMonth: () => '2026-10' });
  assert.equal(parse(''), '2026-10'); assert.equal(parse('?periodo=2025-02'), '2025-02');
  for (const value of ['0000-01','2026-13','2026-1','garbage']) assert.throws(() => parse(`?periodo=${value}`));
  assert.throws(() => parse('?periodo=2026-10&periodo=2026-10'));
  assert.match(text(owner('GoalPage')), /goalPeriod\(window.location.search\)/);
  assert.match(text(owner('GoalPage')), /addEventListener\('popstate', pop\)/);
});

test('modal polling defers instead of replacing held piece; keys contain period/client/task and copy is truthful', () => {
  const page = text(owner('GoalPage'));
  assert.ok(page.includes('if (modalOpen.current) { deferred.current = true; return; }'));
  assert.equal(page.includes('setSelectedPiece(piece =>'), false);
  assert.ok(page.includes('${epoch}:${period}:${client.clave}:${selectedPiece.id}:${selectedPiece.tarea_id}'));
  assert.match(page, /pendingPeriod.current = next/);
  assert.match(source, /Si ya estaba aprobada, los cambios requieren otra revisión\./);
  assert.doesNotMatch(source, /No cambia su estado/);
  assert.match(source, /disabled=\{busy \|\| !finalizable\}/);
  assert.match(source, /Requiere aprobación/);
});

test('actual poll callback waits for principal GET in both event orders and ignores in-flight result on modal open', async () => {
  const updateNode = nodes(owner('GoalPage'), n => ts.isVariableDeclaration(n) && text(n.name) === 'update')[0].initializer;
  const wait = deferred(), f = fixture(() => wait.promise), effects = [];
  const deps = { document: { visibilityState: 'visible' }, busy: false, stopped: false, scope: f.capture(), locationError: '', loaded: { current: true },
    modalOpen: { current: true }, deferred: { current: false }, readGeneration: { current: 0 }, controller: new AbortController(), period: '2026-10',
    goalOverview: value => value, isSessionFailure, AUTO_UPDATE_ERROR: 'error', setData: value => effects.push(value), setNotice: value => effects.push(value) };
  const update = () => evaluate(updateNode, deps)();
  deps.loaded.current = false; await update(); deps.modalOpen.current = false; await update();
  assert.equal(f.calls.length, 0); assert.equal(deps.readGeneration.current, 0);
  deps.loaded.current = true; deps.modalOpen.current = true;
  await update(); assert.equal(f.calls.length, 0); assert.equal(deps.deferred.current, true);
  deps.modalOpen.current = false; const promise = update(); deps.modalOpen.current = true;
  wait.resolve({ clientes: [] }); await promise; assert.deepEqual(effects, []);
});

test('content ACK requires advanced positive revision; no success for timestamp-only or unchanged revision', async () => {
  for (const revision of [undefined,6,0,'7',7]) {
    const f = detail(async () => ({ updated_at: '2026-10-20T12:00:00Z', revision }));
    await f.run('saveContent'); assert.equal(f.effects.some(([name]) => name === 'saved'), revision === 7);
  }
});

test('actual dirty modal close and cancel share discard checks; pending operation cannot close', () => {
  const effects = [], deps = { draftMemory: null, readRetainedDraft: () => null, pending: { current: false }, capture: () => ({ current: () => true }), editing: true, title: 'changed', copy: 'copy',
    editBaseline: { current: JSON.stringify({ title: 'original', copy: 'copy' }) }, window: { confirm: () => false }, close: () => effects.push('close'), setEditing: () => effects.push('cancel') };
  deps.discardAllowed = callback('PieceDetail','discardAllowed',deps);
  callback('PieceDetail','closeSafely',deps)(); callback('PieceDetail','cancelEdit',deps)(); assert.deepEqual(effects, []);
  deps.window.confirm = () => true; callback('PieceDetail','closeSafely',deps)(); assert.deepEqual(effects, ['close']);
  deps.pending.current = true; callback('PieceDetail','cancelEdit',deps)(); assert.deepEqual(effects, ['close']);
  const prepare = { pending: { current: false }, reviewBlocked:{current:false},capture: deps.capture, acknowledged:false, selected: { video: [9] }, accounts: {}, initialSelection: { current: '{}' }, window: { confirm: () => false }, close: deps.close };
  callback('PrepareGoal','closeSafely',prepare)(); assert.deepEqual(effects, ['close']);
  assert.equal((source.match(/onClose=\{closeSafely\}/g) || []).length, 2);
  assert.match(source, /onClick=\{cancelEdit\}/);
});

test('preparation serializes original body, validates ACK and ignores account-switch success', async () => {
  const wait = deferred(), f = fixture(() => wait.promise), effects = [];
  const deps = { capture: f.capture, captureLifetime: f.captureLifetime, pending: { current: false }, period: '2026-10', view:{role:'community'},acknowledged:true,goalPreparationBody,client: { clave: 'cliente-9',cuentas:[{id:9,nombre:'QA'}],preparado:false,reels:1,carruseles:1,cuota_actual:{reels:1,carruseles:1},cuota_desactualizada:false,cuota_revision:null,preparacion_revision:'a'.repeat(64),piezas:[] },
    formats: { video: [7], carrusel: [8] }, shared: false, accounts: {}, goalId, isSessionFailure, reconciling:false, reviewBlocked:{current:false}, verifiedGoalPreparationAck,
    setBusy: value => effects.push(['busy', value]), setError: value => effects.push(['error', value]), saved: value => effects.push(['saved', value]) };
  const submit = callback('PrepareGoal', 'submit', deps), event = { preventDefault() {} };
  const promise = submit(event); await submit(event); assert.equal(f.calls.length, 1);
  deps.formats.video.push(10); assert.deepEqual(JSON.parse(f.calls[0].options.body).responsables, [7,8]);
  f.switch(); const count = effects.length; wait.resolve({ objetivo_id: 9, creadas: 2, vinculadas: 0 }); await promise;
  assert.equal(effects.length, count);
});
