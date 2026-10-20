import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createLoginAttempts, LOGIN_FAILURE_MESSAGE } from './login-attempt.js';
import { createApplicationSession } from './application-session.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const user = id => ({ id, usuario: `qa${id}`, nombre: 'QA', rol: 'community' });
const response = id => ({ ok: true, json: async () => ({ token: `token${id}`, usuario: user(id) }) });
function setup(extra = {}) {
  const events = [], states = [];
  const attempts = createLoginAttempts({ getRuntime: () => null, request: async () => response(1), readSession: () => null,
    save: (...args) => events.push(['save', ...args]), navigate: value => events.push(['navigate', value]),
    onState: value => states.push(value), ...extra });
  attempts.mount(); return { attempts, events, states };
}
test('legacy password and Google use fixed endpoints, closed bodies and actual response before saving', async () => {
  for (const kind of ['password', 'google']) {
    let options;
    const { attempts, events } = setup({ request: async (url, value) => {
      assert.equal(url, kind === 'password' ? '/api/login' : '/api/login/google'); options = value; return response(7);
    } });
    assert.equal(await attempts.login(kind, { usuario: 'qa', password: 'secret', credential: 'proof', rol: 'admin' }), true);
    assert.deepEqual(JSON.parse(options.body), kind === 'password' ? { usuario: 'qa', password: 'secret' } : { credential: 'proof' });
    assert.ok(options.signal instanceof AbortSignal); assert.equal(events[0][0], 'save'); assert.equal(events[1][1].id, 7);
  }
});
test('late A cannot overwrite B even when transport ignores abort', async () => {
  const a = deferred(); let count = 0;
  const { attempts, events } = setup({ request: () => ++count === 1 ? a.promise : Promise.resolve(response(2)) });
  const first = attempts.login('password', { usuario: 'a', password: 'x' });
  await attempts.login('password', { usuario: 'b', password: 'x' });
  a.resolve(response(1)); assert.equal(await first, false);
  assert.deepEqual(events.map(event => event[0]), ['save', 'navigate']); assert.equal(events[1][1].id, 2);
});
test('cleanup during response body suppresses every late UI, save and navigation; remount invalidates old generation', async () => {
  const body = deferred();
  const { attempts, events, states } = setup({ request: async () => ({ ok: true, json: () => body.promise }) });
  const pending = attempts.login('google', { credential: 'proof' }); await Promise.resolve();
  attempts.cleanup(); const count = states.length; attempts.mount();
  body.resolve({ token: 'old', usuario: user(1) }); assert.equal(await pending, false);
  assert.equal(states.length, count); assert.deepEqual(events, []);
  attempts.cleanup(); assert.equal(await attempts.login('google', { credential: 'late' }), false);
});
test('a new independently published legacy account is never overwritten', async () => {
  const pending = deferred(); let live = null;
  const { attempts, events } = setup({ readSession: () => live, request: () => pending.promise });
  const login = attempts.login('password', { usuario: 'a', password: 'x' });
  live = { token: 'new', usuario: user(2) }; pending.resolve(response(1));
  assert.equal(await login, false); assert.deepEqual(events, []);
});
test('browser uses runtime only, checks exact published result, and cleanup never disposes verified session', async () => {
  const session = { usuario: user(3) }; let live = session, options;
  const runtime = { mode: 'browser', getSession: () => live, login: async value => { options = value; return { ok: true, session }; },
    dispose: () => assert.fail('global disposal forbidden') };
  const { attempts, events } = setup({ getRuntime: () => runtime, request: () => assert.fail('legacy fetch forbidden'), save: () => assert.fail('bearer persistence forbidden') });
  assert.equal(await attempts.login('google', { credential: 'proof' }), true);
  assert.deepEqual(options.body, { credential: 'proof' }); assert.equal(options.kind, 'google');
  attempts.cleanup(); assert.equal(live, session); assert.equal(events.length, 1);
  attempts.mount(); live = { ...session }; assert.equal(await attempts.login('google', { credential: 'proof' }), false);
  assert.equal(events.length, 1);
});
test('browser pending cancellation or runtime replacement cannot navigate', async () => {
  for (const cleanup of [true, false]) {
    const pending = deferred(), session = { usuario: user(1) };
    let runtime = { mode: 'browser', login: () => pending.promise, getSession: () => session };
    const { attempts, events, states } = setup({ getRuntime: () => runtime });
    const result = attempts.login('password', { usuario: 'a', password: 'x' });
    if (cleanup) attempts.cleanup(); else runtime = { ...runtime };
    const count = states.length; pending.resolve({ ok: true, session });
    assert.equal(await result, false); assert.deepEqual(events, []); assert.equal(states.length, count);
  }
});
test('real browser controller publication survives synchronous page cleanup without cookie withdrawal', async () => {
  const dto = { usuario: user(7), session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) };
  const calls = [];
  const runtime = createApplicationSession({ mode: 'browser', location: { origin: 'https://render.test' },
    locks: { request: async (_name, _options, work) => work() },
    fetchImpl: async path => {
      calls.push(path);
      return new Response(JSON.stringify(path === '/api/sesion/desafio' ? { csrf_token: dto.csrf_token } : dto), {
        headers: { 'X-Render-Session-Context': dto.session_context },
      });
    },
  });
  const { attempts, events, states } = setup({ getRuntime: () => runtime,
    request: () => assert.fail('no legacy transport'), save: () => assert.fail('no bearer persistence') });
  let stateCount;
  const unsubscribe = runtime.subscribe(() => {
    if (runtime.getSession()) { attempts.cleanup(); stateCount = states.length; }
  });
  assert.equal(await attempts.login('password', { usuario: 'qa', password: 'fixture' }), false);
  assert.equal(runtime.getSession().usuario.id, 7);
  assert.equal(states.length, stateCount); assert.deepEqual(events, []);
  assert.deepEqual(calls, ['/api/sesion/desafio', '/api/login/browser', '/api/sesion']);
  unsubscribe(); runtime.dispose();
});
test('failures never expose server/provider/private messages or persist malformed credentials', async () => {
  for (const request of [async () => { throw new Error('secret SQL'); }, async () => ({ ok: false, json: () => assert.fail('private error body') }),
    async () => ({ ok: true, json: async () => ({ token: 'x', usuario: { rol: 'admin' } }) })]) {
    const { attempts, events, states } = setup({ request });
    assert.equal(await attempts.login('password', { usuario: 'a', password: 'secret' }), false);
    assert.equal(states.find(state => state.error)?.error, LOGIN_FAILURE_MESSAGE); assert.deepEqual(events, []);
    assert.doesNotMatch(JSON.stringify(states), /secret|SQL/);
  }
});
test('actual Login wires accessor and attempt lifecycle; Google callbacks and script listeners are cleaned', () => {
  const source = readFileSync(new URL('../../pages/Login.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('Login.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(source, /from "..\/shared\/session\/application-session-access.js"/);
  assert.match(source, /getRuntime: getApplicationSession/); assert.match(source, /save: guardarSesion/);
  assert.match(source, /attempts\.mount\(\)/); assert.match(source, /return \(\) => attempts.cleanup\(\)/);
  assert.match(source, /attemptsRef.current.login\(kind, body\)/);
  assert.match(source, /if \(active\) handleGoogleCredential\(response\)/);
  assert.match(source, /active = false/); assert.match(source, /removeEventListener\('load', renderBoton\)/);
  assert.doesNotMatch(source, /\.dispose\(|guardarSesion\(|console\.|localStorage|\/api\/login/);
});
test('actual pending prop blocks new form/Google attempts without recreating or cleaning the active attempt', () => {
  const source = readFileSync(new URL('../../pages/Login.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('Login.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const all = [];
  const visit = node => { all.push(node); ts.forEachChild(node, visit); }; visit(file);
  const text = node => node.getText(file);
  assert.match(source, /LoginPage\(\{ sessionPending = false \}\)/);
  assert.match(source, /sessionPendingRef.current = sessionPending/);
  assert.match(source, /disabled=\{cargando \|\| sessionPending\}/);
  for (const name of ['handleSubmit', 'handleGoogleCredential']) {
    const declaration = all.find(node => ts.isVariableDeclaration(node) && text(node.name) === name);
    const callback = ts.isCallExpression(declaration.initializer) ? declaration.initializer.arguments[0] : declaration.initializer;
    const statements = callback.body.statements;
    const guard = statements.findIndex(node => ts.isIfStatement(node) && text(node.expression) === 'sessionPendingRef.current');
    const dispatch = statements.findIndex(node => text(node).includes('iniciarSesion('));
    assert.ok(guard >= 0 && guard < dispatch, `${name} refuses pending before starting an attempt`);
  }
  const effects = all.filter(node => ts.isCallExpression(node) && text(node.expression) === 'useEffect');
  const lifecycle = effects.find(node => text(node.arguments[0]).includes('attempts.cleanup()'));
  assert.equal(text(lifecycle.arguments[1]), '[]', 'Pending changes must never abort the current login');
  for (const effect of effects) assert.doesNotMatch(text(effect.arguments[1]), /sessionPending/);
});
