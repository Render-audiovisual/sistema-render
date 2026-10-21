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
  const f = sessionFixture(request, cookie), effects = [];
  const deps = { capture: f.capture, view: f.view, clienteId: 2, publicaciones: [{ id: 5, estado: 'pendiente', publicacion_evidencia: { revision: 0 } }], editorialFields,
    editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError,
    pendingWrites: { current: new Set() }, writeQueues: { current: new Map() }, latestWrites: { current: new Map() }, creating: { current: false },
    listGeneration: { current: 0 }, enfocarProximoId: { current: null }, mesPrefix: '2026-10', hoyISO: '2026-10-20',
    setError: value => effects.push(['error', value]), setPublicaciones: value => effects.push(['rows', value]), setCargando: value => effects.push(['loading', value]),
    window: { confirm: () => true } };
  deps.cargar = callback(sheet, 'cargar', deps);
  for (const name of ['guardarEnServidor', 'crearPublicacion', 'borrarPublicacion']) deps[name] = callback(sheet, name, deps);
  return { ...f, deps, effects };
}
function calendarFixture(request, cookie = true) {
  const f = sessionFixture(request, cookie), effects = [], a = { id: 5, tipo: 'video', estado: 'pendiente', publicacion_evidencia: { revision: 0 } }, day = { fecha: '2026-10-20', items: [a] };
  let piece = a, selectedDay = day, saving = null;
  const selection = { current: { piece, day, year: 2026, month: 9, generation: 0 } }, selectedPiece = { current: { piece, generation: 0 } };
  const deps = { capture: f.capture, captureLifetime: f.captureLifetime, view: f.view, selection, selectedPiece, piezaSel: a, pendingWrites: { current: new Set() }, generating: { current: false },
    editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError,
    listGeneration: { current: 0 }, mesISO: '2026-10', isConfirmedPublication, getTipoPublicacionLabel: () => 'Reel',
    setActualizando: value => effects.push(['generating', value]), setError: value => effects.push(['error', value]),
    setGuardandoId: value => { saving = typeof value === 'function' ? value(saving) : value; effects.push(['saving', saving]); }, setPiezas: value => { effects.push(['rows', typeof value === 'function' ? value([a]) : value]); },
    setPiezaSel: value => { piece = typeof value === 'function' ? value(piece) : value; effects.push(['piece', piece]); },
    setDiaSel: value => { selectedDay = typeof value === 'function' ? value(selectedDay) : value; effects.push(['day', selectedDay]); },
    setTareasPieza: value => effects.push(['tasks', value]), setCargandoTareas: value => effects.push(['tasks-loading', value]) };
  deps.cargarPublicaciones = callback(cal, 'cargarPublicaciones', deps);
  for (const name of ['cambiarFecha', 'cambiarEstadoPublicacion', 'actualizarCalendario']) deps[name] = callback(cal, name, deps);
  const observationUpdates = nodes(owner(cal), n => ts.isIfStatement(n) && (text(n.expression).startsWith('selection.current.piece') || text(n.expression).startsWith('selectedPiece.current.piece')));
  const select = (nextPiece, nextDay) => {
    piece = nextPiece; selectedDay = nextDay;
    for (const n of observationUpdates) new Function('selection', 'selectedPiece', 'piezaSel', 'diaSel', 'year', 'month', text(n))(selection, selectedPiece, piece, selectedDay, 2026, 9);
  };
  return { ...f, deps, effects, a, day, select, get piece() { return piece; }, get selectedDay() { return selectedDay; }, get saving() { return saving; } };
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
test('delete refuses pending row writes; creates/deletes cannot duplicate while pending', async () => {
  const pending = deferred(), f = sheetFixture(() => pending.promise);
  const patch = f.deps.guardarEnServidor(5, { idea: 'A' }); await settle(); await f.deps.borrarPublicacion(5);
  assert.equal(f.requests.length, 1); pending.resolve({}); await patch;
  const deletion = deferred(), d = sheetFixture(() => deletion.promise);
  const first = d.deps.borrarPublicacion(5); await d.deps.borrarPublicacion(5); assert.equal(d.requests.length, 1);
  deletion.resolve({}); await first; assert.equal(d.requests[0].options.method, 'DELETE');
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
  assert.match(source, /responsable: "Augusto"/); assert.match(source, /tipo: "video"/);
  assert.equal((source.match(/sesion=\{view.session\}/g) || []).length, 6);
  for (const name of [cal, sheet, 'PublicacionesGeneralTab', 'PublicacionesPage']) {
    assert.match(text(init(name, 'publicationSaved')), /mergeEditorialStatus\(row, dto\)/);
    const value = callback(name, 'publicationSaved', { capture: f.capture, setPublicaciones: () => assert.fail('stale callback'), setPiezas: () => assert.fail('stale callback'), setPiezaSel: () => assert.fail('stale callback'), setDiaSel: () => assert.fail('stale callback') });
    f.switch(); value({});
  }
});
