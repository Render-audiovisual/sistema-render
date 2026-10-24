import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildProjectMutation, isProjectChildCreation, parseProjectChildCreation, parseProject,
  parseProjectDeliverableApproval, createProjectsTransport, projectError } from './projectsModel.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const cases = [ ['stage-create', 'etapas'], ['milestone-create', 'hitos'], ['deliverable-create', 'entregables'] ];
const source = readFileSync(new URL('./Projects.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Projects.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function callback(name, deps) {
  let found;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, name);
  const code = ts.transpileModule(found.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), `${code};return ${name}`)(...Object.values(deps));
}
function draft(kind) {
  return kind === 'stage-create' ? { titulo: 'Etapa observada', estado: 'pendiente' }
    : kind === 'milestone-create' ? { titulo: 'Hito observado', fecha: '2026-11-02', estado: 'pendiente', etapa_id: '' }
      : { titulo: 'Entrega observada', url: 'https://example.test/delivery', observaciones: 'Contenido', estado: 'en_revision' };
}
function form(kind) { return { seq: 1, kind, projectId: PROJECT, requestId: REQUEST, baseRevision: 8,
  draft: draft(kind), initial: {}, busy: false, conflict: false }; }
function project(kind, revision = 9, title = 'Actual') {
  const value = { id: PROJECT, titulo: 'Proyecto', tipo: 'web', estado: 'en_curso', revision,
    cliente: { id: 2, nombre: 'Cliente' }, responsable: { id: 1, nombre: 'QA' }, fecha_inicio: null,
    fecha_entrega: null, archivado: false, counts: { tareas: 0, finalizadas: 0, hitos: 0, entregables: 0 },
    descripcion: '', miembro_ids: [], permissions: { administrar: true, editar: true }, etapas: [], hitos: [],
    entregables: [], tareas: [], actividad: [], tareas_no_disponibles: 0 };
  if (kind === 'stage-create') value.etapas = [{ id: CHILD, titulo: title, posicion: 0, estado: 'pendiente' }];
  if (kind === 'milestone-create') { value.hitos = [{ id: CHILD, titulo: title, etapa_id: null, fecha: '2026-11-02', estado: 'pendiente' }]; value.counts.hitos = 1; }
  if (kind === 'deliverable-create') { value.entregables = [{ id: CHILD, titulo: title, url: '', observaciones: 'Actual', estado: 'pendiente', aprobado_por_id: null, aprobado_at: null }]; value.counts.entregables = 1; }
  return value;
}
function ack(kind, { replayed = false, revision = 9, title } = {}) {
  return { proyecto: project(kind, revision, title), creacion: { request_id: REQUEST, proyecto_id: PROJECT,
    recurso_tipo: cases.find(([name]) => name === kind)[1], recurso_id: CHILD, actor_id: 1, expected_revision: 8 }, replayed };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(kind) {
  const store = createBrowserSessionState();
  const publish = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, rol: 'admin', nombre: 'QA', usuario: 'qa' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  publish(1); const sesion = store.getSession(); let mounted = true, context = {}, send = async () => ack(kind);
  const heldContext = context, calls = [], effects = [], formRef = { current: form(kind) }, mutationBusy = { current: false };
  const scope = createCapturedRequest({ session: sesion, readSession: store.getSession,
    isActive: () => mounted && context === heldContext,
    request: async (url, options) => { calls.push({ url, options }); return send(url, options); } });
  formRef.current.scope = scope;
  const transport = createProjectsTransport(scope.request, { isCurrent: scope.current });
  const deps = { formRef, mutationBusy, detailReadGeneration: { current: 0 }, sesion, transport,
    buildProjectMutation, isProjectChildCreation, parseProjectChildCreation, parseProject, parseProjectDeliverableApproval, projectError,
    setForm: update => { formRef.current = typeof update === 'function' ? update(formRef.current) : update; effects.push(['form', formRef.current]); },
    setDetail: update => { effects.push(['detail', typeof update === 'function' ? update({ status: 'ready', data: project(kind, 8) }) : update]); },
    setMessage: text => effects.push(['message', text]), setListRefresh: () => effects.push(['list']),
    selectProject: () => assert.fail('Child creation must not select another project'),
    purgeProjectAccess: guard => { guard.assertCurrent(); formRef.current = null; effects.push(['purge']); } };
  return { deps, calls, effects, formRef, scope, submit: callback('submit', deps), send: fn => { send = fn; },
    replace: () => publish(2), reobserve: () => publish(1), aba: () => { context = {}; context = {}; },
    unmount: () => { mounted = false; transport.dispose(); } };
}
const event = () => ({ preventDefault() {} });

test('only the three child creations carry a generated receipt UUID plus original project revision', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const [kind, route] of cases) {
    assert.equal(isProjectChildCreation(kind), true);
    const current = form(kind), before = structuredClone(current), mutation = buildProjectMutation(current);
    assert.equal(mutation.path, `/api/proyectos/${PROJECT}/${route}`); assert.equal(mutation.method, 'POST');
    assert.equal(mutation.body.request_id, REQUEST); assert.equal(mutation.body.expected_revision, 8);
    assert.deepEqual(current, before);
    for (const requestId of [undefined, '', REQUEST + '\n', 123]) assert.throws(() => buildProjectMutation({ ...current, requestId }));
  }
  for (const kind of ['create', 'project', 'stage-edit', 'milestone-edit', 'deliverable-edit', 'deliverable-approve', 'order', '__proto__', null]) assert.equal(isProjectChildCreation(kind), false);
  const edit = buildProjectMutation({ ...form('stage-create'), kind: 'stage-edit', childId: CHILD });
  assert.equal(edit.method, 'PATCH'); assert.equal(Object.hasOwn(edit.body, 'request_id'), false);
});

for (const [kind, collection] of cases) {
  test(`${kind}: ACK binds every receipt field and resource membership; current replay content is not original content`, () => {
    const current = form(kind);
    assert.equal(parseProjectChildCreation(ack(kind), current, 1)[collection][0].id, CHILD);
    assert.throws(() => parseProjectChildCreation(ack(kind, { revision: 10 }), current, 1), 'Fresh revision jump is invalid');
    const replay = parseProjectChildCreation(ack(kind, { replayed: true, revision: 12, title: 'Editado por otro usuario' }), current, 1);
    assert.equal(replay.revision, 12); assert.equal(replay[collection][0].titulo, 'Editado por otro usuario');
    for (const change of [
      a => { a.creacion.request_id = OTHER; }, a => { a.creacion.proyecto_id = OTHER; },
      a => { a.creacion.recurso_tipo = 'otro'; }, a => { a.creacion.recurso_id = OTHER; },
      a => { a.creacion.actor_id = 2; }, a => { a.creacion.expected_revision = 9; },
      a => { a.creacion.extra = true; }, a => { delete a.creacion.actor_id; },
      a => { a.replayed = 'true'; }, a => { a.proyecto.id = OTHER; },
      a => { a.proyecto.revision = 8; }, a => { a.proyecto[collection] = []; },
    ]) { const value = ack(kind); change(value); assert.throws(() => parseProjectChildCreation(value, current, 1)); }
  });

  test(`${kind}: actual submit freezes uncertain body/UUID/revision; only explicit verify dispatches identical intent`, async () => {
    const h = harness(kind);
    h.send(async () => { throw new Error('Lost response'); });
    await h.submit(event()); assert.equal(h.calls.length, 1); assert.equal(h.formRef.current.uncertain, true);
    const frozen = h.calls[0].options.body;
    assert.equal(JSON.parse(frozen).request_id, REQUEST); assert.equal(JSON.parse(frozen).expected_revision, 8);
    await h.submit(event()); assert.equal(h.calls.length, 1);
    h.formRef.current.draft.titulo = 'Later external mutation must not rebase frozen transport';
    h.send(async () => ack(kind, { replayed: true, revision: 11, title: 'Current content' }));
    await h.submit(event(), { verify: true });
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].options.body, frozen);
    assert.ok(h.calls[0].options.sessionIntent); assert.equal(h.calls[0].options.sessionIntent, h.calls[1].options.sessionIntent);
    assert.equal(new Headers(h.calls[0].options.headers).has('Authorization'), false);
    assert.equal(h.formRef.current, null); assert.equal(h.effects.filter(([name]) => name === 'list').length, 1);
    assert.equal(h.effects.filter(([name, value]) => name === 'detail' && value.data?.revision === 11).length, 1);
  });
}

test('malformed ACK retains original UUID/body as uncertain, including fresh revision jumps', async () => {
  for (const response of [{ proyecto: project('stage-create') }, ack('stage-create', { revision: 10 })]) {
    const h = harness('stage-create'); h.send(async () => response); await h.submit(event());
    assert.equal(h.formRef.current.uncertain, true); assert.equal(h.formRef.current.requestId, REQUEST);
    assert.ok(h.formRef.current.frozenMutation); assert.equal(h.effects.some(([name]) => name === 'list'), false);
    const body = h.calls[0].options.body; h.send(async () => ack('stage-create', { replayed: true }));
    await h.submit(event(), { verify: true }); assert.equal(h.calls[1].options.body, body); assert.equal(h.formRef.current, null);
  }
});

test('409 preserves child draft/original revision and cannot adopt a refreshed project or automatically retry', async () => {
  for (const [kind] of cases) {
    const h = harness(kind); h.send(async () => { throw Object.assign(new Error('Changed'), { status: 409 }); });
    const before = structuredClone(h.formRef.current.draft); await h.submit(event());
    assert.equal(h.formRef.current.conflict, true); assert.equal(h.formRef.current.baseRevision, 8);
    assert.deepEqual(h.formRef.current.draft, before); assert.equal(h.formRef.current.requestId, REQUEST);
    await h.submit(event(), { verify: true }); assert.equal(h.calls.length, 1);
    const reviewed = { ...h.formRef.current, reviewed: true };
    callback('adoptRevision', { project: project(kind, 20), form: reviewed, isProjectChildCreation,
      setForm: () => assert.fail('Never adopt a new base for a receipted child creation') })();
    assert.equal(h.effects.some(([name]) => name === 'list'), false);
  }
});

test('same-render double submit, account replacement/rebootstrap, context ABA and unmount suppress duplicate or late effects', async () => {
  for (const retire of ['replace', 'reobserve', 'aba', 'unmount']) {
    const h = harness('stage-create'), held = deferred(); h.send(() => held.promise);
    const pending = h.submit(event()); await h.submit(event()); assert.equal(h.calls.length, 1);
    const count = h.effects.length; h[retire](); held.resolve(ack('stage-create')); await pending;
    assert.equal(h.effects.length, count, retire); await h.submit(event(), { verify: true }); assert.equal(h.calls.length, 1);
  }
});

test('actual openForm allocates fresh UUIDs per explicit opening, retains captured scope and fails closed without UUID support', () => {
  const current = project('stage-create', 8); let observed, n = 0;
  const requestIds = [REQUEST, OTHER, '55555555-5555-4555-8555-555555555555'];
  const deps = { captureAction: () => ({ current: () => true }), canLeave: () => true, admin: true, project: current,
    initialForm: callback('initialForm', {}), isProjectChildCreation, crypto: { randomUUID: () => requestIds[n++] },
    formSequence: { current: 0 }, formRef: { current: null }, setForm: value => { observed = value; }, setMessage() {},
    catalog: { status: 'ready' }, loadCatalog: () => assert.fail('No child catalogue fetch') };
  const open = callback('openForm', deps);
  for (const [kind] of cases) { open(kind); assert.equal(observed.kind, kind); assert.equal(observed.baseRevision, 8); assert.equal(observed.requestId, requestIds[n - 1]); assert.ok(observed.scope.current()); }
  assert.equal(n, 3); const last = observed;
  deps.crypto.randomUUID = undefined; open('stage-create'); assert.equal(observed, last);
});
