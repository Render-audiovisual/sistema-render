import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { archiveObservation, archivePage, archivePageUrl, archivePiece, createEditorialArchiveOperation } from './EditorialArchiveControl.model.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
const key = '11111111-1111-4111-8111-111111111111', event = '22222222-2222-4222-8222-222222222222';
const piece = (extra = {}) => ({ id: 7, dominio: 'historia', cliente: { id: 8, nombre: 'Client', activo: true }, titulo: 'Existing story', tipo: 'historia',
  estado: 'lista', fecha_programada: '2026-10-29', revision: 1, archived: true, can_archive: false, can_restore: true, publication_classification: 'no_publicada', ...extra });
const operational = () => ({ id: 7, cliente_id: 8, estado: 'lista', publicacion_evidencia: { revision: 0 } });
const ack = (action = 'archivar', extra = {}) => ({ version: 1, piece: piece(), operation: { id: event, request_id: key, action, replayed: false }, ...extra });
function fixture(request, cookie = false) {
  let active = true, admin = true, keys = 0;
  const store = createBrowserSessionState();
  if (cookie) store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 1, usuario: 'ownerA', nombre: 'Owner', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  let session = cookie ? store.getSession() : { usuario: { id: 1, rol: 'admin' }, token: 'ownerA' };
  const calls = [], original = session;
  const capture = () => createCapturedRequest({ session, readSession: () => session, isActive: () => active,
    request: async (url, options) => { calls.push({ url, options }); return request(url, options, calls.length); } });
  const model = createEditorialArchiveOperation({ capture, isAdmin: () => admin, randomUUID: () => { keys++; return key; } });
  return { model, calls, original, get keys() { return keys; }, switch() { session = { usuario: { id: 2, rol: 'admin' }, token: 'ownerB' }; }, unmount() { active = false; model.cancel(); }, revoke() { admin = false; } };
}
test('closed DTO preserves archive/publication independence and rejects privacy expansion', () => {
  assert.equal(archivePiece(piece(), 'historia').archived, true);
  for (const invalid of [piece({ finance: 123 }), piece({ revision: '1' }), piece({ cliente: { id: 8, nombre: 'C', activo: true, money: 12 } }),
    piece({ dominio: 'publicacion' }), piece({ fecha_programada: '2026-02-30' }), piece({ archived: 'true' })]) assert.throws(() => archivePiece(invalid, 'historia'));
});
test('paged archive query is explicit, bounded, typed and all-time', () => {
  assert.equal(archivePageUrl('historia'), '/api/editorial-archivo?dominio=historia&offset=0&limit=20');
  assert.equal(archivePageUrl('publicacion', 20, 8), '/api/editorial-archivo?dominio=publicacion&offset=20&limit=20&cliente_id=8');
  for (const args of [['bad'], ['historia', -1], ['historia', 0, '8'], ['historia', 0, null, 51]]) assert.throws(() => archivePageUrl(...args));
  const page = { version: 1, dominio: 'historia', offset: 0, limit: 20, total: 1, has_more: false, items: [piece()] };
  assert.equal(archivePage(page, 'historia'), page);
  for (const invalid of [{ ...page, more: true }, { ...page, total: 2 }, { ...page, has_more: true }, { ...page, offset: 20 },
    { ...page, items: [piece({ archived: false })] }]) assert.throws(() => archivePage(invalid, 'historia'));
});
test('active rows capture evidence revision zero; typed archive rows capture own revision', () => {
  assert.deepEqual(archiveObservation(operational(), 'historia', 'archivar'), { id: 7, domain: 'historia', clientId: 8, revision: 0 });
  assert.equal(archiveObservation(piece({ revision: 12 }), 'historia', 'restaurar').revision, 12);
  assert.throws(() => archiveObservation({ ...operational(), publicacion_evidencia: null, revision: 12 }, 'historia', 'archivar'));
});
test('archive refuses real/historical publication, but restore permits legacy archived published active-client piece', async () => {
  for (const extra of [{ estado: 'publicada' }, { 'fecha_publicación_real': '2026-10-20' }, { publicacion_evidencia: { revision: 1, confirmation: {} } }]) {
    const f = fixture(() => assert.fail('No archive publication transport'));
    await assert.rejects(f.model.submit({ ...operational(), ...extra }, 'historia', 'archivar')); assert.equal(f.calls.length, 0);
  }
  assert.equal(archiveObservation(piece({ estado: 'publicada', publication_classification: 'historica_sin_confirmacion' }), 'historia', 'restaurar').id, 7);
  assert.throws(() => archiveObservation(piece({ cliente: { id: 8, nombre: 'C', activo: false } }), 'historia', 'restaurar'));
});
for (const cookie of [false, true]) test(`lost archive ACK repeats only explicit identical intent with original ${cookie ? 'cookie' : 'bearer'} actor`, async () => {
  const f = fixture(async (_url, _options, count) => { if (count === 1) throw Error('lost ACK'); return ack('archivar', { operation: { ...ack().operation, replayed: true } }); }, cookie);
  const row = operational(); await assert.rejects(f.model.submit(row, 'historia', 'archivar', 'Original reason'));
  row.publicacion_evidencia.revision = 99;
  assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.calls.length, 1);
  await assert.rejects(f.model.submit(row, 'historia', 'archivar')); assert.equal(f.keys, 1);
  await f.model.verify(); assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.body, f.calls[1].options.body);
  assert.equal(f.calls[1].url, '/api/editorial-archivo/historia/7/archivar');
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { request_id: key, expected_revision: 0, motivo: 'Original reason' });
  if (cookie) assert.equal(f.calls[1].options.sessionIntent.session, f.original); else assert.equal(f.calls[1].options.headers.Authorization, 'Bearer ownerA');
  f.model.complete(); assert.equal(f.model.snapshot.locked, false);
});
for (const action of ['archivar','restaurar']) test(`replay ${action} uses CURRENT opposite archive state, never assumes old action result`, async () => {
  const current = piece({ archived: action !== 'archivar', revision: 10, can_archive: action === 'archivar', can_restore: action !== 'archivar' });
  const f = fixture(async () => ack(action, { piece: current, operation: { ...ack(action).operation, replayed: true } }));
  const result = await f.model.submit(action === 'archivar' ? operational() : piece(), 'historia', action);
  assert.equal(result.dto.piece.archived, action !== 'archivar'); assert.equal(f.calls.length, 1);
});
test('confirmed ACK plus consumer/read failure verifies without another POST', async () => {
  const f = fixture(async () => ack()); const saved = await f.model.submit(operational(), 'historia', 'archivar');
  assert.equal(f.model.snapshot.phase, 'confirmed'); assert.equal((await f.model.verify()).dto, saved.dto); assert.equal(f.calls.length, 1);
  await assert.rejects(f.model.submit(operational(), 'historia', 'archivar')); assert.equal(f.keys, 1);
});
for (const status of [401,403,404,409]) test(`${status} prevents new intent and automatic rebase`, async () => {
  const f = fixture(async () => { throw Object.assign(Error('rejected'), { status }); });
  await assert.rejects(f.model.submit(operational(), 'historia', 'archivar'));
  assert.equal(f.model.snapshot.phase, 'blocked'); await assert.rejects(f.model.verify()); assert.equal(f.calls.length, 1);
});
for (const status of [400,413,422,428]) test(`precommit ${status} permits explicit corrected input only`, async () => {
  const f = fixture(async () => { throw Object.assign(Error('invalid'), { status }); });
  await assert.rejects(f.model.submit(operational(), 'historia', 'archivar')); assert.equal(f.model.snapshot.locked, false); assert.equal(f.calls.length, 1);
});
for (const change of ['switch','unmount','revoke']) test(`${change} cannot verify under replacement authority`, async () => {
  const f = fixture(async () => { throw Error('lost'); }); await assert.rejects(f.model.submit(operational(), 'historia', 'archivar'));
  f[change](); await assert.rejects(f.model.verify()); assert.equal(f.calls.length, 1);
});
test('synchronous busy prevents duplicate sends; malformed receipt is uncertain rather than success', async () => {
  let resolve; const f = fixture(() => new Promise(yes => { resolve = yes; }));
  const sent = f.model.submit(operational(), 'historia', 'archivar'); await assert.rejects(f.model.verify()); await assert.rejects(f.model.submit(operational(), 'historia', 'archivar'));
  resolve(ack()); await sent; assert.equal(f.calls.length, 1);
  for (const invalid of [ack('restaurar'), ack('archivar', { piece: piece({ id: 99 }) }), ack('archivar', { piece: piece({ archived: false }) }),
    ack('archivar', { operation: { ...ack().operation, request_id: event } })]) {
    const bad = fixture(async () => invalid); await assert.rejects(bad.model.submit(operational(), 'historia', 'archivar'));
    assert.equal(bad.model.snapshot.phase, 'uncertain'); assert.equal(bad.calls.length, 1);
  }
});
test('cancelled late ACK never becomes accepted', async () => {
  let resolve; const f = fixture(() => new Promise(yes => { resolve = yes; }));
  const sent = f.model.submit(operational(), 'historia', 'archivar'); f.unmount(); resolve(ack()); await assert.rejects(sent);
  assert.equal(f.model.snapshot.accepted, null); assert.equal(f.calls.length, 1);
});
test('component/page wiring is admin-only, revision-aware, discoverable and contains no physical DELETE fallback', () => {
  const control = readFileSync(new URL('./EditorialArchiveControl.jsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('./EditorialArchivePanel.jsx', import.meta.url), 'utf8');
  for (const source of [control, panel]) assert.equal(ts.createSourceFile('component.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX).parseDiagnostics.length, 0);
  assert.match(control, /if \(!isAdmin\) return null/); assert.match(control, /if \(!isAdmin \|\|/);
  assert.match(control, /useNavigationGuard/); assert.match(control, /model\.verify\(\)/); assert.match(control, /result.dto.piece.archived/);
  assert.match(control, /Se conservan su contenido, las tareas vinculadas y el historial/);
  assert.doesNotMatch(control, /retir[aá]|DELETE/);
  assert.match(panel, /props.isAdmin \?/); assert.match(panel, /archivePageUrl/); assert.match(panel, /disabled=\{loading \|\| locked/);
  assert.match(panel, /Todas las fechas/); assert.match(panel, /Anterior/); assert.match(panel, /Siguiente/);
  for (const name of ['Historias','Publicaciones']) {
    const source = readFileSync(new URL(`../pages/${name}.jsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /method: "DELETE"|title="Eliminar"/);
    assert.match(source, /'archivadas'/); assert.match(source, /view.role === 'admin' && <EditorialArchive/);
    assert.match(source, /dto.piece.archived/); assert.match(source, /scope.assertCurrent\(\)/);
  }
});

// Execute the actual layout-effect setup and event callback, with explicit
// setup→cleanup→setup replay. This is not a mounted React/StrictMode claim.
const controlSource = readFileSync(new URL('./EditorialArchiveControl.jsx', import.meta.url), 'utf8');
const controlFile = ts.createSourceFile('EditorialArchiveControl.jsx', controlSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const descendants = (root, predicate) => { const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found; };
const component = controlFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'EditorialArchiveControl');
const layout = descendants(component, node => ts.isCallExpression(node) && node.expression.getText(controlFile) === 'useLayoutEffect')[0];
const saveNode = descendants(component, node => ts.isFunctionDeclaration(node) && node.name?.text === 'save')[0];
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(controlFile)});`)(...Object.values(deps));
function controlHarness(request) {
  const calls = [], saved = [], errors = [], locks = [], active = { current: false }, holder = { current: null };
  let live = true, renders = 0;
  const capture = () => ({ current: () => live, assertCurrent() { if (!live) throw Object.assign(Error('obsolete'), { code: 'session_binding_obsolete' }); },
    async request(url, options) { this.assertCurrent(); calls.push({ url, options }); const result = await request(url, options, calls.length); this.assertCurrent(); return result; } });
  const deps = { active, holder, capture, isAdmin: true, dominio: 'historia', piece: operational(), action: 'archivar', canStart: () => true,
    createEditorialArchiveOperation: options => createEditorialArchiveOperation({ ...options, randomUUID: () => key }),
    render() { renders++; }, onLockChange: value => locks.push(value),
    onSaved: async value => saved.push(value), setError: value => errors.push(value), setMessage() {}, window: { confirm: () => true } };
  return { deps, calls, saved, errors, locks, holder, active, setup: () => evaluate(layout.arguments[0], deps)(),
    handler: overrides => evaluate(saveNode, { ...deps, ...overrides }), invalidate() { live = false; }, get renders() { return renders; } };
}
test('actual setup→cleanup→setup owns fresh live model; pre-setup handler uses the replacement and archives exactly once', async () => {
  const h = controlHarness(async () => ack()), save = h.handler();
  const cleanupFirst = h.setup(), first = h.holder.current.model;
  cleanupFirst(); assert.equal(h.active.current, false); assert.equal(h.holder.current, null);
  const cleanupSecond = h.setup(), second = h.holder.current.model;
  assert.notEqual(first, second); assert.equal(h.active.current, true);
  await assert.rejects(first.submit(operational(), 'historia', 'archivar'));
  cleanupFirst(); assert.equal(h.active.current, true); assert.equal(h.holder.current.model, second, 'Old cleanup cannot clear replacement ownership');
  await save(); assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 1);
  assert.equal(second.snapshot.phase, 'idle'); assert.equal(h.errors.filter(Boolean).length, 0);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { request_id: key, expected_revision: 0 });
  assert.equal(h.renders >= 2, true);
  assert.doesNotMatch(layout.arguments[1].getText(controlFile), /\bmodel\b|snapshot/);
  cleanupSecond();
});
test('ordinary handler rerender preserves uncertain original instance/body; verify never borrows newer row revision', async () => {
  const h = controlHarness(async (_url, _options, count) => { if (count === 1) throw Error('lost'); return ack('archivar', { operation: { ...ack().operation, replayed: true } }); });
  const cleanup = h.setup(), model = h.holder.current.model;
  await h.handler()(); assert.equal(model.snapshot.phase, 'uncertain');
  const rerendered = h.handler({ piece: { ...operational(), publicacion_evidencia: { revision: 88 } } });
  await rerendered(true); assert.equal(h.holder.current.model, model);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].options.body, h.calls[1].options.body);
  assert.equal(h.saved.length, 1); cleanup();
});
test('late ACK/error from cleaned setup cannot publish, clear replacement locks or paint errors', async () => {
  for (const reject of [false, true]) {
    let resolve, fail; const wait = new Promise((yes, no) => { resolve = yes; fail = no; });
    const h = controlHarness(async () => wait), cleanupFirst = h.setup();
    const pending = h.handler()(); assert.equal(h.calls.length, 1);
    cleanupFirst(); const cleanupSecond = h.setup(), replacement = h.holder.current.model;
    const locks = [...h.locks], errors = [...h.errors];
    if (reject) fail(Error('old private error')); else resolve(ack()); await pending;
    assert.equal(h.holder.current.model, replacement); assert.equal(h.active.current, true);
    assert.deepEqual(h.locks, locks); assert.deepEqual(h.errors, errors); assert.equal(h.saved.length, 0);
    cleanupSecond();
  }
});
