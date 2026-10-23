import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';
import { editorialFields } from '../components/EditorialPublicationControl.model.js';
import { isConfirmedPublication } from '../shared/editorial/publication-evidence.js';
import { editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError } from '../shared/editorial/editorial-patch.js';
import { createEditorialCreateIntent } from '../shared/editorial/editorial-create-intent.js';

// Actual callbacks/hook logic with injected effects; no mounted React/browser claim.
const source = readFileSync(new URL('./Publicaciones.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Publicaciones.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = n => n.getText(file);
const nodes = (root, predicate) => { const found = []; const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }; visit(root); return found; };
const owner = name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const init = (component, name) => nodes(owner(component), n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer;
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
const callback = (component, name, deps) => { const n = init(component, name); return evaluate(ts.isCallExpression(n) && text(n.expression) === 'useCallback' ? n.arguments[0] : n, deps); };
const cal = 'PublicacionesCalendarioTab', sheet = 'PublicacionesPlanillaTab';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function sessionFixture(request, cookie = true) {
  const store = createBrowserSessionState();
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  if (cookie) accept(7);
  let live = cookie ? store.getSession() : { token: 'a', usuario: { id: 7, rol: 'admin', activo: true } };
  const original = live, requests = [], refs = []; let cursor = 0, layout, cleanup, currentView = createSessionView(sessionViewInputs(live));
  const hook = evaluate(owner('usePublicationSession'), { useSessionView: () => currentView,
    useRef: initial => refs[cursor++] ||= { current: initial }, useLayoutEffect: effect => { layout ||= effect; }, useCallback: fn => fn,
    getSesion: () => live, createCapturedRequest, apiRequest: (url, options) => { requests.push({ url, options }); return request(url, options); } });
  const render = context => { cursor = 0; return hook(live, context); };
  const beforeLayout = render('period-A'); assert.equal(beforeLayout.capture().current(), false);
  cleanup = layout(); const initial = render('period-A');
  return { ...initial, original, requests, render, unmount: () => cleanup(),
    switch() { if (cookie) { accept(8); live = store.getSession(); } else live = { token: 'b', usuario: { id: 8, rol: 'admin', activo: true } }; currentView = createSessionView(sessionViewInputs(live)); render('period-A'); } };
}
function sheetFixture(request, cookie = true) {
  const f = sessionFixture(request, cookie), effects = []; let rows = [];
  const deps = { capture: f.capture, view: f.view, clienteId: 2, publicaciones: [{ id: 5, estado: 'pendiente', publicacion_evidencia: { revision: 0 } }], editorialFields,
    onSnapshotLoaded: undefined, onCommittedChange: undefined, overviewGeneration: { current: 0 },
    editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError,
    creation: { current: { model: createEditorialCreateIntent({ capture: f.capture, randomUUID: () => '11111111-1111-4111-8111-111111111111' }) } }, renderCreation() {},
    responsablesReady: true, responsableNuevoId: '9', responsables: [{ id: 9, nombre: 'Actual catalog person', activo: true }],
    pendingWrites: { current: new Set() }, writeQueues: { current: new Map() }, latestWrites: { current: new Map() }, creating: { current: false },
    listGeneration: { current: 0 }, loadingGeneration: { current: 0 }, enfocarProximoId: { current: null }, mesPrefix: '2026-10', hoyISO: '2026-10-20',
    setError: value => effects.push(['error', value]), setPublicaciones: value => { rows = typeof value === 'function' ? value(rows) : value; effects.push(['rows', rows]); }, setCargando: value => effects.push(['loading', value]),
    window: { confirm: () => true } };
  deps.cargar = callback(sheet, 'cargar', deps);
  for (const name of ['guardarEnServidor', 'crearPublicacion', 'canArchivePublication', 'archivePublicationLock', 'archivePublicationSaved']) deps[name] = callback(sheet, name, deps);
  return { ...f, deps, effects, get rows() { return rows; } };
}
function calendarFixture(request, cookie = true) {
  const f = sessionFixture(request, cookie), effects = [], a = { id: 5, tipo: 'video', estado: 'pendiente', publicacion_evidencia: { revision: 0 } }, day = { fecha: '2026-10-20', items: [a] };
  let piece = a, selectedDay = day, saving = null;
  const selection = { current: { piece, day, year: 2026, month: 9, generation: 0 } }, selectedPiece = { current: { piece, generation: 0 } };
  const deps = { capture: f.capture, captureLifetime: f.captureLifetime, view: f.view, selection, selectedPiece, piezaSel: a, pendingWrites: { current: new Set() }, generating: { current: false },
    onCommittedChange: undefined,
    editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError,
    listGeneration: { current: 0 }, mesISO: '2026-10', isConfirmedPublication, getTipoPublicacionLabel: () => 'Reel',
    setActualizando: value => effects.push(['generating', value]), setError: value => effects.push(['error', value]),
    setGuardandoId: value => { saving = typeof value === 'function' ? value(saving) : value; effects.push(['saving', saving]); }, setPiezas: value => { effects.push(['rows', typeof value === 'function' ? value([a]) : value]); },
    setPiezaSel: value => { piece = typeof value === 'function' ? value(piece) : value; effects.push(['piece', piece]); },
    setDiaSel: value => { selectedDay = typeof value === 'function' ? value(selectedDay) : value; effects.push(['day', selectedDay]); },
    tareasLectura: null, tareasRetry: 0, tareasContext: { current: null },
    setTareasLectura: value => { deps.tareasLectura = value; syncTasks(); effects.push(['tasks-read', value]); },
    setTareasRetry: value => { deps.tareasRetry = typeof value === 'function' ? value(deps.tareasRetry) : value; syncTasks(); effects.push(['tasks-retry', deps.tareasRetry]); } };
  const contextAssignment = nodes(owner(cal), n => ts.isBinaryExpression(n) && text(n.left) === 'tareasContext.current')[0];
  assert.ok(contextAssignment, 'Extract actual render-owned task read context');
  const syncTasks = () => { deps.tareasContext.current = evaluate(contextAssignment.right, deps); };
  syncTasks();
  deps.cargarPublicaciones = callback(cal, 'cargarPublicaciones', deps);
  for (const name of ['cambiarFecha', 'cambiarEstadoPublicacion', 'actualizarCalendario']) deps[name] = callback(cal, name, deps);
  const observationUpdates = nodes(owner(cal), n => ts.isIfStatement(n) && (text(n.expression).startsWith('selection.current.piece') || text(n.expression).startsWith('selectedPiece.current.piece')));
  const select = (nextPiece, nextDay) => {
    piece = nextPiece; selectedDay = nextDay; deps.piezaSel = nextPiece;
    for (const n of observationUpdates) new Function('selection', 'selectedPiece', 'piezaSel', 'diaSel', 'year', 'month', text(n))(selection, selectedPiece, piece, selectedDay, 2026, 9);
  };
  return { ...f, deps, effects, a, day, select, syncTasks, get piece() { return piece; }, get selectedDay() { return selectedDay; }, get saving() { return saving; } };
}

test('full file has zero raw fetch/JSON readers; layout lifetime precedes child passive requests and genuine DTO is retained', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.equal(nodes(file, n => ts.isCallExpression(n) && text(n.expression) === 'fetch').length, 0);
  assert.doesNotMatch(source, /\.json\(|\.token|Authorization/);
  const hook = text(owner('usePublicationSession'));
  assert.match(hook, /useSessionView\(sesion \|\| getSesion\(\)\)/);
  assert.match(hook, /useLayoutEffect/); assert.match(hook, /mounted.current = false/);
  assert.match(hook, /session: view.session, readSession: getSesion, request: apiRequest/);
  assert.match(hook, /live.current === observation/);
  assert.match(source, /usePublicationSession\(sesion, `\$\{year\}:\$\{month\}`\)/);
  assert.match(source, /usePublicationSession\(sesion, `\$\{clienteId\}:\$\{year\}:\$\{month\}`\)/);
});
const linkedTasksEffect = () => nodes(owner(cal), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('/tareas`'));
const readLinkedTasks = f => { f.syncTasks(); return evaluate(init(cal, 'tareasActuales'), f.deps); };
const retryLinkedTasks = f => { f.syncTasks(); return callback(cal, 'reintentarTareas', f.deps)(); };
test('linked-task actual read distinguishes ready empty/data from transport and malformed errors without automatic retry', async () => {
  assert.equal(text(linkedTasksEffect().arguments[1]), '[piezaSel, capture, tareasRetry]');
  for (const response of [[], [{ id: 7, titulo: 'Observed task' }], null, {}, { items: [] }, Error('offline'), Object.assign(Error('server'), { status: 500 })]) {
    const f = calendarFixture(async () => { if (response instanceof Error) throw response; return response; });
    assert.deepEqual(readLinkedTasks(f), { status: 'loading', items: [] });
    const cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)();
    assert.equal(readLinkedTasks(f).status, 'loading');
    await settle();
    const actual = readLinkedTasks(f);
    assert.equal(actual.status, Array.isArray(response) ? 'ready' : 'error');
    assert.deepEqual(actual.items, Array.isArray(response) ? response : []);
    assert.equal(actual.observation, f.deps.selectedPiece.current); assert.equal(actual.capture, f.capture); assert.equal(actual.attempt, 0);
    await settle(); assert.equal(f.requests.length, 1); assert.equal(f.deps.tareasRetry, 0);
    assert.equal(f.requests[0].url, '/api/publicaciones/5/tareas'); assert.equal(f.requests[0].options.cache, 'no-store');
    cleanup(); assert.equal(f.requests[0].options.signal.aborted, true);
  }
});
test('linked-task derived read hides old data before effects for selection ABA, capture replacement and retry attempt', async () => {
  for (const change of ['selection', 'aba', 'capture', 'attempt']) {
    const f = calendarFixture(async () => [{ id: 7 }]);
    const cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)(); await settle();
    assert.equal(readLinkedTasks(f).status, 'ready');
    if (change === 'capture') f.deps.capture = () => f.capture();
    else if (change === 'attempt') f.deps.tareasRetry++;
    else { f.select({ id: 6 }, null); if (change === 'aba') f.select(f.a, f.day); }
    assert.deepEqual(readLinkedTasks(f), { status: 'loading', items: [] });
    assert.equal(f.requests.length, 1, 'render-owned projection does not dispatch'); cleanup();
  }
});
test('linked-task retry is explicit, owner-bound and GET-only; each attempt starts loading and may recover', async () => {
  const f = calendarFixture(async () => { if (f.requests.length === 1) throw Error('offline'); return [{ id: 8 }]; });
  let cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)(); await settle();
  assert.equal(readLinkedTasks(f).status, 'error'); retryLinkedTasks(f);
  assert.equal(f.deps.tareasRetry, 1); assert.equal(f.requests.length, 1, 'callback schedules state, not transport');
  assert.deepEqual(readLinkedTasks(f), { status: 'loading', items: [] });
  retryLinkedTasks(f); assert.equal(f.deps.tareasRetry, 1, 'old error cannot authorize another attempt');
  cleanup(); cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)();
  assert.equal(readLinkedTasks(f).status, 'loading'); await settle();
  assert.equal(readLinkedTasks(f).status, 'ready'); assert.deepEqual(readLinkedTasks(f).items, [{ id: 8 }]);
  retryLinkedTasks(f); assert.equal(f.deps.tareasRetry, 1);
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.url === '/api/publicaciones/5/tareas' && !r.options.method)); cleanup();
});
test('linked-task retry rejects null/loading/ready, foreign observation/capture/attempt and revoked or unmounted owners', async () => {
  for (const change of ['null', 'loading', 'ready', 'selection', 'aba', 'capture', 'attempt', 'switch', 'unmount']) {
    const f = calendarFixture(async () => { throw Error('offline'); });
    const cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)(); await settle();
    if (change === 'null') f.deps.tareasLectura = null;
    else if (['loading', 'ready'].includes(change)) f.deps.tareasLectura = { ...f.deps.tareasLectura, status: change };
    else if (change === 'capture') f.deps.capture = () => f.capture();
    else if (change === 'attempt') f.deps.tareasRetry++;
    else if (change === 'switch' || change === 'unmount') f[change]();
    else { f.select({ id: 6 }, null); if (change === 'aba') f.select(f.a, f.day); }
    const before = f.deps.tareasRetry; retryLinkedTasks(f); assert.equal(f.deps.tareasRetry, before, change);
    assert.equal(f.requests.length, 1); cleanup();
  }
});
test('retained retry handler cannot reuse an old attempt, capture or read even on the same selected piece', async () => {
  for (const change of ['attempt', 'capture', 'read']) {
    const f = calendarFixture(async () => { throw Error('offline'); });
    const cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)(); await settle();
    const retained = callback(cal, 'reintentarTareas', f.deps);
    if (change === 'attempt') f.deps.tareasRetry++;
    else if (change === 'capture') f.deps.capture = () => f.capture();
    else f.deps.tareasLectura = { ...f.deps.tareasLectura };
    f.syncTasks(); const before = [...f.effects], attempt = f.deps.tareasRetry;
    retained(); await settle();
    assert.equal(f.deps.tareasRetry, attempt, change); assert.deepEqual(f.effects, before, change);
    assert.equal(f.requests.length, 1, change); cleanup();
  }
});
test('render replacement of task attempt/capture fences held GET before passive cleanup', async () => {
  for (const change of ['attempt', 'capture']) for (const fail of [false, true]) {
    const pending = deferred(), f = calendarFixture(() => pending.promise);
    const cleanup = evaluate(linkedTasksEffect().arguments[0], f.deps)(); const before = [...f.effects];
    if (change === 'attempt') f.deps.tareasRetry++;
    else f.deps.capture = () => f.capture();
    f.syncTasks();
    if (fail) pending.reject(Error('old')); else pending.resolve([{ id: 7 }]);
    await settle(); assert.deepEqual(f.effects, before); assert.equal(f.requests.length, 1); cleanup();
  }
});
test('sheet captures cookie/bearer body before queue and serializes slow-first then latest, without duplicate adjacent dispatch', async () => {
  for (const cookie of [false, true]) {
    const first = deferred(), persisted = [];
    const f = sheetFixture(async (_url, options) => { const body = JSON.parse(options.body); if (!persisted.length) { persisted.push('started-A'); await first.promise; } persisted.push(body.copy); return {}; }, cookie);
    const body = { copy: 'A' }, a = f.deps.guardarEnServidor(5, body); body.copy = 'mutated'; await settle();
    const b = f.deps.guardarEnServidor(5, { copy: 'B' }), duplicate = f.deps.guardarEnServidor(5, { copy: 'B' });
    await settle(); assert.equal(f.requests.length, 1); first.resolve(); await Promise.all([a, b, duplicate]);
    assert.deepEqual(persisted, ['started-A', 'A', 'B']); assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].url, '/api/publicaciones/5');
    if (cookie) assert.equal(f.requests[1].options.sessionIntent.session, f.original);
    else assert.equal(f.requests[1].options.headers.Authorization, 'Bearer a');
  }
});
test('sheet A→B→A pending queue preserves final A rather than deduplicating against old pending A', async () => {
  const first = deferred(); let number = 0; const persisted = [];
  const f = sheetFixture(async (_url, options) => { if (++number === 1) await first.promise; persisted.push(JSON.parse(options.body).idea); return {}; });
  const a = f.deps.guardarEnServidor(5, { idea: 'A' }); await settle();
  const b = f.deps.guardarEnServidor(5, { idea: 'B' }), finalA = f.deps.guardarEnServidor(5, { idea: 'A' });
  first.resolve(); await Promise.all([a, b, finalA]); assert.deepEqual(persisted, ['A', 'B', 'A']);
});
test('queued sheet edits do not dispatch under B or after unmount; late errors never paint or retry', async () => {
  for (const change of ['switch', 'unmount']) for (const fail of [false, true]) {
    const pending = deferred(), f = sheetFixture(() => pending.promise);
    const a = f.deps.guardarEnServidor(5, { copy: 'A' }); await settle(); const b = f.deps.guardarEnServidor(5, { copy: 'B' });
    f[change](); if (fail) pending.reject(Error('old A')); else pending.resolve({});
    await Promise.all([a, b]); assert.equal(f.requests.length, 1); assert.deepEqual(f.effects, []);
  }
  const f = sheetFixture(async () => ({})); const a = f.deps.guardarEnServidor(5, { idea: 'queued' }); f.switch(); await a;
  assert.equal(f.requests.length, 0);
});
test('archive refuses pending row writes and its lock blocks PATCH; creation cannot duplicate while pending', async () => {
  const pending = deferred(), f = sheetFixture(() => pending.promise);
  const patch = f.deps.guardarEnServidor(5, { idea: 'A' }); await settle(); assert.equal(f.deps.canArchivePublication({ id: 5 }), false);
  assert.equal(f.requests.length, 1); pending.resolve({}); await patch;
  const d = sheetFixture(async () => assert.fail('No PATCH while archive is unresolved'));
  d.deps.archivePublicationLock(5, true); await d.deps.guardarEnServidor(5, { copy: 'blocked' }); assert.equal(d.requests.length, 0);
  d.deps.archivePublicationLock(5, false); assert.equal(d.deps.pendingWrites.current.size, 0);
  const create = deferred(), c = sheetFixture(() => create.promise);
  const created = c.deps.crearPublicacion(); await c.deps.crearPublicacion(); assert.equal(c.requests.length, 1);
  c.switch(); create.resolve({ id: 9 }); await created; assert.equal(c.requests.length, 1); assert.equal(c.deps.enfocarProximoId.current, null);
});
test('calendar A response never closes newly selected B or the ABA observation, but may update collection', async () => {
  for (const aba of [false, true]) for (const action of ['cambiarFecha', 'cambiarEstadoPublicacion']) {
    const pending = deferred(), f = calendarFixture(() => pending.promise);
    const result = f.deps[action](f.a, action === 'cambiarFecha' ? '2026-10-21' : 'lista');
    const b = { id: 6 }, dayB = { fecha: '2026-10-22', items: [b] };
    f.select(b, dayB); if (aba) f.select(f.a, f.day);
    pending.resolve({ ...f.a, estado: 'lista', fecha_programada: '2026-10-21', publicacion_evidencia: { revision: 1 } }); await result;
    assert.equal(f.piece, aba ? f.a : b); assert.equal(f.selectedDay, aba ? f.day : dayB);
    assert.ok(f.effects.some(([key]) => key === 'rows'));
  }
});
test('period/client context ABA permanently invalidates old scope, including calendar or sheet pending response', async () => {
  for (const kind of ['calendar', 'sheet']) {
    const pending = deferred(), f = kind === 'calendar' ? calendarFixture(() => pending.promise) : sheetFixture(() => pending.promise);
    const result = kind === 'calendar' ? f.deps.cambiarFecha(f.a, '2026-10-21') : f.deps.crearPublicacion();
    const initial = [...f.effects]; f.render('period-B'); f.render('period-A');
    pending.resolve({ id: 9, tipo: 'video' }); await result;
    assert.deepEqual(f.effects, kind === 'calendar' ? [...initial, ['saving', null]] : initial); assert.equal(f.requests.length, 1);
  }
});
test('pending generation settled after month change releases only its owned busy state, never old data/errors or follow-up GET', async () => {
  for (const cookie of [false, true]) for (const fail of [false, true]) {
    const pending = deferred(), f = calendarFixture(() => pending.promise, cookie);
    const result = f.deps.actualizarCalendario();
    assert.equal(f.deps.generating.current, true);
    const initial = [...f.effects]; f.render('period-B');
    if (fail) pending.reject(Error('old month failed')); else pending.resolve({ generated: 1 });
    await result;
    assert.equal(f.deps.generating.current, false);
    assert.deepEqual(f.effects, [...initial, ['generating', false]]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, '/api/calendario-editorial/generar');
  }
});
test('date/state busy releases on month change, but old row completion never clears a newer row busy owner', async () => {
  for (const action of ['cambiarFecha', 'cambiarEstadoPublicacion']) for (const fail of [false, true]) {
    const pending = deferred(), f = calendarFixture(() => pending.promise);
    const result = f.deps[action](f.a, action === 'cambiarFecha' ? '2026-10-21' : 'lista');
    assert.equal(f.saving, 5); const initial = [...f.effects]; f.render('period-B');
    if (fail) pending.reject(Error('old row failed')); else pending.resolve({ ...f.a });
    await result; assert.equal(f.saving, null);
    assert.deepEqual(f.effects, [...initial, ['saving', null]]); assert.equal(f.requests.length, 1);
  }
  const first = deferred(), second = deferred();
  const f = calendarFixture(url => url.endsWith('/5') ? first.promise : second.promise);
  const a = f.deps.cambiarFecha(f.a, '2026-10-21');
  const next = f.render('period-B');
  const changeInNextMonth = callback(cal, 'cambiarFecha', { ...f.deps, ...next });
  const b = changeInNextMonth({ id: 6, tipo: 'video', publicacion_evidencia: { revision: 0 } }, '2026-11-21');
  assert.equal(f.saving, 6); first.resolve({ ...f.a }); await a; assert.equal(f.saving, 6);
  second.resolve({ id: 6, tipo: 'video' }); await b; assert.equal(f.saving, null);
});
test('calendar date/state/generation late A→B responses never paint, retry or refetch', async () => {
  for (const action of ['cambiarFecha', 'cambiarEstadoPublicacion', 'actualizarCalendario']) for (const fail of [false, true]) {
    const pending = deferred(), f = calendarFixture(() => pending.promise);
    const result = action === 'actualizarCalendario' ? f.deps[action]() : f.deps[action](f.a, action === 'cambiarFecha' ? '2026-10-21' : 'lista');
    const initial = [...f.effects]; f.switch(); if (fail) pending.reject(Object.assign(Error('old'), { status: 409 })); else pending.resolve({ ...f.a });
    await result; assert.deepEqual(f.effects, initial); assert.equal(f.requests.length, 1);
  }
});
test('linked-task callback retains canonical URL; new piece, ABA, cleanup or session change suppresses stale response', async () => {
  const effect = nodes(owner(cal), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('/tareas`'));
  assert.ok(effect); assert.match(source, /\/workspace\/tareas\?task=\$\{tarea.id\}/);
  for (const change of ['selection', 'aba', 'cleanup', 'switch']) for (const fail of [false, true]) {
    const pending = deferred(), f = calendarFixture(() => pending.promise);
    const cleanup = evaluate(effect.arguments[0], f.deps)(); const initial = [...f.effects];
    if (change === 'cleanup') cleanup(); else if (change === 'switch') f.switch();
    else { f.select({ id: 6 }, null); if (change === 'aba') f.select(f.a, f.day); }
    if (fail) pending.reject(Error('old')); else pending.resolve([{ id: 7 }]); await settle();
    assert.deepEqual(f.effects, initial); assert.equal(f.requests[0].url, '/api/publicaciones/5/tareas'); assert.equal(f.requests[0].options.cache, 'no-store'); cleanup();
  }
});
test('all four list/page loaders fence late success/error after identity replacement and unmount', async () => {
  for (const change of ['switch', 'unmount']) for (const fail of [false, true]) {
    for (const kind of ['calendar', 'sheet', 'general', 'clients', 'overview']) {
      const pending = deferred(), f = kind === 'calendar' ? calendarFixture(() => pending.promise) : sheetFixture(() => pending.promise);
      let result, cleanup;
      if (kind === 'calendar') result = f.deps.cargarPublicaciones();
      else if (kind === 'sheet') result = f.deps.cargar();
      else {
        const name = kind === 'general' ? 'PublicacionesGeneralTab' : 'PublicacionesPage';
        const needle = kind === 'clients' ? 'scope.request("/api/clientes"' : 'scope.request("/api/publicaciones"';
        const effect = nodes(owner(name), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes(needle));
        cleanup = evaluate(effect.arguments[0], { ...f.deps, setClientes: v => f.effects.push(['clients', v]), setClienteSeleccionado: v => f.effects.push(['client', v]), setErrorClientes: v => f.effects.push(['error', v]) })();
      }
      const initial = [...f.effects]; f[change](); if (fail) pending.reject(Error('old')); else pending.resolve([{ id: 5, cliente_id: 2 }]);
      await result; await settle(); assert.deepEqual(f.effects, initial, kind); cleanup?.();
    }
  }
});
test('current session failure never retries; publication state/evidence and parsed creation contract remain unchanged', async () => {
  const f = sheetFixture(async () => { throw Object.assign(Error('private'), { name: 'ApplicationSessionError', status: 409 }); });
  await f.deps.guardarEnServidor(5, { copy: 'A' }); assert.equal(f.requests.length, 1);
  assert.deepEqual(f.effects, [['error', editorialPatchError({ status: 409 })]]);
  const c = calendarFixture(async () => ({})); await c.deps.cambiarEstadoPublicacion(c.a, 'publicada'); assert.equal(c.requests.length, 0);
  assert.match(source, /nuevoEstado === 'publicada' \|\| isConfirmedPublication\(publicacion\) \|\| view.role !== 'admin'/);
  assert.match(source, /editorialFields\(publicaciones.find\(p => p.id === id\), campos, view.role === 'admin'\)/);
  assert.doesNotMatch(source, /responsable: "Augusto"/); assert.match(source, /responsable_id: responsableId/); assert.match(source, /tipo: "video"/);
  assert.equal((source.match(/sesion=\{view.session\}/g) || []).length, 6);
  for (const name of [cal, sheet, 'PublicacionesGeneralTab', 'PublicacionesPage']) {
    assert.match(text(init(name, 'publicationSaved')), /mergeEditorialStatus\(row, dto\)/);
    const value = callback(name, 'publicationSaved', { capture: f.capture, setPublicaciones: () => assert.fail('stale callback'), setPiezas: () => assert.fail('stale callback'), setPiezaSel: () => assert.fail('stale callback'), setDiaSel: () => assert.fail('stale callback') });
    f.switch(); value({});
  }
});

const publicationAck = (body, replayed = false) => ({ id: 31, cliente_id: 2, tipo: 'video', idea: 'Current server idea',
  publicacion_evidencia: { revision: replayed ? 9 : 0 },
  creation: { request_id: JSON.parse(body).request_id, dominio: 'publicacion', pieza_id: 31, tarea_id: 32, replayed } });
test('publication lost ACK only explicit verification resends frozen ID/body; catalog ID replaces hardcoded name', async () => {
  let posts = 0, saved;
  const f = sheetFixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') { if (++posts === 1) throw Error('lost ACK'); saved = publicationAck(options.body, true); return saved; }
    assert.equal(url, '/api/publicaciones'); return [saved];
  });
  await f.deps.crearPublicacion(); assert.equal(f.deps.creation.current.model.snapshot.phase, 'uncertain');
  await f.deps.crearPublicacion(); assert.equal(posts, 1);
  await f.deps.crearPublicacion(true); assert.equal(posts, 2); assert.deepEqual(f.rows, [saved]);
  const writes = f.requests.filter(row => row.options.method === 'POST');
  assert.equal(writes[0].options.body, writes[1].options.body);
  const body = JSON.parse(writes[0].options.body); assert.equal(body.responsable_id, 9); assert.equal(body.responsable, undefined);
  assert.match(body.request_id, /^[0-9a-f-]{36}$/); assert.equal(f.deps.creation.current.model.snapshot.locked, false);
  assert.ok(f.effects.some(([key, value]) => key === 'error' && /ya creada/.test(value)));
});
test('publication ACK then failed list read stays locked; verification retries only GET and deduplicates saved ID', async () => {
  let reads = 0, posts = 0, saved;
  const f = sheetFixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') { posts++; saved = publicationAck(options.body); return saved; }
    if (++reads === 1) throw Error('read failed'); return [saved];
  });
  await f.deps.crearPublicacion(); assert.equal(posts, 1); assert.equal(f.rows.length, 1);
  assert.equal(f.deps.creation.current.model.snapshot.phase, 'confirmed');
  await f.deps.crearPublicacion(); assert.equal(posts, 1);
  await f.deps.crearPublicacion(true); assert.equal(posts, 1); assert.equal(reads, 2); assert.equal(f.rows.length, 1);
  assert.equal(f.deps.creation.current.model.snapshot.locked, false);
});
test('actual row responsible select preserves catalog and historical labels without fabricating Augusto', () => {
  const select = nodes(owner(sheet), n => ts.isJsxElement(n) && text(n.openingElement.tagName) === 'select')
    .find(n => n.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && text(p.name) === 'value' && text(p.initializer).includes('p.responsable')));
  assert.ok(select);
  const value = select.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && text(p.name) === 'value').initializer.expression;
  for (const name of ['Luciano QA', 'Historical person', '', undefined]) {
    assert.equal(evaluate(value, { p: { responsable: name } }), name || '');
  }
  assert.match(text(select), /<option value="">Sin responsable<\/option>/);
  assert.match(text(select), /responsables.map/); assert.match(text(select), /value=\{person.nombre\}/);
  assert.match(text(select), /<option value=\{p.responsable\}>\{p.responsable\}<\/option>/);
  const condition = nodes(select, n => ts.isBinaryExpression(n) && ts.isJsxElement(n.right))[0];
  assert.equal(evaluate(condition.left, { p: { responsable: 'Luciano QA' }, responsables: [{ id: 91003, nombre: 'Luciano QA' }] }), false);
  assert.equal(evaluate(condition.left, { p: { responsable: 'Historical person' }, responsables: [{ id: 91003, nombre: 'Luciano QA' }] }), true);
  assert.doesNotMatch(text(select), /Augusto|RESPONSABLES_EQUIPO|responsable_id/);
  assert.match(text(select), /responsable: e.target.value/);
  assert.match(text(select), /Responsable de la pieza. Para reasignar el trabajo, abrí la tarea vinculada/);
});

function connectOverview(f) {
  let rows = [];
  const deps = { ...f.deps, setPublicaciones: update => { rows = typeof update === 'function' ? update(rows) : update; } };
  const snapshot = callback('PublicacionesPage', 'overviewSnapshotLoaded', deps);
  const committed = callback('PublicacionesPage', 'overviewCommittedChange', deps);
  Object.assign(f.deps, { onSnapshotLoaded: snapshot, onCommittedChange: committed });
  f.deps.cargar = callback(sheet, 'cargar', f.deps);
  for (const name of ['guardarEnServidor', 'crearPublicacion', 'canArchivePublication', 'archivePublicationLock', 'archivePublicationSaved']) f.deps[name] = callback(sheet, name, f.deps);
  const initial = nodes(owner('PublicacionesPage'), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect')
    .find(n => text(n.arguments[0]).includes('scope.request("/api/publicaciones"'));
  return { snapshot, committed, initial: () => evaluate(initial.arguments[0], deps)(), get rows() { return rows; } };
}
test('child confirmed create/read updates overview once; delayed initial root GET cannot erase committed row', async () => {
  const root = deferred(); let reads = 0, saved;
  const f = sheetFixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') return saved = publicationAck(options.body);
    if (++reads === 1) return root.promise;
    return [saved, { id: 99, cliente_id: 3, fecha_programada: '2026-10-20' }];
  });
  const overview = connectOverview(f), cleanup = overview.initial();
  await f.deps.crearPublicacion();
  assert.equal(overview.rows.filter(row => row.cliente_id === 2).length, 1);
  assert.equal(overview.rows.length, 2, 'Full snapshot, not just the child filtered client');
  root.resolve([]); await settle(); assert.equal(overview.rows.length, 2); cleanup();
});
test('overview receives only confirmed PATCH/archive; a failed PATCH and local date draft never move counters', async () => {
  let fail = true;
  const original = { id: 5, cliente_id: 2, estado: 'pendiente', fecha_programada: '2026-10-20', publicacion_evidencia: { revision: 0 } };
  const saved = { ...original, fecha_programada: '2026-11-20', publicacion_evidencia: { revision: 1 } };
  const f = sheetFixture(async (_url, options) => {
    if (!options.method) return [];
    if (fail) throw Object.assign(Error('stale'), { status: 409 }); return saved;
  });
  const overview = connectOverview(f); overview.snapshot([original]);
  const local = callback(sheet, 'actualizarLocal', f.deps);
  local(5, { fecha_programada: '2026-11-20' }); assert.deepEqual(overview.rows, [original]);
  await f.deps.guardarEnServidor(5, { fecha_programada: '2026-11-20' }); assert.deepEqual(overview.rows, [original]);
  fail = false; await f.deps.guardarEnServidor(5, { fecha_programada: '2026-11-20' }); await settle();
  assert.deepEqual(overview.rows, [saved]);
  assert.equal(overview.rows.filter(row => row.fecha_programada.startsWith('2026-10')).length, 0);
  await f.deps.archivePublicationSaved({ piece: { id: 5, dominio: 'publicacion', archived: true } }, f.capture()); assert.deepEqual(overview.rows, []);
});
test('older child list cannot overwrite its newer create snapshot or parent overview; obsolete scope cannot notify parent', async () => {
  const old = deferred(); let reads = 0, saved;
  const f = sheetFixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') return saved = publicationAck(options.body);
    if (++reads === 1) return old.promise; return [saved];
  });
  const overview = connectOverview(f), initial = f.deps.cargar();
  await f.deps.crearPublicacion(); old.resolve([]); await initial;
  assert.deepEqual(overview.rows, [saved]); assert.deepEqual(f.rows, [saved]);
  f.switch(); overview.snapshot([]); overview.committed({ deletedId: saved.id }); assert.deepEqual(overview.rows, [saved]);
});
test('publication archive gates current admin and replay CURRENT active state reloads without removing row or using DELETE', async () => {
  const current = { id: 5, cliente_id: 2, copy: 'Current operational row', publicacion_evidencia: { revision: 4 } };
  const f = sheetFixture(async () => [current]), overview = connectOverview(f); overview.snapshot([current]);
  const staff = callback(sheet, 'canArchivePublication', { ...f.deps, view: { role: 'edicion' } }); assert.equal(staff(current), false);
  await f.deps.archivePublicationSaved({ piece: { id: 5, dominio: 'publicacion', archived: false } }, f.capture());
  assert.deepEqual(f.rows, [current]); assert.deepEqual(overview.rows, [current]); assert.equal(f.requests.length, 1);
  const deny = callback(sheet, 'archivePublicationSaved', { ...f.deps, view: { role: 'edicion' } });
  await assert.rejects(deny({ piece: { id: 5, dominio: 'publicacion', archived: true } }, f.capture())); assert.equal(f.requests.length, 1);
  const scope = f.capture(); f.switch(); await assert.rejects(f.deps.archivePublicationSaved({ piece: { id: 5, dominio: 'publicacion', archived: true } }, scope));
  assert.equal(f.requests.length, 1); assert.deepEqual(overview.rows, [current]);
  assert.doesNotMatch(source, /method: "DELETE"|borrarPublicacion/); assert.match(source, /<EditorialArchivePanel dominio="publicacion"/);
});
for (const operation of ['PATCH', 'archive', 'confirmation']) for (const reject of [false, true]) {
  test(`held GET then ${operation} ACK and GET ${reject ? 'reject' : 'resolve'} preserves committed state and releases loading`, async () => {
    const held = deferred();
    const original = { id: 5, cliente_id: 2, estado: 'pendiente', fecha_programada: '2026-10-20', publicacion_evidencia: { revision: 0 } };
    const saved = { ...original, estado: 'lista', publicacion_evidencia: { revision: 1 } };
    let reads = 0;
    const f = sheetFixture(async (_url, options) => options.method === 'PATCH' ? saved : ++reads === 1 ? held.promise : []);
    const overview = connectOverview(f); overview.snapshot([original]); f.deps.setPublicaciones([original]);
    const read = f.deps.cargar();
    assert.equal(f.effects.at(-1)[0], 'loading'); assert.equal(f.effects.at(-1)[1], true);
    if (operation === 'PATCH') await f.deps.guardarEnServidor(5, { estado: 'lista' });
    else if (operation === 'archive') await f.deps.archivePublicationSaved({ piece: { id: 5, dominio: 'publicacion', archived: true } }, f.capture());
    else {
      const confirmed = { ...saved, estado: 'publicada' };
      const notify = callback(sheet, 'publicationSaved', { ...f.deps,
        mergeEditorialStatus: () => confirmed,
        onPublicationSaved: () => overview.committed({ row: confirmed }),
      });
      notify({ piece: { id: 5 } });
    }
    const expectedRows = [...f.rows], expectedOverview = [...overview.rows];
    const errors = f.effects.filter(([key]) => key === 'error');
    if (reject) held.reject(Error('obsolete read failed')); else held.resolve([original]);
    await read;
    assert.deepEqual(f.rows, expectedRows); assert.deepEqual(overview.rows, expectedOverview);
    assert.deepEqual(f.effects.filter(([key]) => key === 'error'), errors);
    assert.deepEqual(f.effects.filter(([key]) => key === 'loading'), operation === 'archive' ? [['loading', true], ['loading', true], ['loading', false]] : [['loading', true], ['loading', false]]);
    assert.equal(f.deps.loadingGeneration.current, operation === 'archive' ? 2 : 1, 'Only reads take loading ownership, not the ACK itself');
  });
}
for (const reject of [false, true]) test(`older GET ${reject ? 'rejection' : 'success'} finally cannot clear newer GET loading`, async () => {
  const old = deferred(), next = deferred(); let reads = 0;
  const f = sheetFixture(() => ++reads === 1 ? old.promise : next.promise);
  const first = f.deps.cargar(), second = f.deps.cargar();
  if (reject) old.reject(Error('old failure')); else old.resolve([]); await first;
  assert.deepEqual(f.effects.filter(([key]) => key === 'loading'), [['loading', true], ['loading', true]]);
  next.resolve([{ id: 6, cliente_id: 2 }]); await second;
  assert.deepEqual(f.effects.filter(([key]) => key === 'loading'), [['loading', true], ['loading', true], ['loading', false]]);
  assert.deepEqual(f.rows, [{ id: 6, cliente_id: 2 }]);
});
