import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createCapturedRequest } from '../../shared/session/captured-request.js';
import { createBrowserSessionState } from '../../shared/session/browser-session-state.js';
const ts = createRequire(new URL('../../../package.json', import.meta.url))('typescript');
const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const assistant = parse('./WilsonAssistant.jsx'), admin = parse('../../pages/WilsonConversations.jsx');
function nodes(root, predicate) { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); } visit(root); return result; }
function evaluate(node, context) { return new Function(...Object.keys(context), `return (${node.getText()});`)(...Object.values(context)); }
function callback(file, name, context) {
  const declaration = nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === name);
  assert.ok(declaration, `Actual callback ${name} exists`);
  const expression = declaration.initializer;
  return evaluate(ts.isCallExpression(expression) ? expression.arguments[0] : expression, context);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function fixture(file = assistant, mode = 'cookie') {
  const store = createBrowserSessionState(), calls = [], state = {}, effects = [];
  let session;
  const accept = (id = 7) => {
    if (mode === 'bearer') session = { token: `synthetic-${id}`, usuario: { id, rol: 'admin', activo: true } };
    else { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, { usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'admin' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); session = store.getSession(); }
  };
  accept(); const original = session, view = {}, currentView = { current: view }, mounted = { current: true }, controllers = { current: new Set() };
  const context = { session: original, view, currentView, mounted, controllers, createCapturedRequest,
    getSesion: () => session, apiRequest: (url, options) => { const d = deferred(); calls.push({ url, options, ...d }); return d.promise; },
    busy: { current: false }, unreadGeneration: { current: 0 }, attemptedRef: { current: false },
    usersGeneration: { current: 0 }, messagesGeneration: { current: 0 }, pendingReset: { current: false }, selectedRef: { current: null },
    input: 'Question', data: { summary: {} },
  };
  for (const name of ['Unread', 'Loading', 'Error', 'Data', 'Messages', 'Input', 'Users', 'Selected', 'ResetOpen', 'Notice', 'Resetting']) {
    state[name] = name === 'Messages' || name === 'Users' ? [] : null;
    context[`set${name}`] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; effects.push(name); };
  }
  context.captureRequest = callback(file, 'captureRequest', context);
  if (file === assistant) context.markAsRead = callback(file, 'markAsRead', context);
  return { context, calls, state, effects, store, original, accept,
    run: name => callback(file, name, context),
    unmount() { mounted.current = false; for (const controller of controllers.current) controller.abort(); },
  };
}
const answer = { priorities: { summary: {}, recommendations: [] }, messages: [], tasks: [],
  assistantMessage: { id: 41, contenido: 'Actual response', metadata: {}, created_at: '2026-10-20T12:00:00Z' },
  message: { id: 42, contenido: 'Prepared', created_at: '2026-10-20T12:00:00Z' }, confirmation: { token: 'proposal-actual', task_id: 10 } };

test('actual submit and follow-up read receipt share original genuine cookie intent and preserve message payload', async () => {
  const h = fixture(), submit = h.run('submit'), pending = submit('Exact question');
  assert.equal(h.calls.length, 1); const sent = h.calls[0];
  assert.equal(sent.url, '/api/wilson/mensajes'); assert.deepEqual(JSON.parse(sent.options.body), { contenido: 'Exact question' });
  assert.equal(h.store.isCurrent(sent.options.sessionIntent), true);
  assert.equal(new Headers(sent.options.headers).has('Authorization'), false);
  sent.resolve(answer); await settle(); assert.equal(h.calls[1].url, '/api/wilson/conversacion/leida');
  assert.equal(h.calls[1].options.sessionIntent, sent.options.sessionIntent);
  h.calls[1].resolve({ ok: true }); await pending;
  assert.equal(h.state.Messages.at(-1).id, 41); assert.equal(h.state.Loading, false);
});

const actions = [
  ['loadRecommendations', []], ['submit', ['Exact question']],
  ['prepareProduction', [{ id: 10 }, { amount: 3 }]], ['confirmAction', [{ token: 'actual/token', task_id: 10 }]],
];
for (const [name, args] of actions) for (const outcome of ['success', 'failure', 'unmount']) test(`${name}: late ${outcome} cannot publish or dispatch read receipt under replacement`, async () => {
  const h = fixture(), pending = h.run(name)(...args); assert.equal(h.calls.length, 1);
  const effects = h.effects.length;
  if (outcome === 'unmount') { h.unmount(); assert.equal(h.calls[0].options.signal.aborted, true); } else h.accept(8);
  if (outcome === 'failure') h.calls[0].reject(new Error('Old private error')); else h.calls[0].resolve(answer);
  await pending; assert.equal(h.calls.length, 1); assert.equal(h.effects.length, effects);
});

test('real busy ref prevents two same-tick message/confirmation mutations', async () => {
  const h = fixture(), submit = h.run('submit'); const first = submit('one');
  await submit('two'); await h.run('confirmAction')({ token: 'proposal' }); assert.equal(h.calls.length, 1);
  h.calls[0].resolve(answer); await settle(); h.calls[1].resolve({ ok: true }); await first;
});

test('unread race cannot restore earlier count after mark-read; legacy binding retains captured Authorization', async () => {
  const h = fixture(assistant, 'bearer'), unread = h.run('loadUnread')();
  const read = h.context.markAsRead();
  assert.equal(h.calls[0].url, '/api/wilson/notificaciones');
  assert.equal(h.calls[1].url, '/api/wilson/conversacion/leida');
  assert.equal(new Headers(h.calls[1].options.headers).get('Authorization'), 'Bearer synthetic-7');
  h.calls[1].resolve({ ok: true }); await read;
  h.calls[0].resolve({ no_leidos: 99 }); await unread; assert.equal(h.state.Unread, 0);
});

test('prepare and confirm retain task ID, amount and confirmation token; no inferred account identity', async () => {
  const h = fixture(), pending = h.run('prepareProduction')({ id: 910 }, { amount: 3 });
  const body = JSON.parse(h.calls[0].options.body);
  assert.equal(body.tarea_id, 910); assert.equal(body.cantidad, 3); assert.match(body.fecha, /^\d{4}-\d{2}-\d{2}$/);
  h.calls[0].resolve(answer); await settle(); h.calls[1].resolve({ ok: true }); await pending;
  const confirm = h.run('confirmAction')({ token: 'proposal/token', task_id: 910 });
  assert.equal(h.calls[2].url, '/api/wilson/confirmaciones/proposal%2Ftoken');
  h.calls[2].resolve(answer); await settle(); h.calls[3].resolve({ ok: true }); await confirm;
});

test('admin users load is bound and late A rows/error cannot select a person after B', async () => {
  for (const outcome of ['success', 'failure']) {
    const h = fixture(admin), pending = h.run('loadUsers')(); const count = h.effects.length;
    assert.equal(h.calls[0].url, '/api/wilson/conversaciones'); h.accept(8);
    if (outcome === 'failure') h.calls[0].reject(new Error('Private A rows')); else h.calls[0].resolve([{ id: 11, nombre: 'Old person' }]);
    await pending; assert.equal(h.effects.length, count);
  }
});

test('admin reset preserves DELETE contract, blocks same-tick duplicate and cannot publish after account replacement', async () => {
  for (const replace of [false, true]) {
    const h = fixture(admin), reset = h.run('resetConversations'), pending = reset(); await reset();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.method, 'DELETE');
    const count = h.effects.length; if (replace) h.accept(8);
    h.calls[0].resolve({ conversations_deleted: 3 }); await pending;
    if (replace) assert.equal(h.effects.length, count);
    else { assert.equal(h.state.Selected, null); assert.deepEqual(h.state.Messages, []); assert.match(h.state.Notice, /3 conversaciones/); }
  }
});

test('admin selection effect fences previous person responses and reset invalidates pending lists', async () => {
  const h = fixture(admin);
  const effect = nodes(admin, ts.isCallExpression).find(n => n.expression.getText() === 'useEffect'
    && n.arguments[0]?.getText().includes('encodeURIComponent(selected.id)')).arguments[0];
  const first = { id: 11 }, second = { id: 12 };
  h.context.selectedRef.current = first;
  const cleanFirst = evaluate(effect, { ...h.context, selected: first })();
  cleanFirst(); h.context.selectedRef.current = second;
  const cleanSecond = evaluate(effect, { ...h.context, selected: second })();
  h.calls[1].resolve({ messages: [{ id: 2, contenido: 'second' }] }); await settle();
  h.calls[0].resolve({ messages: [{ id: 1, contenido: 'late first' }] }); await settle();
  assert.deepEqual(h.state.Messages, [{ id: 2, contenido: 'second' }]); cleanSecond();
  const loading = h.run('loadUsers')(), reset = h.run('resetConversations')();
  h.calls[3].resolve({ conversations_deleted: 2 }); await reset;
  h.calls[2].resolve([{ id: 11, nombre: 'Must not restore' }]); await loading;
  assert.deepEqual(h.state.Users, []); assert.equal(h.state.Selected, null);
});

test('Wilson components scope business state by actual session view and keep only position in local preferences', () => {
  for (const file of [assistant, admin]) {
    const source = file.getText(); assert.match(source, /useSessionView\(getSesion\(\)\)/);
    assert.match(source, /key=\{view.key\}/); assert.match(source, /currentView.current === view/);
    assert.match(source, /mounted.current = false/); assert.match(source, /controller.abort\(\)/);
    assert.doesNotMatch(source, /render_sesion|\.token\s*\|\||Authorization:/);
    const directApi = nodes(file, ts.isCallExpression).filter(n => n.expression.getText() === 'apiRequest');
    assert.equal(directApi.length, 1, 'Only captured transport invokes raw API');
  }
  assert.match(assistant.getText(), /render_wilson_position/);
});

test('real assistant lifecycle StrictMode replay cannot revive aborted A guard and allows a fresh recommendation request', async () => {
  const h = fixture();
  const lifecycle = nodes(assistant, ts.isCallExpression).find(n => n.expression.getText() === 'useEffect'
    && n.arguments[0]?.getText().includes('mounted.current = true')).arguments[0];
  const setup = evaluate(lifecycle, h.context), cleanup = setup();
  const first = h.run('loadRecommendations')(); assert.equal(h.calls.length, 1);
  cleanup(); assert.equal(h.calls[0].options.signal.aborted, true);
  const cleanupAgain = setup(); const second = h.run('loadRecommendations')();
  assert.equal(h.calls.length, 2); const effects = h.effects.length;
  h.calls[0].resolve(answer); await first; assert.equal(h.effects.length, effects);
  assert.equal(h.context.busy.current, true, 'Old finally cannot unlock the replacement request');
  h.calls[1].resolve(answer); await settle(); assert.equal(h.calls.length, 3);
  h.calls[2].resolve({ ok: true }); await second;
  assert.equal(h.state.Loading, false); cleanupAgain();
});

test('read-notification callback after unmount remains obsolete even if mounted ref becomes true again', async () => {
  const h = fixture(), pending = h.run('loadUnread')();
  h.unmount(); h.context.mounted.current = true;
  const count = h.effects.length; h.calls[0].resolve({ no_leidos: 99 }); await pending;
  assert.equal(h.effects.length, count);
});
