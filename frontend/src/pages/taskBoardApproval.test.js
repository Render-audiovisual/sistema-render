import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { canonicalTaskState, STATUSES } from '../features/render-os/constants.js';
import { effectiveTaskFilterState, getTaskViewState } from '../features/render-os/utils/task-view-state.js';
import { canUserMoveTaskToState, canUserMoveTask, canUserEditTask } from '../workspace-task-state.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { requestAppNavigation } from '../shared/navigation/location.js';
import { isProductionVisitTask, getProductionVisitProgress } from '../features/render-os/utils/production-visits.js';

// Real callbacks/JSX with in-memory transport, not a native drag or persistence claim.
const ast = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) { const out = []; function visit(n) { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); } visit(root); return out; }
const owner = name => { const result = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(result, name); return result; };
const init = (name, scope = 'TasksView') => { const found = nodes(owner(scope), n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name); assert.equal(found.length, 1, name); return found[0].initializer; };
function evaluate(node, deps) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useCallback') node = node.arguments[0];
  const code = ts.transpileModule(`const value=(${node.getText(ast)});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('React', ...Object.keys(deps), `${code};return value;`)(React, ...Object.values(deps));
}
const task = { id: 5, revision: 7, titulo: 'Entrega observada', estado: 'en_revision', tipo_tarea: 'edicion', asignado_a_id: 7, propiedades_extra: { workspace: 'render_os' } };
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function event(id = 5, types = ['text/task-id']) {
  return { dataTransfer: { types, getData: () => String(id) }, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}
function fixture({ rows = [task], role = 'admin', transport = async () => ({ ...task }), href = 'https://render.test/workspace/tareas?view=board&client=9#board' } = {}) {
  const store = createBrowserSessionState();
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, rol: role, nombre: 'QA', usuario: 'qa' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(7); const session = store.getSession(); let live = true, generation = 0;
  const requests = [], effects = [], pending = [], state = { selected: null, review: null };
  class DetailEvent extends Event { constructor(type, options) { super(type, options); this.detail = options?.detail; } }
  const win = new EventTarget(); win.CustomEvent = DetailEvent; win.location = new URL(href);
  win.history = { state: {}, pushState(value, _title, url) { effects.push(['push', String(url)]); this.state = value; win.location = new URL(url, win.location); }, replaceState(value, _title, url) { effects.push(['replace', String(url)]); this.state = value; win.location = new URL(url, win.location); }, back() { effects.push(['back']); } };
  const captureRequest = () => { const observed = generation; return createCapturedRequest({ session, readSession: store.getSession, isActive: () => live && generation === observed,
    request: async (url, options = {}) => { requests.push({ url, options }); assert.ok(!options.method || options.method === 'GET', 'review navigation must never mutate HTTP'); return transport(url, options); } }); };
  const deps = { captureRequest, window: win, AbortController, requestAppNavigation, isSessionFailure,
    tasksLatestRef: { current: rows }, openRequestRef: { current: null },
    setSelectedId: value => { state.selected = value; effects.push(['selected', value]); },
    setReviewRequestedTaskId: value => { state.review = value; effects.push(['review', value]); },
    incorporateRelatedTasks: items => effects.push(['related', items]), onError: message => effects.push(['error', message]),
    orderState: { busy: false, locked: false }, sesion: session, canonicalTaskState, STATUSES, canUserMoveTaskToState, canUserMoveTask, canUserEditTask, effectiveTaskFilterState,
    isProductionVisitTask, getProductionVisitProgress,
    onApprove: (...args) => { effects.push(['approve', ...args]); return Promise.resolve(); }, onUpdate: (...args) => { effects.push(['update', ...args]); return Promise.resolve(); },
    sort: 'manual', archiveMode: 'active', manualReady: true, setDragOver() {}, compactBoard: true,
    selectMobileBoardColumn: value => effects.push(['column', value]), onReorder: (...args) => effects.push(['reorder', ...args]),
    getTaskViewState, setView() {}, setCalendarMonth() {}, setMobileBoardColumn() {},
  };
  const open = (...args) => { const promise = evaluate(init('openTask'), deps)(...args); pending.push(promise); return promise; };
  deps.openTask = open; deps.move = (...args) => evaluate(init('move'), deps)(...args);
  return { deps, win, requests, effects, state, pending, open,
    move: deps.move, drop: (e, column) => evaluate(init('dropOnProcessButton'), deps)(e, column), before: (e, row) => evaluate(init('dropBeforeTask'), deps)(e, row),
    unmount() { live = false; deps.openRequestRef.current?.abort(); }, aba() { generation += 2; }, switchActor() { accept(8); } };
}
const noWrites = f => { assert.ok(!f.effects.some(([kind]) => ['approve', 'update', 'reorder'].includes(kind))); assert.ok(f.requests.every(call => !call.options.method || call.options.method === 'GET')); };

test('actual team move callback completes another person task directly without approval, publication or review GET', () => {
  for (const role of ['admin','diseno','edicion','produccion','community','programacion','custom_role_qa']) {
    const row = {...task,estado:'pendiente',asignado_a_id:99}, f = fixture({role,rows:[row]});
    assert.equal(f.move(row,'finalizada'),'move');
    assert.deepEqual(f.effects[0].slice(0,3),['update',row.id,{estado:'finalizada'}]);
    assert.equal(f.effects.some(([kind])=>kind==='approve'),false);assert.deepEqual(f.requests,[]);
    assert.equal(row.estado,'pendiente','Only server confirmation may update the board');
  }
});
test('actual incomplete-visit move reports a production integrity message rather than requiring approval', () => {
  const row={...task,tipo_tarea:'produccion',titulo:'Visita QA',propiedades_extra:{workspace:'render_os',produccion_videos_previstos:2,produccion_registros:[{cantidad:1}]}},f=fixture({role:'edicion',rows:[row]});
  assert.equal(f.move(row,'finalizada'),undefined);noWrites(f);
  assert.match(f.effects.find(([kind])=>kind==='error')[1],/registro de la visita en Producciones/);
});

test('actual permitted editing approval opens explicit review via cookie-bound GET, never an approval or optimistic column transition', async () => {
  assert.equal(ast.parseDiagnostics.length, 0); const f = fixture();
  assert.equal(f.move(task, 'aprobada'), 'review'); await Promise.all(f.pending);
  assert.deepEqual(f.state, { selected: 5, review: 5 }); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/tareas/5?workspace=render_os'); assert.ok(f.requests[0].options.sessionIntent);
  assert.equal(new Headers(f.requests[0].options.headers).has('Authorization'), false);
  assert.equal(f.win.location.searchParams.get('client'), '9'); assert.equal(f.win.location.hash, '#board');
  assert.equal(task.estado, 'en_revision'); noWrites(f);
});
test('actual permission/busy/same-state checks precede review navigation', () => {
  for (const mode of ['nonadmin', 'invalidActor', 'busy', 'locked', 'same', 'wrongState']) {
    const f = fixture({ role: mode === 'nonadmin' ? 'edicion' : 'admin' });
    if (mode === 'invalidActor') f.deps.sesion = { usuario: { id: 0, rol: 'admin' } };
    if (mode === 'busy') f.deps.orderState.busy = true;
    if (mode === 'locked') f.deps.orderState.locked = true;
    const row = mode === 'wrongState' ? { ...task, estado: 'pendiente' } : task;
    assert.equal(f.move(row, mode === 'same' ? 'en_revision' : 'aprobada'), undefined);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.state, { selected: null, review: null }); noWrites(f);
  }
});
test('review-to-approved card drop stays in the mixed display without ordering, approval or navigation', async () => {
  const f = fixture(), e = event(), target = { ...task, id: 6, estado: 'aprobada' };
  const cardFn = nodes(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'TaskCard')[0].initializer.arguments[0];
  const article = nodes(cardFn, n => ts.isJsxOpeningElement(n) && n.tagName.getText(ast) === 'article')[0];
  const drop = article.attributes.properties.find(p => p.name?.text === 'onDrop').initializer.expression;
  evaluate(drop, { onOrderDrop: f.before, task: target })(e);
  assert.equal(e.stopped, true, 'Mixed-column card drop is consumed without a business transition');
  f.drop(e, { id: 'en_revision', states: ['en_revision','aprobada'], dropState:'en_revision' }); await Promise.all(f.pending);
  assert.equal(e.prevented, true); assert.equal(f.state.review, null); assert.equal(f.requests.length, 0);
  assert.ok(!f.effects.some(([name]) => name === 'column')); noWrites(f);
});
test('mixed background drop is inert; explicit mobile approval selector still opens required review without writes', async () => {
  for (const via of ['background', 'selector']) {
    const f = fixture();
    if (via === 'background') f.drop(event(), { id: 'en_revision', states:['en_revision','aprobada'], dropState: 'en_revision' });
    else {
      const cardFn = nodes(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'TaskCard')[0].initializer.arguments[0];
      const select = nodes(cardFn, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'select')[0];
      const element = evaluate(select, { canMove: true, moveBlocked: false, task, canonicalTaskState, availableStatuses: STATUSES, onMove: f.move });
      let stopped = false; element.props.onChange({ target: { value: 'aprobada' }, stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
    }
    await Promise.all(f.pending); assert.equal(f.state.review, via==='background'?null:5); assert.equal(f.requests.length, via==='background'?0:1); noWrites(f);
  }
});
test('mixed-column ordering is unavailable; explicit ordinary/noncanonical moves retain existing approval routes', () => {
  const f = fixture(), before = { ...task, id: 6 }; const e = event();
  f.before(e, before); assert.equal(e.stopped, true); assert.deepEqual(f.effects, []);
  f.drop(event(), { id: 'en_revision',states:['en_revision','aprobada'] }); assert.deepEqual(f.effects, []);
  assert.equal(f.requests.length, 0); assert.equal(f.state.review, null);
  for (const row of [{ ...task, tipo_tarea: 'diseno' }, { ...task, propiedades_extra: {} }]) {
    assert.equal(f.move(row, 'aprobada'), 'approval'); assert.deepEqual(f.effects.at(-1), ['approve', row]);
  }
  assert.equal(f.move(task, 'en_progreso'), 'move'); assert.equal(f.effects.at(-1)[0], 'update');
});
test('compact drops blocked by busy/locked, same state or permission rejection neither advance nor dispatch', () => {
  for (const mode of ['busy', 'locked', 'same', 'rejected']) {
    const f = fixture({ role: mode === 'rejected' ? 'edicion' : 'admin' });
    // Date mode exercises the business-state path even for same-column drops,
    // rather than the separate explicit manual-order end action.
    f.deps.sort = 'date';
    if (mode === 'busy') f.deps.orderState.busy = true;
    if (mode === 'locked') f.deps.orderState.locked = true;
    f.drop(event(), { id: mode === 'same' ? 'en_revision' : mode === 'rejected' ? 'aprobada' : 'en_progreso' });
    assert.equal(f.requests.length, 0, mode);
    assert.deepEqual(f.state, { selected: null, review: null }, mode);
    assert.ok(!f.effects.some(([name]) => name === 'column'), mode);
    noWrites(f);
    if (mode === 'rejected') assert.equal(f.effects.filter(([name]) => name === 'error').length, 1);
  }
});
test('only admitted move/legacy approval advance a compact drop once; desktop does not navigate columns', () => {
  for (const compact of [true, false]) for (const action of ['move', 'approval']) {
    const row = action === 'approval' ? { ...task, tipo_tarea: 'diseno' } : task;
    const f = fixture({ rows: [row] }); f.deps.compactBoard = compact;
    const destination = action === 'approval' ? 'aprobada' : 'en_progreso';
    f.drop(event(), { id: destination });
    assert.equal(f.effects.filter(([name]) => name === (action === 'approval' ? 'approve' : 'update')).length, 1);
    assert.deepEqual(f.effects.filter(([name]) => name === 'column'), compact ? [['column', destination]] : []);
    assert.equal(f.requests.length, 0); assert.equal(f.state.review, null);
    assert.equal(row.estado, 'en_revision', 'Admission is not a server confirmation or local state mutation');
  }
});
test('actual denied/foreign/missing task drops never open a review or issue HTTP', () => {
  for (const mode of ['denied', 'foreign', 'missing']) {
    const f = fixture({ role: mode === 'denied' ? 'edicion' : 'admin' });
    f.drop(event(mode === 'missing' ? 99 : 5, mode === 'foreign' ? ['text/plain'] : ['text/task-id']), { id: 'aprobada' });
    assert.equal(f.requests.length, 0); assert.equal(f.state.review, null); noWrites(f);
  }
});
test('actual cached review respects navigation veto before selection, history or HTTP', async () => {
  const f = fixture(); f.win.addEventListener('render:before-navigation', e => e.preventDefault());
  await f.open(5, true); assert.deepEqual(f.effects, []); assert.equal(f.requests.length, 0); noWrites(f);
});
test('actual uncached detail may read but navigation cancellation cannot set review/history; only literal true requests review', async () => {
  const denied = fixture({ rows: [] }); denied.win.addEventListener('render:before-navigation', e => e.preventDefault());
  await denied.open(5, true); assert.equal(denied.requests.length, 1); assert.deepEqual(denied.state, { selected: null, review: null });
  assert.ok(!denied.effects.some(([name]) => ['push', 'selected', 'review'].includes(name))); noWrites(denied);
  for (const value of [undefined, false, 'true', 1]) {
    const f = fixture(); await f.open(5, value); assert.deepEqual(f.state, { selected: 5, review: null }); noWrites(f);
  }
});
test('actual navigation listener invalidating the session/context cannot commit selection or HTTP', async () => {
  for (const mode of ['switchActor', 'aba', 'unmount']) {
    const f = fixture(); f.win.addEventListener('render:before-navigation', () => f[mode]());
    await f.open(5, true); assert.deepEqual(f.effects, [], mode); assert.equal(f.requests.length, 0); noWrites(f);
  }
});
test('actual uncached open rejects late actor/ABA/unmount/superseded reads without review revival', async () => {
  for (const mode of ['switchActor', 'aba', 'unmount', 'superseded']) {
    const held = deferred(), f = fixture({ rows: [], transport: () => held.promise }); const pending = f.open(5, true);
    assert.equal(f.requests.length, 1);
    if (mode === 'superseded') { f.deps.tasksLatestRef.current = [{ ...task, id: 6 }]; const newer = f.open(6); await settle(); assert.equal(f.state.review, null); held.resolve({ ...task }); await newer; }
    else { f[mode](); held.resolve({ ...task }); }
    const before = f.effects.length; await pending; assert.equal(f.effects.length, before, mode); assert.notEqual(f.state.review, 5); noWrites(f);
  }
});
test('ordinary open (including same task URL), close and actual popstate clear the review-only hint', async () => {
  const f = fixture(); await f.open(5, true); assert.equal(f.state.review, 5);
  const pushes = f.effects.filter(([kind]) => kind === 'push').length;
  await f.open(5); assert.equal(f.state.review, null); assert.equal(f.effects.filter(([kind]) => kind === 'push').length, pushes);
  await f.open(5, true); evaluate(init('closeTask'), f.deps)(); assert.deepEqual(f.state, { selected: null, review: null });
  await f.open(5, true);
  const effect = nodes(owner('TasksView'), n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0]?.getText(ast).includes('"popstate"'));
  assert.equal(effect.length, 1); const cleanup = evaluate(effect[0].arguments[0], f.deps)();
  f.win.dispatchEvent(new Event('popstate')); assert.equal(f.state.review, null); assert.equal(f.deps.openRequestRef.current.signal.aborted, true); cleanup(); noWrites(f);
});
test('actual hint is passive JSX limited to matching admin canonical editing review; mount forwards exact intent ID', () => {
  const hint = nodes(owner('TaskDetail'), n => ts.isJsxExpression(n) && n.getText(ast).includes('Arrastrar no aprueba ni publica.')).at(-1); assert.ok(hint);
  const row = task;
  assert.equal(evaluate(init('isAdmin', 'TaskDetail'), { sesion: { usuario: { id: 7, rol: 'admin' } } }), true);
  for (const actor of [{ id: 0, rol: 'admin' }, { id: 7, rol: 'edicion' }]) assert.equal(evaluate(init('isAdmin', 'TaskDetail'), { sesion: { usuario: actor } }), false);
  for (const candidate of [task, { ...task, tipo_tarea: 'diseno' }, { ...task, propiedades_extra: {} }]) {
    assert.equal(evaluate(init('usesEditingReview', 'TaskDetail'), { task: candidate, metadata: candidate.propiedades_extra }), candidate === task);
  }
  for (const variation of [{}, { reviewRequestedTaskId: 6 }, { isAdmin: false }, { usesEditingReview: false }, { task: { ...row, estado: 'aprobada' } }]) {
    const deps = { reviewRequestedTaskId: 5, isAdmin: true, usesEditingReview: true, task: row, ...variation };
    const html = renderToStaticMarkup(evaluate(hint.expression, deps));
    if (Object.keys(variation).length) assert.equal(html, ''); else { assert.match(html, /role="status"/); assert.match(html, /Arrastrar no aprueba ni publica/); assert.doesNotMatch(html, /button|input/); }
  }
  const detail = nodes(owner('TasksView'), n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'TaskDetail')[0];
  assert.equal(detail.attributes.properties.find(p => p.name?.text === 'reviewRequestedTaskId').initializer.expression.getText(ast), 'reviewRequestedTaskId');
});
