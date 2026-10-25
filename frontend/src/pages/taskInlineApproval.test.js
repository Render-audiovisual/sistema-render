import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { canonicalTaskState, STATUSES } from '../features/render-os/constants.js';
import { canUserMoveTaskToState, canRetryTaskUpdate } from '../workspace-task-state.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const file = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(root, predicate) { let result; const visit = node => { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); }; visit(root); assert.ok(result); return result; }
const owner = name => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const initializer = (component, name) => find(owner(component), node => ts.isVariableDeclaration(node) && node.name.getText(file) === name).initializer;
function evaluate(node, deps) {
  const output = ts.transpileModule(`const extracted = (${node.getText(file)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(deps), `${output}\nreturn extracted;`)(...Object.values(deps));
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const deliveryId = '10000000-0000-4000-8000-000000000001';
test('review refresh shares the canonical control without changing its action or busy guards',()=>{
  const button=find(owner('TaskDetail'),node=>ts.isJsxElement(node)&&ts.isIdentifier(node.openingElement.tagName)
    &&node.openingElement.tagName.text==='button'&&node.openingElement.attributes.properties.some(attribute=>
      ts.isJsxAttribute(attribute)&&attribute.name.getText(file)==='onClick'&&attribute.initializer?.getText(file)==='{refreshReviewTask}'));
  const attributes=button.openingElement.attributes.properties;
  const value=name=>attributes.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(file)===name)?.initializer?.getText(file);
  assert.equal(value('className'),'"btn"');assert.equal(value('type'),'"button"');
  assert.equal(value('disabled'),'{reviewRefreshing || approving || deliveryBusy}');
  assert.match(button.getText(file),/Actualizando…/);assert.match(button.getText(file),/Actualizar tarea para revisar/);
});
test('review refresh places its hint below the shared vertically centered control',()=>{
  const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('./WorkspaceReadOnly.css',import.meta.url),'utf8');
  const shared=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(source,/className="ros-work-block ros-review-refresh"><button className="btn"/);
  assert.match(css,/\.ros-review-refresh\{[^}]*flex-direction:column;[^}]*gap:8px/);
  assert.match(css,/\.ros-review-refresh>\.btn\{[^}]*max-width:100%;[^}]*white-space:normal/);
  assert.match(shared,/\.btn \{\s*align-items: center;/);
});
function fixture({ acknowledged = true, historyRevision = 7, historyStatus = 'ready', role = 'admin', saving = false, deliveryBusy = false,
  deliveryDirty = false, approving = false, reviewRefreshing = false, transport } = {}) {
  const task = { id: 5, revision: 7, updated_at: '2026-10-23T12:00:00.000Z', estado: 'en_revision',
    titulo: 'Original', asignado_a_id: 7, colaborador_ids: [], cliente_id: 9, tipo_tarea: 'edicion', propiedades_extra: { workspace: 'render_os' } };
  const store = createBrowserSessionState();
  store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 7, rol: role, nombre: 'QA', usuario: 'qa' },
    session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  const sesion = store.getSession(), effects = [], requests = [], tasksRef = { current: [task] }, approvalPendingRef = { current: false };
  let rows = [task], draft = { ...task }, live = true;
  const request = async (url, options = {}) => {
    requests.push({ url, options });
    return transport ? transport(url, options) : { ...task, estado: 'aprobada', revision: 8 };
  };
  const captureRequest = () => createCapturedRequest({ session: sesion, readSession: store.getSession, isActive: () => live, request });
  const updateTask = evaluate(initializer('WorkspaceReadOnlyPage', 'updateTask'), {
    captureRequest, tasksRef, updateQueuesRef: { current: new Map() }, clients: [],
    setTasks(update) { rows = update(rows); effects.push('rows'); }, markReviewQueueStale() { effects.push('queue'); },
    logActivity: async () => effects.push('activity'), notify: (...args) => effects.push(args), isSessionFailure, canRetryTaskUpdate,
  });
  const approveTask = evaluate(initializer('WorkspaceReadOnlyPage', 'approveTask'), {
    captureRequest, updateTask, users: [], tasksRef, setTasks: () => assert.fail('Publisher route not selected'),
    logActivity: async () => effects.push('activity'), notify: (...args) => effects.push(args), isSessionFailure,
    markReviewQueueStale() { effects.push('queue'); },
  });
  const editingReview = { status: historyStatus, task: { id: task.id, revision: historyRevision }, latestDelivery: { id: deliveryId } };
  const usesEditingReview = evaluate(initializer('TaskDetail', 'usesEditingReview'), { task, metadata: task.propiedades_extra });
  const editingReviewReady = evaluate(initializer('TaskDetail', 'editingReviewReady'), { editingReview, task });
  const mayApproveObservedDelivery = evaluate(initializer('TaskDetail', 'mayApproveObservedDelivery'), {
    usesEditingReview, reviewRefreshing, editingReviewReady, editingReview, reviewAcknowledged: acknowledged,
  });
  const approveForOriana = evaluate(initializer('TaskDetail', 'approveForOriana'), {
    captureRequest, canApproveForOriana: role === 'admin', approvalPendingRef, approving, saving, deliveryBusy, deliveryDirty,
    mayApproveObservedDelivery, selectedPublisher: null, usesEditingReview, editingReview, task, onApprove: approveTask,
    setApproving: value => effects.push(['approving', value]), setReviewAcknowledged: value => effects.push(['acknowledged', value]),
    setReviewError: value => effects.push(['error', value]),
  });
  const saveInlineField = evaluate(initializer('TaskDetail', 'saveInlineField'), {
    captureRequest, saving, canChangeTaskState: true, canEditTask: true, canEditVisitClient: true, canEditVisitDate: true,
    canonicalTaskState, canUserMoveTaskToState, task, sesion, approveForOriana,
    setDraft(update) { draft = update(draft); effects.push('draft'); }, setSaving: value => effects.push(['saving', value]),
    onUpdate: updateTask,
  });
  const select = find(owner('TaskDetail'), node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'select'
    && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'aria-label'
      && ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'Estado'));
  const element = evaluate(select, { React, canonicalTaskState, draft, task, saving,
    availableTaskStatuses: STATUSES.filter(state => state.id === task.estado || canUserMoveTaskToState(task, sesion.usuario, state.id)),
    isProductionVisit: false, productionProgress: { complete: true }, saveInlineField });
  return { task, tasksRef, requests, effects, approvalPendingRef, approveTask, approveForOriana, saveInlineField, element,
    get rows() { return rows; }, get draft() { return draft; }, retire() { live = false; } };
}

test('actual Estado select routes acknowledged review through actual approval/update callbacks with one exact cookie PATCH', async () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const f = fixture();
  assert.ok(React.Children.toArray(f.element.props.children).some(option => option.props.value === 'aprobada'));
  await f.element.props.onChange({ target: { value: 'aprobada' } });
  assert.equal(f.requests.length, 1);
  const call = f.requests[0]; assert.equal(call.url, '/api/tareas/5?workspace=render_os'); assert.equal(call.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(call.options.body), { estado: 'aprobada', expected_entrega_id: deliveryId,
    expected_revision: 7, expected_updated_at: '2026-10-23T12:00:00.000Z' });
  assert.ok(call.options.sessionIntent); assert.equal(new Headers(call.options.headers).has('Authorization'), false);
  assert.equal(f.rows[0].estado, 'aprobada'); assert.equal(f.approvalPendingRef.current, false);
  assert.ok(!f.effects.some(effect => Array.isArray(effect) && effect[0] === 'acknowledged' && effect[1] === true), 'Never auto-check approval');
});

test('unacknowledged/stale/loading-history/dirty/busy/saving/nonadmin selector cannot issue HTTP or paint an approved draft', async () => {
  for (const options of [{ acknowledged: false }, { historyRevision: 6 }, { historyStatus: 'loading' }, { historyStatus: 'error' }, { reviewRefreshing: true },
    { deliveryBusy: true }, { deliveryDirty: true }, { approving: true }, { saving: true }, { role: 'edicion' }]) {
    const f = fixture(options); await f.element.props.onChange({ target: { value: 'aprobada' } });
    assert.equal(f.requests.length, 0, JSON.stringify(options)); assert.equal(f.draft.estado, 'en_revision');
    assert.deepEqual(f.effects, []);
  }
});

test('same-render selector/button double submission is synchronously blocked until first checked approval settles', async () => {
  const held = deferred(), f = fixture({ transport: () => held.promise });
  const pending = f.element.props.onChange({ target: { value: 'aprobada' } });
  assert.equal(f.approvalPendingRef.current, true);
  await f.approveForOriana(); await f.element.props.onChange({ target: { value: 'aprobada' } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 1);
  held.resolve({ ...f.task, estado: 'aprobada', revision: 8 }); await pending;
  assert.equal(f.requests.length, 1); assert.equal(f.approvalPendingRef.current, false);
});

test('parent strict observation guard remains and a queued newer task cannot receive the old reviewed approval', async () => {
  const f = fixture(); await assert.rejects(f.approveTask(f.task), /historial.*versión/); assert.equal(f.requests.length, 0);
  f.tasksRef.current = [{ ...f.task, revision: 8 }];
  await f.element.props.onChange({ target: { value: 'aprobada' } });
  assert.equal(f.requests.length, 0); assert.equal(f.approvalPendingRef.current, false);
  assert.ok(f.effects.some(effect => Array.isArray(effect) && effect[0] === 'acknowledged' && effect[1] === false));
});

test('server409 performs observation GET only, never rebases/retries approval and requires renewed acknowledgment', async () => {
  const f = fixture({ transport: async (_url, options) => {
    if (options.method === 'PATCH') throw Object.assign(Error('stale delivery'), { status: 409 });
    return { ...f.task, revision: 8 };
  } });
  await f.element.props.onChange({ target: { value: 'aprobada' } });
  assert.equal(f.requests.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(f.requests.filter(call => !call.options.method).length, 1);
  assert.ok(f.effects.some(effect => Array.isArray(effect) && effect[0] === 'acknowledged' && effect[1] === false));
});

test('retired account/context blocks dispatch and late ACK cannot publish checked approval UI', async () => {
  const early = fixture(); early.retire(); await early.element.props.onChange({ target: { value: 'aprobada' } });
  assert.equal(early.requests.length, 0);
  const held = deferred(), f = fixture({ transport: () => held.promise });
  const pending = f.element.props.onChange({ target: { value: 'aprobada' } });
  await new Promise(resolve => setImmediate(resolve)); const before = f.effects.length;
  f.retire(); held.resolve({ ...f.task, estado: 'aprobada', revision: 8 }); await pending;
  assert.equal(f.effects.length, before); assert.equal(f.approvalPendingRef.current, false);
});

test('full editor does not offer a new approval; defensive mixed approval save preserves draft and performs no writes', async () => {
  const fullSelect = find(owner('TaskDetail'), node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'select'
    && node.getText(file).includes('availableTaskStatuses.filter'));
  const task = fixture().task;
  const selector = evaluate(fullSelect, { React, canonicalTaskState, draft: { ...task }, task, setDraft() {},
    availableTaskStatuses: STATUSES, isProductionVisit: false, productionProgress: { complete: true } });
  assert.equal(React.Children.toArray(selector.props.children).some(option => option.props.value === 'aprobada'), false);
  const calls = [], draft = { ...task, estado: 'aprobada', titulo: 'Unsaved title' };
  const captureRequest = () => ({ current: () => true, assertCurrent() {} });
  const save = evaluate(initializer('TaskDetail', 'save'), {
    captureRequest, briefDraftOwner: { current: { taskId: task.id, captureRequest, baseline: task, generation: 0, pending: null } }, saving: false, setBriefError() {}, setSaving: value => calls.push(['saving', value]),
    canEditTask: true, isLinkedProductionEditorialTask: () => false, draft, task, canEditVisitClient: true, canEditVisitDate: true,
    canonicalTaskState, metadata: task.propiedades_extra, tags: [], collaborators: [],
    getCanonicalTaskContentMetadata: value => value, isProductionVisit: false, legacyProductionEnabled: false,
    canUserMoveTaskToState, sesion: { usuario: { id: 7, rol: 'admin' } },
    setReviewError: message => calls.push(['error', message]), onApprove: () => assert.fail('No implicit approval'),
    onUpdate: () => assert.fail('Do not save other fields from mixed approval draft'), setEditing: () => assert.fail('Keep editor open'),
  });
  await save(); assert.equal(draft.titulo, 'Unsaved title'); assert.equal(draft.estado, 'aprobada');
  assert.deepEqual(calls.map(call => call[0]), ['saving', 'error', 'saving']); assert.equal(calls.at(-1)[1], false);
});
