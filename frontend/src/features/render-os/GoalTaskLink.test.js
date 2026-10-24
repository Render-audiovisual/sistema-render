import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../../shared/session/captured-request.js';
import { createBrowserSessionState } from '../../shared/session/browser-session-state.js';
import { isTaskEditorialContext } from './utils/task-editorial-context.js';

// Execute actual JSX callbacks with injected effects. No React mount/API workflow claim.
const source = readFileSync(new URL('./GoalTaskLink.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('GoalTaskLink.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
const nodes = (root, predicate) => { const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result; };
const component = name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const callback = (owner, name) => nodes(component(owner), node => ts.isVariableDeclaration(node) && text(node.name) === name)[0].initializer;
const execute = (node, bindings) => new Function(...Object.keys(bindings), `return (${text(node)});`)(...Object.values(bindings));
const readEffect = nodes(component('LinkDialog'), node => ts.isCallExpression(node) && text(node.expression) === 'useEffect')
  .find(node => text(node.arguments[0]).includes('/vinculo?periodo='));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture({ cookie = false, request = async () => ({ linked: true }) } = {}) {
  const store = createBrowserSessionState();
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'community' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  if (cookie) accept(7);
  const session = cookie ? store.getSession() : { token: 'a', usuario: { id: 7, rol: 'community', activo: true } };
  let live = session, opened;
  const task = { id: 5, cliente_id: 2 }, currentTask = { current: task.id }, parentMounted = { current: true }, mounted = { current: true };
  const requests = [], effects = [], submitLock = { current: false };
  const apiRequest = (url, options) => { requests.push({ url, options }); return request(url, options); };
  const open = execute(callback('GoalTaskLink', 'openDialog'), { task, canManage:true, isTaskEditorialContext, mounted: parentMounted, currentTask, getSesion: () => live,
    createCapturedRequest, apiRequest, setOpen: value => { opened = value; } });
  open();
  const common = { task, scope: opened.scope, mounted, isSessionFailure, submitLock,
    setLoading: value => effects.push(['loading', value]), setError: value => effects.push(['error', value]),
    setData: value => effects.push(['data', value]), setSelected: value => effects.push(['selected', value]),
    setSaving: value => effects.push(['saving', value]), setResult: value => effects.push(['result', value]) };
  return { requests, effects, session, scope: opened.scope, submitLock, currentTask, parentMounted, mounted,
    read: period => execute(readEffect.arguments[0], { ...common, period })(),
    submit: (data = { tarea: { updated_at: 'task-cas' } }, slot = { id: 19, updated_at: 'piece-cas' }) =>
      execute(callback('LinkDialog', 'submit'), { ...common, data, slot })({ preventDefault() {} }),
    switch() { if (cookie) { accept(8); live = store.getSession(); } else live = { token: 'b', usuario: { id: 8, rol: 'community', activo: true } }; },
    reobserve() { accept(7); live = store.getSession(); },
    unmount() { mounted.current = false; parentMounted.current = false; } };
}

test('actual opener captures once from genuine runtime-backed reader; dialog receives the same original scope', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const opener = text(callback('GoalTaskLink', 'openDialog'));
  assert.match(opener, /session: getSesion\(\), readSession: getSesion, request: apiRequest/);
  assert.match(opener, /mounted.current && currentTask.current === taskId/);
  assert.match(source, /scope=\{open.scope\}/);
  assert.match(source, /onClick=\{openDialog\}/);
  assert.doesNotMatch(text(component('LinkDialog')), /getSesion|\.token|Authorization|createCapturedRequest|localStorage|\.dispose\(/);
  assert.match(source, /if \(!canManage \|\| !task.cliente_id \|\| task.historia_id \|\| task.tipo_tarea === 'produccion' \|\| !isTaskEditorialContext\(task\)\) return null/);
  assert.match(source, /expected_tarea_updated_at:data.tarea.updated_at, expected_pieza_updated_at:slot.updated_at/);
  assert.match(source, /isTaskCompleted\(data.tarea\)/);
});
test('actual opener cannot bypass editorial context or management permission to open monthly consultation',()=>{
  for(const [task,canManage] of [[{id:5,cliente_id:2,tipo_tarea:'desarrollo'},true],[{id:5,cliente_id:2,subtipo:'chatbot'},true],[{id:5,cliente_id:2,tipo_tarea:'diseno'},false]]){
    const open=execute(callback('GoalTaskLink','openDialog'),{task,canManage,isTaskEditorialContext,
      getSesion:()=>assert.fail('No session/transport capture for excluded context'),setOpen:()=>assert.fail('No dialog')});
    open();
  }
});
test('exterior is a neutral consultation; authoritative dialog still distinguishes an existing link', () => {
  const exterior = text(component('GoalTaskLink'));
  assert.match(exterior, /<strong>Objetivo del mes<\/strong>/);
  assert.match(exterior, /Consultá si esta pieza ya cuenta en un objetivo mensual\./);
  assert.match(exterior, /onClick=\{openDialog\}>Consultar vínculo mensual<\/button>/);
  assert.doesNotMatch(exterior, /Hacé que esta pieza cuente|Vincular al objetivo mensual/);
  const dialog = text(component('LinkDialog'));
  assert.match(dialog, /data\?\.vinculo_actual \? <p role="status">Esta pieza ya cuenta/);
  assert.match(dialog, /disabled=\{loading \|\| saving \|\| !slot \|\| Boolean\(data\?\.vinculo_actual\)\}/);
});
test('actual GET and POST retain URLs, IDs, period, CAS and original bearer/cookie intent', async () => {
  for (const cookie of [false, true]) {
    const f = fixture({ cookie }); const cleanup = f.read('2026-10'); await settle();
    await f.submit();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].url, '/api/cliente-objetivos/tareas/5/vinculo?periodo=2026-10');
    assert.ok(f.requests[0].options.signal instanceof AbortSignal);
    assert.equal(f.requests[1].url, '/api/cliente-objetivos/piezas/19/vincular');
    assert.equal(f.requests[1].options.method, 'POST');
    assert.deepEqual(JSON.parse(f.requests[1].options.body), { tarea_id: 5, expected_tarea_updated_at: 'task-cas', expected_pieza_updated_at: 'piece-cas' });
    assert.equal(f.requests[1].options.headers['Content-Type'], 'application/json');
    for (const { options } of f.requests) {
      if (cookie) { assert.equal(options.sessionIntent.session, f.session); assert.equal(options.headers.Authorization, undefined); }
      else assert.equal(options.headers.Authorization, 'Bearer a');
    }
    assert.ok(f.effects.some(([key]) => key === 'result')); cleanup();
  }
});
test('late GET success/error cannot publish data, errors or loading after A→B, unmount or period cleanup', async () => {
  for (const cookie of [false, true]) for (const change of ['switch', 'unmount', 'cleanup']) for (const fail of [false, true]) {
    const pending = deferred(), f = fixture({ cookie, request: () => pending.promise });
    const cleanup = f.read('2026-10'); const initial = [...f.effects];
    if (change === 'cleanup') cleanup(); else f[change]();
    if (fail) pending.reject(Error('old private failure')); else pending.resolve({ casilleros: [] });
    await settle(); assert.deepEqual(f.effects, initial); assert.equal(f.requests.length, 1);
  }
});
test('late POST success/error cannot show success, error or busy paint after account change or unmount', async () => {
  for (const cookie of [false, true]) for (const change of ['switch', 'unmount']) for (const fail of [false, true]) {
    const pending = deferred(), f = fixture({ cookie, request: () => pending.promise });
    const result = f.submit(); const initial = [...f.effects]; f[change]();
    if (fail) pending.reject(Object.assign(Error('old error'), { status: 409 })); else pending.resolve({ linked: true });
    await result; assert.deepEqual(f.effects, initial); assert.equal(f.requests.length, 1);
  }
});
test('cached A selection cannot send POST or start another GET under B; same-context cookie rebootstrap is also obsolete', async () => {
  for (const cookie of [false, true]) {
    const f = fixture({ cookie }); f.switch(); await f.submit(); const cleanup = f.read('2026-11');
    assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []); cleanup();
  }
  const f = fixture({ cookie: true }); f.reobserve(); await f.submit(); assert.deepEqual(f.requests, []);
});
test('task identity replacement and parent cleanup invalidate original scope without constructing new authority', async () => {
  for (const change of [f => { f.currentTask.current = 6; }, f => { f.parentMounted.current = false; }]) {
    const f = fixture(); change(f); await f.submit(); assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
  }
});
test('current conflict or session transport error never retries/refetches/rebases; session message is bounded', async () => {
  for (const name of ['Error', 'BrowserSessionError', 'ApplicationSessionError']) {
    const f = fixture({ request: async () => { throw Object.assign(Error('private provider response'), { status: 409, name }); } });
    await f.submit(); assert.equal(f.requests.length, 1);
    assert.equal(f.effects.some(([key]) => key === 'result'), false); assert.equal(f.submitLock.current, false);
    const message = f.effects.find(([key, value]) => key === 'error' && value)?.[1];
    assert.equal(message, name === 'Error' ? 'private provider response' : 'La sesión no pudo verificarse. Volvé a abrir la vinculación.');
    assert.deepEqual(JSON.parse(f.requests[0].options.body), { tarea_id: 5, expected_tarea_updated_at: 'task-cas', expected_pieza_updated_at: 'piece-cas' });
  }
});
test('submit locking prevents duplicate writes while original request is pending', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise });
  const result = f.submit(); await f.submit(); assert.equal(f.requests.length, 1);
  pending.resolve({ linked: true }); await result;
  assert.equal(f.submitLock.current, false);
});
test('read cleanup cancels transport; effects depend on stable captured scope and preserve focus/keyboard cleanup', () => {
  assert.deepEqual(readEffect.arguments[1].elements.map(text), ['task.id', 'period', 'scope']);
  assert.match(text(readEffect), /return \(\) => controller.abort\(\)/);
  assert.match(source, /mounted.current = false/);
  assert.match(source, /if \(outer\) outer.inert = wasInert/);
  assert.match(source, /previousFocus\?\.focus/);
  assert.match(source, /event.key === 'Escape'/); assert.match(source, /event.key === 'Tab'/);
});
