import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';
import { editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError } from '../shared/editorial/editorial-patch.js';
import { createEditorialCreateIntent } from '../shared/editorial/editorial-create-intent.js';

// Actual hook logic/callbacks with injected effects, not a mounted React/HTTP claim.
const source = readFileSync(new URL('./Historias.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Historias.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
const nodes = (root, predicate) => { const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result; };
const owner = name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const init = (name, key) => nodes(owner(name), n => ts.isVariableDeclaration(n) && text(n.name) === key)[0].initializer;
const run = (node, deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
const callback = (name, key, deps) => { const value = init(name, key); return run(ts.isCallExpression(value) && text(value.expression) === 'useCallback' ? value.arguments[0] : value, deps); };
const pure = name => run(owner(name), {});
const storyArray = pure('storyArray'), createdStory = pure('createdStory'), enqueueStoryWrite = pure('enqueueStoryWrite'), storyDuplicationMetadata = pure('storyDuplicationMetadata');
const page = 'HistoriasPage', checklist = 'HistoriasChecklistPublicadasTab';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
function sessionFixture(request, cookie = true) {
  const store = createBrowserSessionState(), refs = [], requests = [];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  if (cookie) accept(7);
  let session = cookie ? store.getSession() : { token: 'a', usuario: { id: 7, rol: 'admin', activo: true } };
  const original = session; let view = createSessionView(sessionViewInputs(session)), index = 0, effect;
  const hook = run(owner('useStorySession'), { useSessionView: () => view, getSesion: () => session, useRef: value => refs[index++] ||= { current: value },
    useLayoutEffect: value => { effect ||= value; }, useCallback: fn => fn, createCapturedRequest,
    apiRequest: (url, options) => { requests.push({ url, options }); return request(url, options); } });
  const render = context => { index = 0; return hook(context); };
  assert.equal(render('A').capture().current(), false); const cleanup = effect(); const first = render('A');
  return { ...first, original, requests, render, unmount: () => cleanup(),
    switch() { if (cookie) { accept(8); session = store.getSession(); } else session = { token: 'b', usuario: { id: 8, rol: 'admin', activo: true } }; view = createSessionView(sessionViewInputs(session)); render('A'); } };
}
function fixture(request, cookie = true) {
  const f = sessionFixture(async (url, options) => {
    const value = await request(url, options);
    if (url === '/api/editorial-creaciones' && Number.isSafeInteger(value?.id)) {
      // Adapt legacy fixture ACKs to the actual receipt contract, never IDs.
      Object.assign(value, { publicacion_evidencia: value.publicacion_evidencia || { revision: 0 },
        creation: value.creation || { request_id: JSON.parse(options.body).request_id, dominio: 'historia', pieza_id: value.id, tarea_id: 17, replayed: false } });
    }
    return value;
  }, cookie), effects = []; let rows = [], busy = null;
  const deps = { capture: f.capture, captureLifetime: f.captureLifetime, view: f.view, isSessionFailure, storyArray, createdStory, enqueueStoryWrite, storyDuplicationMetadata,
    editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError,
    historias: [{ id: 5, publicacion_evidencia: { revision: 0 } }],
    creation: { current: { model: createEditorialCreateIntent({ capture: f.capture, randomUUID: () => '11111111-1111-4111-8111-111111111111' }) } }, renderCreation() {},
    writeQueues: { current: new Map() }, latestWrites: { current: new Map() }, creationLocks: { current: new Set() }, deleting: { current: new Set() }, listGeneration: { current: 0 },
    responsablesReady: true, responsableNuevoId: '9', responsables: [{ id: 9, nombre: 'Alex', activo: true }, { id: 10, nombre: 'Alex', activo: true }],
    estructura: [{ cliente_id: 2, dia_semana: 2, tema: 'Tema real', horario: '10:30' }],
    vista: 'planilla', filtroClientePlanilla: '2', clientes: [{ id: 2 }], clienteSeleccionado: 2, year: 2026, month: 9,
    getHoyLocalISO: () => '2026-10-20', window: { confirm: () => true },
    setHistorias: value => { rows = typeof value === 'function' ? value(rows) : value; effects.push(['rows', rows]); },
    setErrorHistorias: value => effects.push(['error', value]), setUltimoIdCreado: value => effects.push(['focus', value]),
    setCargandoHistorias: value => effects.push(['loading', value]),
    setGuardandoId: value => { busy = typeof value === 'function' ? value(busy) : value; effects.push(['busy', busy]); },
    pendingChecks: { current: new Set() }, setChecks: value => effects.push(['checks', value]), setError: value => effects.push(['error', value]) };
  for (const key of ['newStoryResponsibleId', 'cargarHistorias', 'guardarHistoriaEnServidor', 'crearHistoria', 'agregarHistoriaEnMesActual', 'duplicarHistoria', 'verificarCreacionHistoria', 'eliminarHistoria']) deps[key] = callback(page, key, deps);
  return { ...f, deps, effects, get rows() { return rows; }, get busy() { return busy; } };
}

test('whole file delegates parsed requests with exact session DTO; layout lifetime, context epoch and scoped cleanup are separate', () => {
  assert.equal(file.parseDiagnostics.length, 0); assert.doesNotMatch(source, /fetch\(|\.json\(|Authorization|\.token|responsable: "Augusto"/);
  const hook = text(owner('useStorySession')); assert.match(hook, /useSessionView\(getSesion\(\)\)/);
  assert.match(hook, /session: view.session, readSession: getSesion, request: apiRequest/);
  assert.match(hook, /useLayoutEffect/); assert.match(hook, /live.current === observation/); assert.match(hook, /live.current.view === view/);
  assert.match(source, /const contextKey = `\$\{vista\}:\$\{clienteSeleccionado\}:\$\{filtroClientePlanilla\}:\$\{year\}:\$\{month\}`/);
  assert.equal((source.match(/sesion=\{view.session\}/g) || []).length, 2);
});
test('story queue preserves ordered rapid A→B→A and only deduplicates adjacent live intents', async () => {
  for (const cookie of [false, true]) {
    const pending = deferred(), persisted = []; let count = 0;
    const f = fixture(async (_url, options) => { if (++count === 1) await pending.promise; persisted.push(JSON.parse(options.body).copy); return { id: 5 }; }, cookie);
    const body = { copy: 'A' }, a = f.deps.guardarHistoriaEnServidor(5, body); body.copy = 'mutated'; await settle();
    const b = f.deps.guardarHistoriaEnServidor(5, { copy: 'B' }), a2 = f.deps.guardarHistoriaEnServidor(5, { copy: 'A' }), duplicate = f.deps.guardarHistoriaEnServidor(5, { copy: 'A' });
    pending.resolve(); await Promise.all([a, b, a2, duplicate]); assert.deepEqual(persisted, ['A', 'B', 'A']);
    assert.equal(f.requests.length, 3); assert.equal(f.requests[0].url, '/api/historias/5');
    if (cookie) assert.equal(f.requests[2].options.sessionIntent.session, f.original); else assert.equal(f.requests[2].options.headers.Authorization, 'Bearer a');
  }
});
test('queued writes stop before delayed dispatch after account switch/unmount or client-month-view ABA, with no retry or late errors', async () => {
  for (const change of ['switch', 'unmount', 'context']) for (const fail of [false, true]) {
    const pending = deferred(), f = fixture(() => pending.promise);
    const a = f.deps.guardarHistoriaEnServidor(5, { copy: 'A' }); await settle(); const b = f.deps.guardarHistoriaEnServidor(5, { copy: 'B' });
    if (change === 'context') { f.render('B'); f.render('A'); } else f[change]();
    if (fail) pending.reject(Error('old private error')); else pending.resolve({ id: 5 });
    await Promise.all([a, b]); assert.equal(f.requests.length, 1); assert.deepEqual(f.effects, []);
  }
});
test('explicit catalog ID is required, preserves homonyms and sends no name/current-actor fallback', async () => {
  const f = fixture(async () => ({ id: 5 })); assert.equal(f.deps.newStoryResponsibleId(), 9);
  for (const patch of [{ responsableNuevoId: '' }, { responsablesReady: false }, { responsableNuevoId: '999' }, { responsables: [{ id: 9, activo: false }] }]) {
    const invalid = callback(page, 'newStoryResponsibleId', { ...f.deps, ...patch }); assert.throws(invalid, /Elegí un responsable válido/);
  }
  const invalid = fixture(async () => assert.fail('No POST without responsible selection'));
  invalid.deps.crearHistoria = callback(page, 'crearHistoria', { ...invalid.deps, newStoryResponsibleId: () => { throw Error('Elegí un responsable válido'); } });
  await assert.rejects(invalid.deps.crearHistoria(2, '2026-10-20')); assert.equal(invalid.requests.length, 0);
  assert.match(source, /Responsable de nuevas historias/); assert.match(source, /value=\{person.id\}/);
  assert.match(source, /No modifica las historias existentes/);
});
test('POST success then metadata PATCH500 reports created ID and only actual server fields, without repeating POST', async () => {
  const actual = { id: 5, cliente_id: 2, estado: 'pendiente', copy: 'server copy', metadata: { hora: 'server time' }, publicacion_evidencia: { revision: 0 } };
  const f = fixture(async (_url, options) => { if (options.method === 'POST') return actual; throw Object.assign(Error('patch failed'), { status: 500 }); });
  const id = await f.deps.crearHistoria(2, '2026-10-20'); assert.equal(id, 5);
  assert.equal(f.requests.length, 2); assert.deepEqual(f.requests.map(row => row.options.method), ['POST', 'PATCH']);
  assert.equal(JSON.parse(f.requests[0].options.body).responsable_id, 9); assert.equal(JSON.parse(f.requests[0].options.body).responsable, undefined);
  assert.equal(JSON.parse(f.requests[1].options.body).expected_revision, actual.publicacion_evidencia.revision);
  assert.deepEqual(f.rows, [actual]); assert.deepEqual(f.rows[0].metadata, { hora: 'server time' });
  assert.match(f.effects.find(([key]) => key === 'error')[1], /Historia #5 creada;.*no vuelvas a crearla/);
});

test('story ambiguous create recovers only on explicit verification and never applies suggested metadata on replay', async () => {
  let posts = 0, saved;
  const f = fixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') {
      if (++posts === 1) throw Error('lost ACK');
      saved = { id: 5, metadata: { tipo: 'Current edited type' }, publicacion_evidencia: { revision: 13 },
        creation: { request_id: JSON.parse(options.body).request_id, dominio: 'historia', pieza_id: 5, tarea_id: 17, replayed: true } };
      return saved;
    }
    assert.equal(url, '/api/historias'); return [saved];
  });
  await f.deps.agregarHistoriaEnMesActual(); await f.deps.agregarHistoriaEnMesActual(); assert.equal(posts, 1);
  await f.deps.verificarCreacionHistoria(); assert.equal(posts, 2); assert.deepEqual(f.rows, [saved]);
  const writes = f.requests.filter(row => row.options.method === 'POST'); assert.equal(writes[0].options.body, writes[1].options.body);
  assert.equal(f.requests.some(row => row.options.method === 'PATCH'), false);
  assert.equal(f.deps.creation.current.model.snapshot.locked, false);
});
test('duplicate replay skips copied metadata and adds a saved ID only once', async () => {
  const saved = { id: 12, metadata: { tipo: 'Current server metadata' }, publicacion_evidencia: { revision: 8 },
    creation: { request_id: '11111111-1111-4111-8111-111111111111', dominio: 'historia', pieza_id: 12, tarea_id: 17, replayed: true } };
  const f = fixture(async () => saved);
  await f.deps.duplicarHistoria({ id: 5, cliente_id: 2, fecha_programada: '2026-10-20', metadata: { tipo: 'Old copied metadata', hora: '10:00' } });
  assert.deepEqual(f.rows, [saved]); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.method, 'POST');
  assert.ok(f.effects.some(([key, value]) => key === 'error' && /no se reaplicó/.test(value)));
});
test('story accepted create plus metadata error and failed read cannot create again; recovery performs only reads', async () => {
  let posts = 0, patches = 0, reads = 0;
  const saved = { id: 5, publicacion_evidencia: { revision: 0 } };
  const current = { id: 5, metadata: { tipo: 'Saved current' }, publicacion_evidencia: { revision: 2 } };
  const f = fixture(async (url, options) => {
    if (url === '/api/editorial-creaciones') { posts++; return saved; }
    if (options.method === 'PATCH') { patches++; throw Error('lost metadata ACK'); }
    if (++reads === 1) throw Error('read failed'); return [current];
  });
  await f.deps.agregarHistoriaEnMesActual(); assert.equal(f.deps.creation.current.model.snapshot.phase, 'confirmed');
  await f.deps.verificarCreacionHistoria(); assert.equal(f.deps.creation.current.model.snapshot.locked, true);
  await f.deps.agregarHistoriaEnMesActual(); assert.equal(posts, 1);
  await f.deps.verificarCreacionHistoria(); assert.equal(posts, 1); assert.equal(patches, 1); assert.equal(reads, 2);
  assert.deepEqual(f.rows, [current]); assert.equal(f.deps.creation.current.model.snapshot.locked, false);
});
test('create chain stops follow-up PATCH and UI after B/unmount/context ABA; double add while pending never duplicates POST', async () => {
  for (const change of ['switch', 'unmount', 'context']) {
    const pending = deferred(), f = fixture(() => pending.promise);
    const first = f.deps.agregarHistoriaEnMesActual(); await f.deps.agregarHistoriaEnMesActual(); assert.equal(f.requests.length, 1);
    if (change === 'context') { f.render('B'); f.render('A'); } else f[change]();
    pending.resolve({ id: 5 }); await first; assert.equal(f.requests.length, 1); assert.deepEqual(f.effects, []);
  }
});
test('duplicate copies only business tipo/hora, never publication proof; failed second step shows actual created fields', async () => {
  const metadata = { tipo: 'Promo', hora: '11:30', publicacion_evidencia: { confirmed: true }, fecha_publicacion_real: '2026-10-20', actor: 'private' };
  const actual = { id: 12, estado: 'pendiente', metadata: {}, publicacion_evidencia: { revision: 0 } };
  const f = fixture(async (_url, options) => { if (options.method === 'POST') return actual; throw Error('metadata failed'); });
  await f.deps.duplicarHistoria({ id: 5, cliente_id: 2, fecha_programada: '2026-10-20', metadata });
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { metadata: { tipo: 'Promo', hora: '11:30' }, expected_revision: 0 });
  assert.equal(JSON.parse(f.requests[0].options.body).responsable_id, 9); assert.equal(JSON.parse(f.requests[0].options.body).estado, 'pendiente');
  assert.deepEqual(f.rows, [actual]); assert.match(f.effects.find(([key]) => key === 'error')[1], /#12 duplicada;.*No vuelvas a duplicarla/);
  assert.equal(metadata.publicacion_evidencia.confirmed, true);
});
test('same-scope metadata ACK uses actual updated row; missing/mismatched create/PATCH ACK never fabricates suggested fields', async () => {
  const updated = { id: 5, copy: 'server updated', metadata: { tipo: 'Server', hora: '12:00' }, publicacion_evidencia: { revision: 1 } };
  const good = fixture(async (_url, options) => options.method === 'POST' ? { id: 5, publicacion_evidencia: { revision: 0 } } : updated);
  assert.equal(await good.deps.crearHistoria(2, '2026-10-20'), 5); assert.deepEqual(good.rows, [{ ...updated, creation: good.rows[0].creation }]);
  assert.equal(good.rows[0].creation.pieza_id, updated.id);
  assert.equal(JSON.parse(good.requests[1].options.body).expected_revision, 0);
  const missing = fixture(async () => ({})); await assert.rejects(missing.deps.crearHistoria(2, '2026-10-20')); assert.equal(missing.requests.length, 1); assert.deepEqual(missing.rows, []);
  const wrong = fixture(async (_url, options) => options.method === 'POST' ? { id: 5, publicacion_evidencia: { revision: 0 } } : { id: 999, metadata: { tipo: 'wrong' }, publicacion_evidencia: { revision: 1 } });
  await wrong.deps.crearHistoria(2, '2026-10-20'); assert.equal(wrong.rows.length, 1); assert.equal(wrong.rows[0].id, 5); assert.deepEqual(wrong.rows[0].publicacion_evidencia, { revision: 0 }); assert.equal(wrong.rows[0].metadata, undefined); assert.ok(wrong.effects.some(([key]) => key === 'error'));
});
test('checklist remains planning-only; context-invalid success/error cleans original busy but never paints check or story publication', async () => {
  for (const fail of [false, true]) {
    const pending = deferred(), f = fixture(() => pending.promise);
    const mark = callback(checklist, 'marcarPlanificacion', f.deps);
    const result = mark(2, '2026-10-20', true); const before = [...f.effects]; f.render('B');
    if (fail) pending.reject(Error('old')); else pending.resolve({ cliente_id: 2, fecha: '2026-10-20', publicado: true });
    await result; assert.deepEqual(f.effects, [...before, ['busy', null]]); assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(f.requests[0].options.body), { cliente_id: 2, fecha: '2026-10-20', publicado: true });
  }
  const mark = text(init(checklist, 'marcarPlanificacion')); assert.doesNotMatch(mark, /PATCH|setHistorias|onHistoriasActualizadas/);
  assert.match(source, /items.filter\(isConfirmedPublication\)/);
});
test('flyer partial batch checks every response, keeps rejected records and reports IDs; no blind success or retry', async () => {
  const effects = [], f = sessionFixture(async url => { if (url.endsWith('/2')) throw Object.assign(Error('linked source'), { status: 409 }); return { id: Number(url.split('/').at(-1)) + 10 }; });
  let flyers = [{ id: 1 }, { id: 2 }, { id: 3 }], converted = [];
  const migrate = callback('FlyersMigrarBanner', 'migrarTodos', { capture: f.capture, captureLifetime: f.captureLifetime, flyers, conversionLock: { current: false }, createdStory, isSessionFailure,
    setMigrando: v => effects.push(['busy', v]), setError: v => effects.push(['error', v]), onMigrado: () => effects.push(['refresh']),
    setConverted: update => { converted = update(converted); }, setFlyers: update => { flyers = update(flyers); } });
  await migrate(); assert.deepEqual(flyers, [{ id: 2 }]); assert.deepEqual(converted, [1, 3]); assert.equal(f.requests.length, 3);
  assert.ok(effects.some(([key, value]) => key === 'error' && /#2/.test(value))); assert.equal(effects.filter(([key]) => key === 'refresh').length, 1);
});
test('flyer conversion chain cannot continue under B, unmount or context change; busy cleanup is lifetime-only', async () => {
  for (const change of ['switch', 'unmount', 'context']) {
    const pending = deferred(), effects = [], f = sessionFixture(() => pending.promise);
    const migrate = callback('FlyersMigrarBanner', 'migrarTodos', { capture: f.capture, captureLifetime: f.captureLifetime, flyers: [{ id: 1 }, { id: 2 }], conversionLock: { current: false }, createdStory, isSessionFailure,
      setMigrando: v => effects.push(['busy', v]), setError: v => effects.push(['error', v]), onMigrado: () => effects.push('refresh'), setConverted: () => effects.push('converted'), setFlyers: () => effects.push('flyers') });
    const result = migrate(); const before = [...effects]; if (change === 'context') f.render('B'); else f[change]();
    pending.resolve({ id: 11 }); await result; assert.equal(f.requests.length, 1);
    assert.deepEqual(effects, change === 'context' ? [...before, ['busy', false]] : before);
  }
});
test('all actual inventory GET effects suppress late results/errors after B or unmount, with no session-error retry', async () => {
  const cases = [['HistoriasEstructuraTab', '/api/estructura'], ['HistoriasFechasEspecialesTab', '/api/fechas-especiales'],
    ['FlyersMigrarBanner', '/api/publicaciones'], [page, '/api/clientes'], [page, '/api/usuarios'], [page, '/api/estructura'], [checklist, '/api/check-publicacion?']];
  for (const [name, url] of cases) for (const change of ['switch', 'unmount']) {
    const pending = deferred(), f = fixture(() => pending.promise), effects = [];
    const effect = nodes(owner(name), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes(`scope.request(`) && text(n.arguments[0]).includes(url));
    const deps = { ...f.deps, setCargando: v => effects.push(v), setEstructura: v => effects.push(v), setError: v => effects.push(v),
      setFechasEspeciales: v => effects.push(v), setFlyers: v => effects.push(v), setClientes: v => effects.push(v), setClienteSeleccionado: v => effects.push(v),
      setErrorClientes: v => effects.push(v), setResponsablesReady: v => effects.push(v), setResponsables: v => effects.push(v), setErrorHistorias: v => effects.push(v) };
    const cleanup = run(effect.arguments[0], deps)(); const before = [...effects]; f[change](); pending.resolve([{ id: 1 }]); await settle();
    assert.deepEqual(effects, before, name); assert.equal(f.requests.length, 1); cleanup();
  }
  const pending = deferred(), f = fixture(() => pending.promise); const result = f.deps.cargarHistorias(); const before = [...f.effects]; f.switch(); pending.reject(Object.assign(Error('private'), { name: 'ApplicationSessionError' })); await result;
  assert.deepEqual(f.effects, before); assert.equal(f.requests.length, 1);
});
test('editorial saved callbacks require exact observed row and scoped context, never apply stale metadata or manufacture proof', () => {
  for (const name of ['HistoriasPlanillaTab', checklist]) {
    const f = fixture(async () => ({})), original = { id: 5 }, observedStories = { current: [{ id: 5 }] };
    const saved = callback(name, 'publicationSaved', { capture: f.capture, observedStories, mergeEditorialStatus: () => assert.fail('Stale observation'),
      onActualizarLocal: () => assert.fail('Stale row'), onHistoriasActualizadas: () => assert.fail('Stale row') });
    saved(original, {}); observedStories.current = [original]; f.render('B'); saved(original, {});
    assert.match(text(init(name, 'publicationSaved')), /mergeEditorialStatus/);
  }
});
test('planilla has a secondary admin entry/return, exactly three primary tabs and real initial/popstate URL support', () => {
  const component = owner(page);
  const button = nodes(component, n => ts.isJsxElement(n) && text(n.openingElement.tagName) === 'button')
    .find(n => text(n).includes('Editar historias'));
  assert.ok(button); assert.match(text(button), /Volver al checklist/);
  assert.match(text(button.parent), /view.role === 'admin'/);
  assert.match(text(button), /cambiarVista\(vista === 'planilla' \? 'checklist' : 'planilla'\)/);
  const primary = nodes(component, n => ts.isJsxElement(n) && text(n.openingElement.tagName) === 'div')
    .find(n => n.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && text(p.name) === 'className' && p.initializer?.text === 'stories-view-switch'));
  assert.equal(nodes(primary, n => ts.isJsxElement(n) && text(n.openingElement.tagName) === 'button').length, 3);
  assert.doesNotMatch(text(primary), /planilla|Editar historias|Planificación/);
  const initial = nodes(component, n => ts.isVariableDeclaration(n) && text(n.name) === '[vista, setVista]')[0].initializer;
  assert.equal(run(initial, { useState: value => value, initialContext: { vista: 'planilla' } }), 'planilla');
  const restore = init(page, 'restoreContext');
  const values = [];
  run(restore, { readUrlContext: () => ({ vista: 'planilla', cliente: '2', filtro: '2' }), readMonthContext: () => ({ year: 2026, month: 9 }),
    window: { location: { search: '?vista=planilla' } }, hoyDate: new Date('2026-10-20T12:00:00Z'),
    setVista: value => values.push(value), setClienteSeleccionado: () => {}, setFiltroClientePlanilla: () => {}, setYear: () => {}, setMonth: () => {} })();
  assert.deepEqual(values, ['planilla']);
});
test('structure cell writes serialize captured bodies; stale result cannot repaint or clear a replacement identity busy', async () => {
  const pending = deferred(), f = fixture(() => pending.promise), events = [];
  const save = callback('HistoriasEstructuraTab', 'guardarTema', { ...f.deps, cellQueues: { current: new Map() }, busyOwner: { current: null },
    setGuardandoCelda: value => events.push(['busy', value]), setError: value => events.push(['error', value]), setEstructura: value => events.push(['rows', value]) });
  const first = save(2, 2, 'A', 'old'), second = save(2, 2, 'B', 'old'); await settle();
  assert.equal(f.requests.length, 1); f.switch(); const before = [...events]; pending.resolve({ cliente_id: 2, dia_semana: 2, tema: 'A' });
  await Promise.all([first, second]); assert.equal(f.requests.length, 1); assert.deepEqual(events, before);
});
test('responsible selector shows actual unknown current name or empty, never invents Augusto as fallback', () => {
  const select = nodes(owner('HistoriasPlanillaTab'), n => ts.isJsxElement(n) && text(n.openingElement.tagName) === 'select')
    .find(n => n.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && text(p.name) === 'value' && text(p.initializer).includes('h.responsable_diseño')));
  assert.ok(select);
  const value = select.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && text(p.name) === 'value').initializer.expression;
  assert.equal(text(value), 'h.responsable_diseño || h.responsable || ""');
  assert.equal(run(value, { h: { responsable_diseño: 'DesignerQA', responsable: 'Legacy' } }), 'DesignerQA');
  assert.equal(run(value, { h: { responsable: 'DesignerQA' } }), 'DesignerQA');
  assert.equal(run(value, { h: {} }), '');
  assert.match(text(select), /<option value="">Sin responsable<\/option>/);
  const conditional = nodes(select, n => ts.isBinaryExpression(n) && ts.isJsxElement(n.right))[0];
  assert.ok(conditional); assert.equal(run(conditional.left, { h: { responsable_diseño: 'DesignerQA' }, RESPONSABLES_EQUIPO: ['Augusto'] }), true);
  assert.equal(run(conditional.left, { h: { responsable: 'Augusto' }, RESPONSABLES_EQUIPO: ['Augusto'] }), false);
  const actual = conditional.right;
  assert.equal(text(actual.openingElement.attributes.properties[0].initializer.expression), 'h.responsable_diseño || h.responsable');
  assert.match(text(select), /RESPONSABLES_EQUIPO.map/);
  assert.doesNotMatch(text(select), /\|\| "Augusto"|responsable_id|dangerouslySetInnerHTML/);
});
test('actual new-row focus effect runs once per new ID/context, not again while typing or reordering visible rows', () => {
  const effect = nodes(owner('HistoriasPlanillaTab'), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect')
    .find(n => text(n.arguments[0]).includes('ultimoIdCreado'));
  const f = fixture(async () => ({})), frames = [], focused = [], lastFocusedStory = { current: null };
  const base = { capture: f.capture, lastFocusedStory, ultimoIdCreado: 5, filasVisibles: [{ id: 5, copy: '' }],
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame: () => {}, enfocarCelda: (...args) => focused.push(args) };
  const cleanup = run(effect.arguments[0], base)(); frames[0]();
  assert.deepEqual(focused, [[0, 'fecha']]); cleanup();
  for (const filasVisibles of [[{ id: 5, copy: 'Copy QA78' }], [{ id: 6 }, { id: 5, copy: 'Copy QA78 typing' }]]) {
    assert.equal(run(effect.arguments[0], { ...base, filasVisibles })(), undefined);
  }
  assert.equal(frames.length, 1); assert.deepEqual(focused, [[0, 'fecha']]);
  run(effect.arguments[0], { ...base, ultimoIdCreado: 6, filasVisibles: [{ id: 5 }, { id: 6 }] })(); frames[1]();
  assert.deepEqual(focused, [[0, 'fecha'], [1, 'fecha']]);
  const next = f.render('next-context');
  run(effect.arguments[0], { ...base, capture: next.capture })(); frames[2]();
  assert.deepEqual(focused, [[0, 'fecha'], [1, 'fecha'], [0, 'fecha']]);
});
test('new-row RAF cleanup and obsolete session/context prevent delayed focus and never consume focus acknowledgement', () => {
  const effect = nodes(owner('HistoriasPlanillaTab'), n => ts.isCallExpression(n) && text(n.expression) === 'useEffect')
    .find(n => text(n.arguments[0]).includes('ultimoIdCreado'));
  for (const change of ['cleanup', 'switch', 'unmount', 'context']) {
    const f = fixture(async () => ({})), lastFocusedStory = { current: null }; let frame; const canceled = [];
    const cleanup = run(effect.arguments[0], { capture: f.capture, lastFocusedStory, ultimoIdCreado: 5, filasVisibles: [{ id: 5 }],
      requestAnimationFrame: fn => { frame = fn; return 17; }, cancelAnimationFrame: id => canceled.push(id), enfocarCelda: () => assert.fail('No late focus') })();
    if (change === 'cleanup') cleanup(); else if (change === 'context') f.render('B'); else f[change]();
    frame(); assert.equal(lastFocusedStory.current, null);
    if (change === 'cleanup') assert.deepEqual(canceled, [17]);
  }
});
