import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createTaskManualOrder } from '../features/render-os/utils/task-manual-order.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { canonicalTaskState, STATUSES } from '../features/render-os/constants.js';
import { effectiveTaskFilterState } from '../features/render-os/utils/task-view-state.js';
import { canUserEditTask, canUserMoveTask, canUserMoveTaskToState } from '../workspace-task-state.js';

const file = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(root, predicate) { let result; function visit(n) { if (predicate(n)) result = n; ts.forEachChild(n, visit); } visit(root); assert.ok(result); return result; }
const init = (owner, name) => find(find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === owner), n => ts.isVariableDeclaration(n) && n.name.getText(file) === name).initializer;
function extract(node, deps) {
  const js = ts.transpileModule(`const extracted = (${node.getText(file)});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), `${js};return extracted;`)(...Object.values(deps));
}
const moved = { id: 5, revision: 7, titulo: 'Source', estado: 'en_progreso', asignado_a_id: 7 };
const anchor = { ...moved, id: 6, revision: 3, titulo: 'Anchor' };
const uuid = '11111111-1111-4111-8111-111111111111';
function transfer() {
  const values = new Map();
  return { get types() { return [...values.keys()]; }, setData: (type, value) => values.set(type, String(value)),
    getData: type => values.get(type) || '', setDragImage() {}, effectAllowed: 'uninitialized' };
}
function event(dataTransfer, interactive = false) {
  const classes = new Set();
  return { dataTransfer, clientX: 10, clientY: 10, prevented: false, stopped: false,
    target: { closest: () => interactive ? {} : null },
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }), classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}
function fixture({ blocked = false } = {}) {
  const store = createBrowserSessionState();
  store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 7, rol: 'admin', nombre: 'Synthetic', usuario: 'qa' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  const session = store.getSession(), calls = [], pending = [], effects = [];
  const captureRequest = () => createCapturedRequest({ session, readSession: store.getSession, request: async (url, options) => {
    calls.push({ url, options });
    const input = JSON.parse(options.body);
    return { task_id: input.task_id, before_id: input.before_id, order_revision: '4', changed: true, replayed: false };
  } });
  const orderModel = createTaskManualOrder({ capture: captureRequest, randomUUID: () => uuid });
  const observation = {}, page = { current: { observation, revision: '3' } };
  const reorder = extract(init('WorkspaceReadOnlyPage', 'reorderTask'), { captureRequest, orderModel, manualReady: true,
    canUserEditTask, sesion: session, orderContextRef: { current: observation }, orderObservation: observation, orderPageRef: page,
    setOrderMessage: value => effects.push(value), renderOrder() {}, reloadTaskOrder: () => effects.push('reload'), isSessionFailure });
  const deps = { sort: 'manual', archiveMode: 'active', manualReady: true, tasksLatestRef: { current: [moved, anchor] },
    sesion: session, canonicalTaskState, effectiveTaskFilterState, canUserEditTask, canUserMoveTask, canUserMoveTaskToState,
    setDragOver() {}, compactBoard: false, selectMobileBoardColumn() {}, move: () => assert.fail('No state write for same-column ordering'),
    onReorder: (...args) => { const promise = reorder(...args); pending.push(promise); return promise; } };
  const dropBefore = extract(init('TasksView', 'dropBeforeTask'), deps);
  const dropEnd = extract(init('TasksView', 'dropOnProcessButton'), deps);
  const cardFunction = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'TaskCard').initializer.arguments[0];
  const instances = new Map(); let refs, cursor = 0;
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const Card = extract(cardFunction, { React, useRef: value => refs[cursor++] ||= { current: value },
    personForTask: () => null, taskResponsibles: () => ['Synthetic'], getProductionPhase: () => null, STATUSES,
    canonicalTaskState, canUserMoveTaskToState, effectiveTaskFilterState, AreaBadge: 'AreaBadge', Avatar: 'Avatar',
    esperandoMaterial: () => false, taskResponsiblesLabel: () => 'Synthetic', isTaskCompleted: () => false, formatDate: () => '' });
  const render = task => { cursor = 0;
    if (!instances.has(task.id)) instances.set(task.id, []);
    refs = instances.get(task.id);
    return Card({ task, users: [], user: session.usuario, today: '2026-10-22',
    onOpen: () => effects.push('open'), onMove: () => assert.fail('Unexpected state move'), canMove: true,
    moveBlocked: blocked, manualControls: {}, onOrderDrop: dropBefore }); };
  return { calls, pending, effects, render, dropEnd, session, orderModel };
}

test('actual pointer/start/card-drop/reorder/model/cookie capture sends exactly one before-anchor POST', async () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const f = fixture(), data = transfer(), source = f.render(moved), target = f.render(anchor);
  source.props.onPointerDown(event(data)); const start = event(data); source.props.onDragStart(start);
  assert.equal(start.prevented, false); assert.equal(data.getData('text/task-id'), '5'); assert.equal(data.effectAllowed, 'move');
  const over = event(data); target.props.onDragOver(over); assert.equal(over.prevented, true);
  const drop = event(data); target.props.onDrop(drop); await Promise.all(f.pending);
  assert.equal(drop.stopped, true); assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0]; assert.equal(url, '/api/tareas/orden'); assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { request_id: uuid, task_id: 5, expected_revision: 7,
    before_id: 6, expected_before_revision: 3, expected_order_revision: '3' });
  assert.ok(options.sessionIntent); assert.equal(options.sessionIntent.session, f.session);
  assert.equal(new Headers(options.headers).has('Authorization'), false);
  assert.ok(f.effects.includes('reload')); assert.equal(f.orderModel.snapshot.locked, false);
});

test('actual source drag to same-column background sends exactly one explicit-end POST', async () => {
  const f = fixture(), data = transfer(), card = f.render(moved);
  card.props.onPointerDown(event(data)); card.props.onDragStart(event(data));
  f.dropEnd(event(data), { id: 'en_progreso' }); await Promise.all(f.pending);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { request_id: uuid, task_id: 5, expected_revision: 7,
    before_id: null, expected_before_revision: null, expected_order_revision: '3' });
});

test('actual interactive pointer origin blocks drag; next noninteractive pointer clears persistent block', async () => {
  const f = fixture(), data = transfer(); let card = f.render(moved);
  card.props.onPointerDown(event(data, true)); card = f.render(moved);
  const blocked = event(data); card.props.onDragStart(blocked); assert.equal(blocked.prevented, true);
  f.render(anchor).props.onDrop(event(data)); await Promise.all(f.pending); assert.equal(f.calls.length, 0);
  card.props.onPointerDown(event(data)); card.props.onDragStart(event(data));
  f.render(anchor).props.onDrop(event(data)); await Promise.all(f.pending); assert.equal(f.calls.length, 1);
});

test('actual moveBlocked start has no transported ID and no order request', async () => {
  const f = fixture({ blocked: true }), data = transfer(), card = f.render(moved), start = event(data);
  card.props.onPointerDown(event(data)); card.props.onDragStart(start);
  assert.equal(start.prevented, true); assert.deepEqual(data.types, []);
  f.render(anchor).props.onDrop(event(data)); f.dropEnd(event(data), { id: 'en_progreso' });
  await Promise.all(f.pending); assert.equal(f.calls.length, 0);
});

test('actual self-drop and foreign transfer are consumed or ignored without POST', async () => {
  for (const kind of ['self', 'foreign-type', 'foreign-id']) {
    const f = fixture(), data = transfer(), card = f.render(moved);
    if (kind === 'self') { card.props.onPointerDown(event(data)); card.props.onDragStart(event(data)); }
    if (kind === 'foreign-type') data.setData('text/plain', '5');
    if (kind === 'foreign-id') data.setData('text/task-id', '999');
    const drop = event(data); card.props.onDrop(drop);
    if (kind !== 'self') f.dropEnd(event(data), { id: 'en_progreso' });
    await Promise.all(f.pending); assert.equal(f.calls.length, 0, kind);
    if (kind === 'self') assert.equal(drop.stopped, true);
  }
});

test('actual completed source drag suppresses the following card click across render until a fresh pointer origin', () => {
  const f = fixture(), data = transfer(); let card = f.render(moved);
  card.props.onPointerDown(event(data)); card.props.onDragStart(event(data));
  card.props.onDragEnd(event(data)); card = f.render(moved);
  card.props.onClick(event(data)); assert.equal(f.effects.includes('open'), false, 'Drop/end must not accidentally open source card');
  card.props.onPointerDown(event(data)); card.props.onClick(event(data));
  assert.deepEqual(f.effects.filter(value => value === 'open'), ['open']); assert.equal(f.calls.length, 0);
});

test('actual title button pointer blocks drag without payload; its normal click opens once without triggering order writes', async () => {
  const f = fixture(), data = transfer(); let card = f.render(moved);
  const titleButton = node => {
    const pending = [node];
    while (pending.length) {
      const value = pending.pop();
      if (Array.isArray(value)) pending.push(...value);
      else if (value?.props) {
        if (value.type === 'button' && value.props.className === 'ros-card-open') return value;
        pending.push(value.props.children);
      }
    }
    assert.fail('Actual title open button must be present');
  };
  const button = titleButton(card), pointer = event(data);
  pointer.target = { closest: selector => { assert.ok(selector.includes('button')); return button; } };
  card.props.onPointerDown(pointer); card = f.render(moved);
  const start = event(data); card.props.onDragStart(start);
  assert.equal(start.prevented, true); assert.deepEqual(data.types, [], 'Button origin never transports a task ID');
  f.render(anchor).props.onDrop(event(data)); await Promise.all(f.pending); assert.equal(f.calls.length, 0);
  const click = event(data, true); titleButton(card).props.onClick(click);
  if (!click.stopped) card.props.onClick(click);
  assert.deepEqual(f.effects.filter(value => value === 'open'), ['open']); assert.equal(f.calls.length, 0);
  // A subsequent background gesture must still be draggable after button use.
  card.props.onPointerDown(event(data)); const background = event(data); card.props.onDragStart(background);
  assert.equal(background.prevented, false); assert.equal(data.getData('text/task-id'), '5');
});
