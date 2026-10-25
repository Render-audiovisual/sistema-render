import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { canRetryTaskUpdate } from '../workspace-task-state.js';
import { isTaskEditorialContext } from '../features/render-os/utils/task-editorial-context.js';
import { mergeTaskComments } from './taskCommentCollection.js';
import { createTaskCommentCreation } from './taskCommentCreation.js';
import {parseTaskCreationAck} from './taskCreationAttempt.js';
const creationId='12345678-1234-4234-8234-123456789abc';

// Extract actual callbacks from JSX; no React mount or live workflow claims.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
const nodes = (root, predicate) => { const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found; };
const component = name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const initializer = (owner, name) => nodes(component(owner), node => ts.isVariableDeclaration(node) && text(node.name) === name)[0].initializer;
const run = (node, deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const task = () => ({ id: 5, revision: 7, updated_at: '2026-10-20T10:00:00Z', estado: 'pendiente', titulo: 'Original', propiedades_extra: { workspace: 'render_os' } });
function fixture({ cookie = false, transport = async () => task() } = {}) {
  const store = createBrowserSessionState();
  const bootstrap = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'admin' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  if (cookie) bootstrap(7);
  const session = cookie ? store.getSession() : { token: 'a', usuario: { id: 7, rol: 'admin', activo: true, nombre: 'QA' } };
  let live = session, active = true, items = [task()], total = 1;
  const effects = [], requests = [], tasksRef = { current: items };
  const captureRequest = () => createCapturedRequest({ session, readSession: () => live, isActive: () => active,
    request: (url, options) => { requests.push({ url, options }); return transport(url, options); } });
  const deps = { captureRequest, isSessionFailure, isTaskEditorialContext, clients: [], users: [{ id: 9, nombre: 'Publisher', rol: 'community' }],
    sesion: session, tasksRef, createdAdmissions:{current:{ids:new Set()}},parseTaskCreationAck,
    taskQueryGenerationRef:{current:0},setLoadingMore:()=>{},setPagingBlocked:()=>{},setOrderMessage:()=>{},
    updateQueuesRef: { current: new Map() }, canRetryTaskUpdate, reviewScopeRef: { current: '' },
    setTasks: update => { items = typeof update === 'function' ? update(items) : update; effects.push('tasks'); },
    setTotalTasks: update => { total = update(total); effects.push('total'); }, notify: () => effects.push('notify'),
    mergeRelatedTasks: (current, additions) => [...current, ...additions] };
  deps.logActivity = run(initializer('WorkspaceReadOnlyPage', 'logActivity'), deps);
  deps.markReviewQueueStale = run(initializer('WorkspaceReadOnlyPage', 'markReviewQueueStale'), deps);
  for (const name of ['updateTask', 'createTask', 'productionTaskSnapshot', 'refreshProductionConflict', 'registerProduction', 'confirmProduction', 'correctProduction', 'approveTask', 'bulkTaskAction']) deps[name] = run(initializer('WorkspaceReadOnlyPage', name), deps);
  return { deps, effects, requests, captureRequest, session, get items() { return items; },
    switch() { if (cookie) { bootstrap(8); live = store.getSession(); } else live = { token: 'b', usuario: { id: 8, rol: 'admin', activo: true } }; tasksRef.current = [{ id: 5, revision: 99 }]; },
    unmount() { active = false; }, reobserve() { bootstrap(7); live = store.getSession(); } };
}

test('stable hook captures exact view session, mounted lifetime and full binding; ACK resets on binding changes, not token aliases', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const hook = text(component('useWorkspaceCapture'));
  assert.match(hook, /const view = useSessionView\(sesion\)/);
  assert.match(hook, /session: view.session, readSession: getSesion, request/);
  assert.match(hook, /mounted.current && live.current === view/);
  assert.match(hook, /mounted.current = false/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{ mounted.current = true;/,
    'parent scope is active before child passive subtask loads, including StrictMode replay');
  assert.match(hook, /\[view\]/);
  assert.doesNotMatch(source, /sesion\?\.token|observedToken|Authorization/);
  const ack = nodes(component('TaskDetail'), node => ts.isCallExpression(node) && text(node.expression) === 'useEffect')
    .find(node => /setReviewAcknowledged\(false\)/.test(text(node.arguments[0])));
  assert.ok(ack.arguments[1].elements.some(node => text(node) === 'captureRequest'));
});
test('queued updates pin original cookie/bearer before queue and cannot dispatch under B or after unmount', async () => {
  for (const cookie of [false, true]) for (const change of ['switch', 'unmount']) {
    const f = fixture({ cookie }), gate = deferred(); f.deps.updateQueuesRef.current.set(5, gate.promise);
    const result = f.deps.updateTask(5, { titulo: 'Edited' }, 'edited'); f[change](); gate.resolve();
    await assert.rejects(result, { code: 'session_binding_obsolete' });
    assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
  }
});
test('queued payload snapshot and expected CAS are retained; activity uses same original binding', async () => {
  for (const cookie of [false, true]) {
    const f = fixture({ cookie, transport: async (url, options) => options.method === 'PATCH' ? { ...task(), revision: 8 } : { id: 1 } });
    const gate = deferred(); f.deps.updateQueuesRef.current.set(5, gate.promise);
    const changes = { titulo: 'Original intent', propiedades_extra: { resumen: 'Keep' } };
    const result = f.deps.updateTask(5, changes, 'original activity'); changes.titulo = 'mutated'; changes.propiedades_extra.resumen = 'mutated'; gate.resolve(); await result;
    const body = JSON.parse(f.requests[0].options.body);
    assert.equal(body.titulo, 'Original intent'); assert.equal(body.propiedades_extra.resumen, 'Keep'); assert.equal(body.expected_revision, 7);
    assert.equal(f.requests.length, 2); assert.match(f.requests[1].url, /comentarios/);
    assert.equal(JSON.parse(f.requests[1].options.body).contenido, '[Actividad] original activity');
    if (cookie) { assert.equal(f.requests[0].options.sessionIntent.session, f.session); assert.equal(f.requests[1].options.sessionIntent.session, f.session); assert.equal(f.requests[0].options.headers.Authorization, undefined); }
    else assert.equal(f.requests[1].options.headers.Authorization, 'Bearer a');
  }
});
test('late success/error from task write never refreshes, rolls back, logs or notifies a replacement identity', async () => {
  for (const cookie of [false, true]) for (const status of [null, 409, 500]) {
    const pending = deferred(), started = deferred();
    const f = fixture({ cookie, transport: () => { started.resolve(); return pending.promise; } });
    const result = f.deps.updateTask(5, { titulo: 'Edited' }, 'edited'); await started.promise;
    f.switch(); if (status) pending.reject(Object.assign(Error('old failure'), { status })); else pending.resolve(task());
    await assert.rejects(result); assert.equal(f.requests.length, 1); assert.deepEqual(f.effects, ['tasks']); assert.equal(f.deps.tasksRef.current[0].revision, 99);
  }
});
test('same cookie context reobserved generation is obsolete even when ID/role remain equal', async () => {
  const pending = deferred(), f = fixture({ cookie: true, transport: () => pending.promise });
  const result = f.deps.createTask({ titulo: 'A',request_id:creationId }); f.reobserve(); pending.resolve(task());
  await assert.rejects(result); assert.deepEqual(f.effects, []);
});
test('session errors never enter retry/refetch/rollback or notify even with a still-current local DTO', async () => {
  for (const name of ['BrowserSessionError', 'ApplicationSessionError']) {
    const f = fixture({ transport: async () => { throw Object.assign(Error('session transport'), { name, status: 409 }); } });
    await assert.rejects(f.deps.updateTask(5, { titulo: 'Edited' }, null));
    assert.equal(f.requests.length, 1); assert.deepEqual(f.effects, ['tasks']);
  }
});
test('ordinary safe 409 retry preserves eligibility and refreshed CAS, never approval rebase', async () => {
  let patches = 0;
  const f = fixture({ transport: async (_url, options) => {
    if (options.method === 'PATCH' && ++patches === 1) throw Object.assign(Error('conflict'), { status: 409 });
    return { ...task(), revision: options.method ? 9 : 8 };
  } });
  await f.deps.updateTask(5, { titulo: 'Edited' }, null);
  assert.equal(patches, 2); assert.equal(JSON.parse(f.requests[2].options.body).expected_revision, 8);
  const approval = fixture({ transport: async (_url, options) => { if (options.method) throw Object.assign(Error('conflict'), { status: 409 }); return { ...task(), revision: 8 }; } });
  await assert.rejects(approval.deps.updateTask(5, { estado: 'aprobada' }, null, 7));
  assert.equal(approval.requests.filter(item => item.options.method === 'PATCH').length, 1);
});
test('creation, approval, production and bulk actions suppress every late effect after identity replacement', async () => {
  for (const name of ['createTask', 'approveTask', 'registerProduction', 'confirmProduction', 'correctProduction', 'bulkTaskAction']) {
    const pending = deferred(), f = fixture({ cookie: true, transport: () => pending.promise });
    const args = { createTask: [{ titulo: 'A',request_id:creationId }], approveTask: [task(), 9], registerProduction: [task(), 2, '2026-10-20'],
      confirmProduction: [task()], correctProduction: [task(), { id: 'record', cantidad: 1 }, 2], bulkTaskAction: [[5], 'papelera'] };
    const result = f.deps[name](...args[name]); f.switch(); pending.resolve({ ...task(), task: task(), ids: [5] });
    await assert.rejects(result); assert.equal(f.requests.length, 1, name); assert.deepEqual(f.effects, [], name);
  }
});
test('production 409 refresh is bound to original actor and never automatically repeats a write', async () => {
  const f = fixture({ transport: async (_url, options) => { if (options.method) throw Object.assign(Error('conflict'), { status: 409 }); return { ...task(), revision: 8 }; } });
  await assert.rejects(f.deps.registerProduction(task(), 2, '2026-10-20'));
  assert.deepEqual(f.requests.map(item => item.options.method || 'GET'), ['POST', 'GET']);
  assert.equal(f.deps.tasksRef.current[0].revision, 8);
});
test('comments late result cannot repaint, clear draft/error or busy state after detail unmount', async () => {
  const pending = deferred(), f = fixture({ transport: () => pending.promise }), effects = [];
  const creation = createTaskCommentCreation({ capture: f.captureRequest, randomUUID: () => '12345678-1234-4123-8123-123456789abc',
    onState: state => { effects.push(['busy', state.busy], ['error', state.error]); } });
  const add = run(initializer('TaskDetail', 'addComment'), { acceptCommentCreation: () => effects.push('accepted'), mergeTaskComments, commentDraftOwner: { current: { creation, taskId: task().id, captureRequest: f.captureRequest, generation: 0 } }, captureRequest: f.captureRequest, comment: 'keep draft', commenting: false,
    task: task(), sesion: f.session, setCommenting: value => effects.push(['busy', value]), setCommentError: value => effects.push(['error', value]),
    setComments: () => effects.push('comments'), setComment: () => effects.push('draft') });
  const result = add(); f.unmount(); pending.resolve({ id: 1 }); await result;
  assert.deepEqual(effects, [['busy', true], ['error', '']]);
});
test('Drive callback uses upload original scope, with no new capture; old uploads cannot refetch or emit global events', async () => {
  const node = nodes(component('TaskDetail'), node => ts.isFunctionDeclaration(node) && node.name?.text === 'refreshUploadedTask')[0];
  assert.doesNotMatch(text(node), /captureRequest/);
  assert.match(source, /onUploaded=\{refreshUploadedTask\}/);
  const pending = deferred(), f = fixture(), events = [];
  const uploadScope = f.captureRequest();
  const refresh = run(node, { task: task(), apiTaskById: (_id, options) => { assert.equal(options.headers.Authorization, 'Bearer a'); return pending.promise; },
    window: { dispatchEvent: value => events.push(value) }, CustomEvent: class {} });
  const result = refresh({}, uploadScope); f.switch(); pending.resolve(task()); await assert.rejects(result); assert.deepEqual(events, []);
  await assert.rejects(refresh({}, uploadScope));
});
test('paged GETs pass pinned options and keep query generation guards; all raw task requests delegated', () => {
  const calls = nodes(component('WorkspaceReadOnlyPage'), node => ts.isCallExpression(node) && text(node.expression) === 'apiTaskPage');
  assert.equal(calls.length, 2); for (const call of calls) assert.equal(text(call.arguments[1]), 'guard.options()');
  const more = text(initializer('WorkspaceReadOnlyPage', 'loadMoreTasks'));
  assert.match(more, /guard.assertCurrent\(\)/); assert.match(more, /generation !== taskQueryGenerationRef.current/);
  assert.match(more, /guard.current\(\) && !isSessionFailure\(reason\) && generation === taskQueryGenerationRef.current/);
  assert.equal(nodes(file, node => ts.isCallExpression(node) && ['apiRequest', 'apiJson'].includes(text(node.expression))).length, 0);
});
