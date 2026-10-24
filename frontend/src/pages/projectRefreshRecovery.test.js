import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as model from './projectsModel.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

// Actual page controllers and editor JSX. No native DOM/focus or persistence claim.
const source = readFileSync(new URL('./Projects.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Projects.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = (root, predicate) => { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); } visit(root); return result; };
const owner = name => { const found = nodes(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.equal(found.length, 1, name); return found[0]; };
const options = { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 };
function evaluate(text, deps) {
  const code = ts.transpileModule(`const extracted=(${text});`, { compilerOptions: options }).outputText;
  return new Function('React', ...Object.keys(deps), `${code};return extracted;`)(React, ...Object.values(deps));
}
const callback = (name, deps) => evaluate(owner(name).getText(ast), deps);
const PROJECT = '11111111-1111-4111-8111-111111111111', CHILD = '22222222-2222-4222-8222-222222222222', REQUEST = '33333333-3333-4333-8333-333333333333';
const project = (extra = {}) => ({ id: PROJECT, revision: 8, titulo: 'Observed project', tipo: 'web', estado: 'en_curso', cliente: { id: 2, nombre: 'Client' }, responsable: { id: 1, nombre: 'QA' }, fecha_inicio: null, fecha_entrega: null, archivado: false, counts: { tareas: 0, finalizadas: 0, hitos: 0, entregables: 0 }, descripcion: '', miembro_ids: [], permissions: { administrar: true, editar: true }, etapas: [{ id: CHILD, titulo: 'Stage', posicion: 0, estado: 'pendiente' }], hitos: [], entregables: [], tareas: [], actividad: [], tareas_no_disponibles: 0, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const event = () => ({ preventDefault() {} });
function fixture({ snapshot = project() } = {}) {
  const store = createBrowserSessionState();
  const publish = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, rol: 'admin', nombre: 'QA', usuario: 'qa' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  publish(1); const sesion = store.getSession(), calls = [], paints = [], mounted = { current: true }, selectionRef = { current: { id: PROJECT } };
  let read = async () => ({ proyecto: project() }), write = async () => assert.fail('Unexpected mutation');
  const request = async (url, init = {}) => { calls.push({ url, init }); return init.method ? write(url, init) : read(url, init); };
  const detailStateRef = { current: { status: snapshot ? 'ready' : 'idle', data: snapshot, error: '' } }, formRef = { current: null };
  const deps = { ...model, isSessionFailure, createCapturedRequest, sesion, getSesion: store.getSession, request, mounted, selectionRef, detailStateRef, formRef, formReturnFocus:{current:null},
    admin: true, project: snapshot, detailReadGeneration: { current: 0 }, mutationBusy: { current: false }, formSequence: { current: 1 }, catalog: { status: 'ready' },
    crypto: { randomUUID: () => REQUEST }, window: { confirm: () => false },
    setDetail: value => paints.push(['detail', value]),
    setForm: value => { formRef.current = typeof value === 'function' ? value(formRef.current) : value; paints.push(['form', formRef.current]); },
    setCatalog: value => paints.push(['catalog', value]), setMessage: value => paints.push(['message', value]), setListRefresh: value => paints.push(['list', value]),
    selectProject: () => assert.fail('Refresh must not retarget project'), loadCatalog: () => assert.fail('Unexpected catalog read'),
  };
  const captureNode = nodes(owner('ProjectsSession'), n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'captureAction')[0];
  deps.captureAction = evaluate(captureNode.initializer.getText(ast), deps);
  const lifetime = createCapturedRequest({ session: sesion, readSession: store.getSession, request, isActive: () => mounted.current });
  deps.transport = model.createProjectsTransport(lifetime.request, { isCurrent: lifetime.current });
  for (const name of ['publishDetail', 'canUseProjectObservation', 'canLeave', 'purgeProjectAccess', 'initialForm']) deps[name] = callback(name, deps);
  formRef.current = { seq: 1, kind: 'stage-edit', projectId: PROJECT, childId: CHILD, baseRevision: 8, requestId: REQUEST, initial: { titulo: 'Stage', estado: 'pendiente' }, draft: { titulo: 'UNSAVED', estado: 'pendiente' }, busy: false, conflict: false, reviewed: false, scope: deps.captureAction() };
  deps.form = formRef.current;
  const handlers = Object.fromEntries(['refreshDetail', 'submit', 'openForm', 'lookupTask', 'adoptRevision', 'change', 'cancelForm'].map(name => [name, callback(name, deps)]));
  return { deps, handlers, calls, paints, formRef, detailStateRef, store,
    read: fn => { read = fn; }, write: fn => { write = fn; }, replace: () => publish(2), reobserve: () => publish(1),
    aba() { selectionRef.current = { id: CHILD }; selectionRef.current = { id: PROJECT }; },
    unmount() { mounted.current = false; deps.transport.dispose(); } };
}
const mutations = f => f.calls.filter(call => call.init.method && call.init.method !== 'GET');
async function invokeRetained(f) {
  await f.handlers.submit(event()); await f.handlers.submit(event(), { verify: true });
  f.handlers.openForm('stage-create'); f.handlers.openForm('create');
  await f.handlers.lookupTask(); f.handlers.adoptRevision();
}
test('refresh keeps exact observed snapshot/form through loading and transient/invalid reads; retained action handlers cannot bypass the live ref', async () => {
  for (const failure of [Error('offline'), Object.assign(Error('unavailable'), { status: 503 }), 'malformed']) {
    const f = fixture(), held = deferred(), original = f.formRef.current, observed = f.detailStateRef.current.data;
    f.read(() => held.promise); const pending = f.handlers.refreshDetail(true);
    assert.equal(f.detailStateRef.current.status, 'loading'); assert.equal(f.detailStateRef.current.data, observed);
    await invokeRetained(f); assert.equal(f.formRef.current, original); assert.equal(f.calls.length, 1); assert.equal(mutations(f).length, 0);
    if (failure === 'malformed') held.resolve({ proyecto: { id: PROJECT } }); else held.reject(failure);
    await pending; assert.equal(f.detailStateRef.current.status, 'error'); assert.equal(f.detailStateRef.current.data, observed); assert.ok(f.detailStateRef.current.error);
    await invokeRetained(f); assert.equal(f.formRef.current, original); assert.equal(f.calls.length, 1); assert.equal(original.baseRevision, 8); assert.equal(original.requestId, REQUEST);
  }
});
test('failed refresh preserves editable local draft and dirty cancellation, never silently closes or discards it', async () => {
  const f = fixture(); f.read(async () => { throw Error('offline'); }); await f.handlers.refreshDetail();
  f.handlers.change('titulo', 'LOCAL AFTER ERROR'); assert.equal(f.formRef.current.draft.titulo, 'LOCAL AFTER ERROR');
  f.handlers.cancelForm(); assert.ok(f.formRef.current); assert.equal(mutations(f).length, 0);
});
test('live authority fence independently stops an otherwise eligible frozen verification, adoption, form opening and task lookup', async () => {
  for (const phase of ['pending', 'error']) for (const action of ['verify', 'adopt', 'open', 'lookup']) {
    const f = fixture(), held = deferred(); f.read(() => held.promise);
    f.deps.window.confirm = () => true;
    const current = f.formRef.current; current.reviewed = true; current.conflict = false; current.draft.tarea_id = '45';
    if (action === 'verify') {
      current.kind = 'stage-create'; current.uncertain = true;
      current.frozenMutation = model.buildProjectMutation(current);
    }
    const before = structuredClone({ draft: current.draft, requestId: current.requestId, baseRevision: current.baseRevision, frozenMutation: current.frozenMutation });
    const pending = f.handlers.refreshDetail();
    if (phase === 'error') { held.reject(Error('offline')); await pending; }
    if (action === 'verify') await f.handlers.submit(event(), { verify: true });
    if (action === 'adopt') f.handlers.adoptRevision();
    if (action === 'open') f.handlers.openForm('stage-create');
    if (action === 'lookup') await f.handlers.lookupTask();
    assert.equal(f.calls.length, 1, `${phase}/${action}`); assert.equal(f.formRef.current, current);
    assert.deepEqual({ draft: current.draft, requestId: current.requestId, baseRevision: current.baseRevision, frozenMutation: current.frozenMutation }, before);
    assert.equal(current.reviewed, true, 'retained adoption must not clear observation before authority is fresh');
    if (phase === 'pending') { held.reject(Error('offline')); await pending; }
  }
});
test('only explicit successful refresh re-enables sending; next deliberate edit still carries original CAS and409 does not rebase', async () => {
  const f = fixture(); f.read(async () => { throw Error('offline'); }); await f.handlers.refreshDetail();
  await f.handlers.submit(event()); assert.equal(mutations(f).length, 0);
  f.read(async () => ({ proyecto: project({ revision: 12 }) })); await f.handlers.refreshDetail(); assert.equal(mutations(f).length, 0);
  f.write(async (_url, init) => { assert.deepEqual(JSON.parse(init.body), { expected_revision: 8, titulo: 'UNSAVED', estado: 'pendiente' }); throw Object.assign(Error('stale'), { status: 409 }); });
  await f.handlers.submit(event()); assert.equal(mutations(f).length, 1); assert.equal(f.formRef.current.conflict, true);
  assert.equal(f.formRef.current.baseRevision, 8); assert.equal(f.formRef.current.draft.titulo, 'UNSAVED');
});
test('task lookup started while ready cannot publish an observed task after refresh invalidates authority', async () => {
  const f = fixture(), taskRead = deferred(), detailRead = deferred(); f.formRef.current.draft.tarea_id = '45';
  f.read(url => url.startsWith('/api/tareas/') ? taskRead.promise : detailRead.promise);
  const lookup = f.handlers.lookupTask(); assert.equal(f.formRef.current.lookupBusy, true);
  const refreshing = f.handlers.refreshDetail(); taskRead.resolve({ id: 45, revision: 1, titulo: 'Task', cliente_id: 2 }); await lookup;
  assert.equal(f.formRef.current.observedTask, null); assert.equal(f.formRef.current.lookupBusy, false);
  detailRead.reject(Error('offline')); await refreshing; assert.equal(mutations(f).length, 0);
});
test('cancel after a refreshed structural conflict preserves the remote observation and never retries the stale mutation', async () => {
  for (const accept of [false, true]) {
    const f = fixture();
    const remote = project({ revision: 9, etapas: [{ id: CHILD, titulo: 'REMOTE', posicion: 0, estado: 'pendiente' }] });
    f.read(async () => ({ proyecto: remote }));
    await f.handlers.refreshDetail();
    f.write(async (_url, init) => {
      assert.equal(JSON.parse(init.body).expected_revision, 8);
      throw Object.assign(Error('stale'), { status: 409 });
    });
    await f.handlers.submit(event());
    const conflicted = f.formRef.current, observed = f.detailStateRef.current.data;
    assert.equal(conflicted.conflict, true);
    assert.equal(conflicted.baseRevision, 8);
    assert.equal(observed.revision, 9);
    assert.equal(observed.etapas[0].titulo, 'REMOTE');
    let decisions = 0;
    f.deps.window.confirm = () => { decisions++; return accept; };
    const beforeCalls = f.calls.length;
    f.handlers.cancelForm();
    assert.equal(decisions, 1);
    assert.equal(f.calls.length, beforeCalls, 'Cancellation must not read, save or retry');
    assert.equal(mutations(f).length, 1, 'Only the rejected stale mutation was attempted');
    assert.equal(f.detailStateRef.current.data, observed);
    if (accept) {
      assert.equal(f.formRef.current, null);
      assert.deepEqual(f.deps.formReturnFocus.current, { kind: 'stage-edit', scope: conflicted.scope });
    } else {
      assert.equal(f.formRef.current, conflicted);
      assert.equal(conflicted.draft.titulo, 'UNSAVED');
      assert.equal(conflicted.baseRevision, 8);
      assert.equal(f.deps.formReturnFocus.current, null);
    }
  }
});
test('successful retry updates authority only, retaining original CAS/UUID/draft/conflict until explicit allowed adoption', async () => {
  const f = fixture(), original = f.formRef.current; original.conflict = true;
  f.read(async () => ({ proyecto: project({ revision: 12 }) })); await f.handlers.refreshDetail(true);
  assert.equal(f.detailStateRef.current.data.revision, 12); assert.equal(f.formRef.current.draft, original.draft);
  assert.equal(f.formRef.current.baseRevision, 8); assert.equal(f.formRef.current.requestId, REQUEST); assert.equal(f.formRef.current.conflict, true); assert.equal(f.formRef.current.reviewed, true); assert.equal(mutations(f).length, 0);
  for (const kind of ['stage-create', 'milestone-create', 'deliverable-create', 'deliverable-approve']) {
    const form = { ...f.formRef.current, kind }; f.deps.form = form; f.formRef.current = form;
    callback('adoptRevision', { ...f.deps, project: f.detailStateRef.current.data })(); assert.equal(f.formRef.current.baseRevision, 8); assert.equal(f.formRef.current.conflict, true);
  }
  f.formRef.current = { ...original, reviewed: true }; callback('adoptRevision', { ...f.deps, form: f.formRef.current, project: f.detailStateRef.current.data })();
  assert.equal(f.formRef.current.baseRevision, 12); assert.equal(f.formRef.current.conflict, false); assert.equal(f.formRef.current.draft, original.draft);
});
test('fresh revoked or archived observations keep the draft but block retained submit/verify/new forms/task lookup/adoption', async () => {
  for (const extra of [{ permissions: { editar: false, administrar: false } }, { archivado: true }]) {
    const f = fixture(), original = f.formRef.current;
    f.read(async () => ({ proyecto: project({ revision: 9, ...extra }) })); await f.handlers.refreshDetail();
    await f.handlers.submit(event()); await f.handlers.submit(event(), { verify: true }); f.handlers.openForm('stage-create'); await f.handlers.lookupTask(); f.handlers.adoptRevision();
    assert.equal(f.formRef.current, original); assert.equal(f.calls.length, 1); assert.equal(mutations(f).length, 0);
  }
});
test('current403 purges observed content/form/catalog and leaves old submit/verify handlers unable to send', async () => {
  const f = fixture(); f.read(async () => { throw Object.assign(Error('denied'), { status: 403 }); }); await f.handlers.refreshDetail();
  assert.equal(f.formRef.current, null); assert.equal(f.detailStateRef.current.data, null); assert.equal(f.detailStateRef.current.status, 'error');
  assert.deepEqual(f.paints.find(([kind]) => kind === 'catalog')[1], { status: 'idle', clients: [], users: [], error: '' });
  await invokeRetained(f); assert.equal(f.calls.length, 1); assert.equal(mutations(f).length, 0);
});
test('401/session failures are never recoverable private snapshots or a permission to verify', async () => {
  for (const error of [Object.assign(Error('unauthorized'), { status: 401 }), Object.assign(Error('session failure'), { name: 'BrowserSessionError' })]) {
    const f = fixture(); f.read(async () => { throw error; }); await f.handlers.refreshDetail();
    assert.equal(f.detailStateRef.current.data, null); await invokeRetained(f); assert.equal(f.calls.length, 1); assert.equal(mutations(f).length, 0);
  }
  const f = fixture(); f.read(async () => { f.store.invalidate(f.store.captureIntent()); throw Object.assign(Error('unauthorized'), { name: 'BrowserSessionError' }); });
  const pending = f.handlers.refreshDetail(); const count = f.paints.length; await pending;
  assert.equal(f.store.getSession(), null); assert.equal(f.paints.length, count); await invokeRetained(f); assert.equal(f.calls.length, 1); assert.equal(mutations(f).length, 0);
});
test('old success/error/403 cannot restore or purge after identity replacement, same-actor reobservation, selection ABA or unmount', async () => {
  for (const retire of ['replace', 'reobserve', 'aba', 'unmount']) for (const error of [null, Error('offline'), Object.assign(Error('denied'), { status: 403 })]) {
    const f = fixture(), held = deferred(); f.read(() => held.promise); const pending = f.handlers.refreshDetail(true);
    f[retire](); const count = f.paints.length;
    if (error) held.reject(error); else held.resolve({ proyecto: project({ revision: 99 }) });
    await pending; assert.equal(f.paints.length, count, retire); assert.ok(f.formRef.current); assert.equal(f.formRef.current.baseRevision, 8);
    await f.handlers.submit(event()); assert.equal(mutations(f).length, 0);
  }
});
test('newer refresh wins over earlier GET; refresh during mutation never starts another read', async () => {
  const f = fixture(), first = deferred(), second = deferred(); let reads = 0;
  f.read(() => ++reads === 1 ? first.promise : second.promise);
  const a = f.handlers.refreshDetail(), b = f.handlers.refreshDetail(); second.resolve({ proyecto: project({ revision: 10 }) }); await b;
  const count = f.paints.length; first.reject(Object.assign(Error('old denied'), { status: 403 })); await a;
  assert.equal(f.paints.length, count); assert.equal(f.detailStateRef.current.data.revision, 10);
  f.deps.mutationBusy.current = true; await f.handlers.refreshDetail(); assert.equal(reads, 2);
});
test('without a compatible prior snapshot initial read failures never invent a project', async () => {
  for (const snapshot of [null, project({ id: CHILD })]) {
    const f = fixture({ snapshot }); f.read(async () => { throw Error('offline'); }); await f.handlers.refreshDetail();
    assert.equal(f.detailStateRef.current.data, null); assert.equal(f.detailStateRef.current.status, 'error'); assert.equal(f.deps.canUseProjectObservation('stage-edit'), false);
  }
});
test('real editor JSX stays rendered from retained data; submit/verify/lookup/adoption disable while local editing and cancel remain available', () => {
  const f = fixture(), session = owner('ProjectsSession');
  const editorMount = nodes(session, n => ts.isJsxExpression(n) && n.getText(ast).includes('<ProjectEditor')).at(-1);
  const Editor = callback('ProjectEditor', { ...model, useRef: React.useRef, useEffect: React.useEffect,
    FORM_TITLES: { 'stage-edit': 'Editar etapa', 'task-link': 'Vincular tarea' }, TitleInput: props => React.createElement('input', { value: props.value, onChange: props.onChange }),
    FilterSelect: props => React.createElement('select', { disabled: props.disabled }, props.children), Options: () => null,
    StageSelect: () => null, DateInput: () => null, ProjectFields: () => null });
  const descendants = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
  for (const status of ['loading', 'error']) {
    const form = { ...f.formRef.current, error: 'Read unavailable', uncertain: true, conflict: true, reviewed: true };
    const deps = { form, project: f.detailStateRef.current.data, catalog: { status: 'ready' }, observationReady: false, ProjectEditor: Editor,
      change() {}, cancelForm() {}, submit() {}, refreshDetail() {}, adoptRevision() {}, lookupTask() {}, loadCatalog() {}, moveStage() {} };
    const element = evaluate(editorMount.expression.getText(ast), deps); assert.equal(element.type, Editor, status); assert.equal(element.props.form, form); assert.equal(element.props.observationReady, false);
    const tree = callback('ProjectEditor', { ...model, useRef: value => ({ current: value }), useEffect() {}, FORM_TITLES: { 'stage-edit': 'Editar etapa' }, TitleInput: 'TitleInput', FilterSelect: 'FilterSelect', Options: 'Options' })(element.props);
    const buttons = descendants(tree).filter(n => n.type === 'button');
    assert.equal(buttons.find(n => n.props.type === 'submit').props.disabled, true);
    assert.equal(buttons.find(n => n.props.children === 'Verificar la misma solicitud').props.disabled, true);
    assert.equal(buttons.find(n => n.props.onClick === deps.adoptRevision).props.disabled, true);
    assert.equal(buttons.find(n => n.props.children === 'Cancelar').props.disabled, false);
    const html = renderToStaticMarkup(element); assert.match(html, /UNSAVED/); assert.match(html, /Editar etapa/);
  }
  const retained = { ...f.formRef.current, kind: 'task-link', draft: { tarea_id: '45', etapa_id: '' }, uncertain: false };
  const taskTree = callback('ProjectEditor', { ...model, useRef: value => ({ current: value }), useEffect() {}, FORM_TITLES: { 'task-link': 'Vincular tarea' }, StageSelect: 'StageSelect' })({
    form: retained, project: project(), catalog: { status: 'ready' }, observationReady: false,
    cancel() {}, submit() {}, lookupTask() {}, change() {},
  });
  const taskNodes = descendants(taskTree);
  assert.equal(taskNodes.find(n => n.type === 'button' && n.props.className === 'pr-field-action').props.disabled, true);
  assert.equal(taskNodes.find(n => n.type === 'fieldset').props.disabled, false, 'failed observation does not disable local draft editing');
  const snapshotNotice = nodes(session, n => ts.isJsxExpression(n) && n.getText(ast).includes('Mostramos la última versión observada, pendiente de actualizar.')).at(-1);
  assert.ok(snapshotNotice);
  const notice = renderToStaticMarkup(evaluate(snapshotNotice.expression.getText(ast), { project: project(), observationReady: false }));
  assert.match(notice, /role="status"/); assert.match(notice, /Conservamos tu borrador/);
});
