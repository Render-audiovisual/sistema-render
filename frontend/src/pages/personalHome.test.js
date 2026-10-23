import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPersonalHomeLoader, subscribePersonalHomeRefresh } from './personalHome.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { captureSessionBinding } from '../shared/session/session-binding.js';
const ts = createRequire(new URL('../../package.json', import.meta.url))('typescript');
const sourceFile = name => ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const compact = node => node.getText().replace(/\s+/g, '');

test('QuickHome captures the stable view and fences bound requests before and after HTTP', () => {
  const file = sourceFile('./QuickHome.jsx');
  const calls = nodes(file, ts.isCallExpression);
  assert.ok(calls.some(n => n.expression.getText() === 'useSessionView' && n.arguments[0]?.getText() === 'sesion'));
  const scope = nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === 'scopedRequest').initializer;
  const statements = scope.body.statements;
  const awaited = statements.findIndex(n => nodes(n, ts.isAwaitExpression).length > 0);
  assert.ok(awaited > 0);
  assert.ok(statements.slice(0, awaited).some(n => ts.isIfStatement(n) && compact(n.expression) === '!current()'));
  assert.ok(statements.slice(awaited + 1).some(n => ts.isIfStatement(n) && compact(n.expression) === '!current()'));
  assert.ok(nodes(scope, ts.isCallExpression).some(n => n.expression.getText() === 'sessionRequestOptions' && n.arguments[0]?.getText() === 'captured.binding'));
  assert.ok(nodes(scope, ts.isCallExpression).some(n => n.expression.getText() === 'sessionBindingMatches' && compact(n.arguments[1]) === 'getSesion()'));
  const loader = calls.find(n => n.expression.getText() === 'createPersonalHomeLoader').arguments[0];
  const properties = new Map(loader.properties.map(p => [p.name.getText(), p.initializer?.getText()]));
  assert.equal(properties.get('sesion'), 'captured.session'); assert.equal(properties.get('binding'), 'captured.binding');
  assert.equal(properties.get('readSession'), 'getSesion'); assert.equal(properties.get('request'), 'scopedRequest');
  assert.ok(calls.some(n => n.expression.getText() === 'loader.dispose'));
});

test('Feedback inventory keys and reload dependencies use the stable view, preserving original session DTO', () => {
  const file = sourceFile('./FeedbackTaskInventory.jsx');
  const inventory = nodes(file, ts.isJsxSelfClosingElement).find(n => n.tagName.getText() === 'Inventory');
  const attributes = new Map(inventory.attributes.properties.map(p => [p.name?.getText(), p.initializer?.expression?.getText()]));
  assert.equal(attributes.get('key'), 'view.key'); assert.equal(attributes.get('view'), 'view');
  const effects = nodes(file, ts.isCallExpression).filter(n => n.expression.getText() === 'useEffect');
  const effect = effects.find(n => nodes(n.arguments[0], ts.isCallExpression).some(c => c.expression.getText() === 'createFeedbackInventoryLoader'));
  assert.ok(effect.arguments[1].elements.some(n => n.getText() === 'view'));
  const loader = nodes(effect.arguments[0], ts.isCallExpression).find(n => n.expression.getText() === 'createFeedbackInventoryLoader');
  const session = loader.arguments[0].properties.find(n => n.name.getText() === 'sesion');
  assert.equal(session.initializer.getText(), 'view.session');
  assert.ok(nodes(effect, ts.isCallExpression).some(n => n.expression.getText() === 'loader.dispose'));
});

const dto = id => ({ version: 1, user: { id, nombre: 'Synthetic' }, today: '2026-10-20', generated_at: '2026-10-20T12:00:00Z',
  summary: { open: 0, overdue: 0, today: 0, upcoming: 0, undated: 0, awaiting_review: 0 },
  review: { scope: 'personal', total: 0, items: [] }, tasks: [], clients: [], visits: [], activity: [],
  list_totals: { clients: 0, visits: 0, activity: 0 }, capabilities: { projects: false } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function cookieStore() {
  const store = createBrowserSessionState();
  const accept = (id = 11, context = 'a', csrf = 'b') => {
    const ticket = store.beginBootstrap();
    store.acceptBootstrap(ticket, { usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion' },
      session_context: context.repeat(43), csrf_token: csrf.repeat(43) });
    return store.getSession();
  };
  return { store, accept };
}

test('personal home cookie request retains actual registered intent and closed user projection without bearer', async () => {
  const h = cookieStore(), sesion = h.accept(), states = [], calls = [];
  const loader = createPersonalHomeLoader({ sesion, readSession: h.store.getSession, onChange: value => states.push(value),
    request: async (url, options) => { calls.push({ url, options }); return dto(11); } });
  assert.equal(await loader.refresh(), true); assert.equal(calls.length, 1);
  const { options } = calls[0], headers = new Headers(options.headers);
  assert.equal(calls[0].url, '/api/inicio'); assert.equal(h.store.isCurrent(options.sessionIntent), true);
  assert.equal(headers.has('Authorization'), false);
  assert.equal(headers.get('X-Render-Session-Context'), 'a'.repeat(43));
  assert.equal(headers.get('X-Render-CSRF'), 'b'.repeat(43));
  assert.equal(states.at(-1).data.user.id, 11); loader.dispose();
});

for (const outcome of ['success', 'failure']) test(`cookie B suppresses late A ${outcome} and prevents refresh under B`, async () => {
  const h = cookieStore(), sesion = h.accept(), states = [], pending = deferred(); let calls = 0;
  const loader = createPersonalHomeLoader({ sesion, readSession: h.store.getSession, onChange: state => states.push(state),
    request: () => { calls++; return pending.promise; } });
  const loading = loader.refresh(); h.accept(12, 'c', 'd');
  if (outcome === 'success') pending.resolve(dto(11)); else pending.reject(Object.assign(new Error('synthetic'), { status: 401 }));
  assert.equal(await loading, false); assert.deepEqual(states.map(state => state.status), ['loading']);
  assert.equal(await loader.refresh(), false); assert.equal(calls, 1); loader.dispose();
});

test('same-ID rebootstrap also obsoletes the old cookie binding before dispatch', async () => {
  const h = cookieStore(), sesion = h.accept(); let calls = 0;
  const loader = createPersonalHomeLoader({ binding: captureSessionBinding(sesion), readSession: h.store.getSession,
    onChange() {}, request: async () => { calls++; return dto(11); } });
  h.accept(); assert.equal(await loader.refresh(), false); assert.equal(calls, 0); loader.dispose();
});

test('unregistered cookie-shaped session cannot dispatch; legacy bearer and userId-only APIs remain supported', async () => {
  const h = cookieStore(), original = h.accept(); let calls = 0;
  const fake = { ...original };
  const denied = createPersonalHomeLoader({ sesion: fake, onChange() {}, request: async () => { calls++; return dto(11); } });
  assert.equal(await denied.refresh(), false); assert.equal(calls, 0); denied.dispose();
  const bearer = { token: 'synthetic', usuario: { id: 11, rol: 'edicion', activo: true } };
  const legacy = createPersonalHomeLoader({ sesion: bearer, onChange() {}, request: async (_url, options) => {
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer synthetic'); return dto(11);
  } });
  assert.equal(await legacy.refresh(), true); legacy.dispose();
  const pure = createPersonalHomeLoader({ userId: 11, onChange() {}, request: async (_url, options) => {
    assert.equal(options.headers, undefined); return dto(11);
  } });
  assert.equal(await pure.refresh(), true); pure.dispose();
});

test('disposal aborts cookie transport and suppresses its eventual valid response', async () => {
  const h = cookieStore(), pending = deferred(), states = []; let signal;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession, onChange: value => states.push(value),
    request: (_url, options) => { signal = options.signal; return pending.promise; } });
  const result = loader.refresh(); loader.dispose(); assert.equal(signal.aborted, true);
  pending.resolve(dto(11)); assert.equal(await result, false); assert.equal(states.length, 1);
});

test('same-session manual/background refresh retains validated subtree data, then replaces with current server DTO', async () => {
  const h = cookieStore(), states = [], pending = deferred(); let calls = 0, clock = 0;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession, now: () => clock,
    onChange: state => states.push(state), request: async () => ++calls === 1 ? dto(11) : pending.promise });
  await loader.refresh(); const first = states.at(-1).data;
  assert.equal(await loader.refresh({ background: true }), false); assert.equal(calls, 1);
  clock = 30000; const updating = loader.refresh({ background: true });
  assert.equal(states.at(-1).status, 'loading'); assert.equal(states.at(-1).data, first);
  assert.equal(await loader.refresh({ background: true }), false); assert.equal(calls, 2);
  const next = { ...dto(11), user: { id: 11, nombre: 'Updated name' } };
  pending.resolve(next); await updating;
  assert.equal(states.at(-1).status, 'ready'); assert.equal(states.at(-1).data.user.nombre, 'Updated name');
  assert.notEqual(states.at(-1).data, first);
  const manual = loader.refresh(); assert.equal(states.at(-1).data.user.nombre, 'Updated name'); await manual;
  loader.dispose();
});

for (const status of [undefined, 408, 429, 500, 503]) test(`temporary refresh failure ${status} retains last validated snapshot with an explicit stale warning`, async () => {
  const h = cookieStore(), states = []; let fail = false;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession,
    onChange: value => states.push(value), request: async () => {
      if (fail) throw Object.assign(new Error('synthetic transport failure'), { status }); return dto(11);
    } });
  await loader.refresh(); const first = states.at(-1).data; fail = true;
  await loader.refresh(); assert.equal(states.at(-1).status, 'error'); assert.equal(states.at(-1).data, first);
  assert.match(states.at(-1).error, /última consulta/);
  fail = false; await loader.refresh(); assert.equal(states.at(-1).status, 'ready'); assert.equal(states.at(-1).error, '');
  loader.dispose();
});

for (const failure of [401, 403, 404, 'binding', 'controller', 'malformed']) test(`refresh ${failure} clears retained data and cannot revive it on a subsequent transport failure`, async () => {
  const h = cookieStore(), states = []; let stage = 0;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession,
    onChange: value => states.push(value), request: async () => {
      if (!stage) return dto(11);
      if (stage === 2) throw new Error('offline');
      if (failure === 'malformed') return { ...dto(11), user: { id: 12, nombre: 'Another person' } };
      if (failure === 'binding') throw Object.assign(new Error('obsolete'), { code: 'session_binding_obsolete' });
      if (failure === 'controller') throw Object.assign(new Error('revoked'), { name: 'BrowserSessionControllerError' });
      throw Object.assign(new Error('denied'), { status: failure });
    } });
  await loader.refresh(); assert.ok(states.at(-1).data);
  stage = 1; await loader.refresh(); assert.equal(states.at(-1).data, null);
  stage = 2; await loader.refresh(); assert.equal(states.at(-1).data, null);
  assert.doesNotMatch(states.at(-1).error, /última consulta/); loader.dispose();
});

test('replaced requests cannot overwrite a newer snapshot or clear it with a stale authorization error', async () => {
  for (const fail of [false, true]) {
    const h = cookieStore(), states = [], older = deferred(); let calls = 0;
    const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession,
      onChange: state => states.push(state), request: async () => {
        calls++; if (calls === 2) return older.promise;
        return { ...dto(11), user: { id: 11, nombre: calls === 1 ? 'Initial' : 'Newest' } };
      } });
    await loader.refresh(); const old = loader.refresh(); await loader.refresh();
    const latest = states.at(-1); assert.equal(latest.data.user.nombre, 'Newest');
    if (fail) older.reject(Object.assign(new Error('old denied'), { status: 403 })); else older.resolve(dto(11));
    assert.equal(await old, false); assert.equal(states.at(-1), latest); loader.dispose();
  }
});

test('replacement cookie loader has no prior snapshot and late old-session work never publishes retained data', async () => {
  const h = cookieStore(), states = [], pending = deferred(); let calls = 0;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession,
    onChange: value => states.push(value), request: async () => ++calls === 1 ? dto(11) : pending.promise });
  await loader.refresh(); const old = loader.refresh(); const before = states.length;
  const sesion = h.accept(12, 'c', 'd'), nextStates = [];
  const replacement = createPersonalHomeLoader({ sesion, readSession: h.store.getSession,
    onChange: state => nextStates.push(state), request: async () => dto(12) });
  const next = replacement.refresh(); assert.equal(nextStates.at(-1).data, null); await next;
  pending.resolve(dto(11)); assert.equal(await old, false); assert.equal(states.length, before);
  assert.equal(nextStates.at(-1).data.user.id, 12); loader.dispose(); replacement.dispose();
});

test('revocation before dispatch purges retained data even inside the background throttle and aborts held work', async () => {
  for (const held of [false, true]) {
    const h = cookieStore(), states = [], pending = deferred(); let calls = 0, signal;
    const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession, now: () => 0,
      onChange: state => states.push(state), request: async (_url, options) => {
        calls++; signal = options.signal; return calls === 1 ? dto(11) : pending.promise;
      } });
    await loader.refresh(); const old = held ? loader.refresh() : null;
    h.store.beginBootstrap();
    assert.equal(await loader.refresh({ background: true }), false);
    assert.equal(states.at(-1).status, 'error'); assert.equal(states.at(-1).data, null);
    assert.equal(signal.aborted, true); assert.equal(calls, held ? 2 : 1);
    const before = states.at(-1); if (held) { pending.resolve(dto(11)); assert.equal(await old, false); }
    assert.equal(states.at(-1), before); loader.dispose();
  }
});

test('QuickHome render fences retained data on identity/active changes before passive cleanup', () => {
  const file = sourceFile('./QuickHome.jsx');
  const declarations = nodes(file, ts.isVariableDeclaration);
  const expression = name => declarations.find(n => n.name.getText() === name).initializer.getText();
  const evaluate = (name, deps) => new Function(...Object.keys(deps), `return (${expression(name)});`)(...Object.values(deps));
  const identity = { binding: {}, id: 11 }, data = dto(11), result = { identity, status: 'loading', data };
  for (const observation of [identity, { ...identity }, null]) {
    const current = evaluate('current', { result, identity: observation });
    assert.equal(evaluate('data', { validIdentity: true, current }), observation === identity ? data : undefined);
    assert.equal(evaluate('data', { validIdentity: false, current }), null);
  }
  // Only the status message changes while data remains mounted; no refresh key
  // or loading branch replaces the operational modules.
  assert.match(readFileSync(new URL('./QuickHome.jsx', import.meta.url), 'utf8'), /data \? "Actualizando tu trabajo…" : "Cargando tu trabajo…"/);
});

test('focus/online/visible events request background refresh only and unsubscribe completely', () => {
  const windowTarget = new EventTarget(), documentTarget = new EventTarget(), calls = [];
  documentTarget.visibilityState = 'hidden';
  const stop = subscribePersonalHomeRefresh({ refresh: options => calls.push(options) }, windowTarget, documentTarget);
  windowTarget.dispatchEvent(new Event('focus')); assert.equal(calls.length, 0);
  documentTarget.visibilityState = 'visible';
  for (const name of ['focus', 'online']) windowTarget.dispatchEvent(new Event(name));
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(calls, [{ background: true }, { background: true }, { background: true }]);
  stop(); windowTarget.dispatchEvent(new Event('focus')); documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls.length, 3);
});
