import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationSession, ApplicationSessionError } from './application-session.js';
import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from './session-binding.js';
import { BROWSER_SESSION_LOCK } from './browser-session-controller.js';

const origin = 'http://127.0.0.1:5195';
const dto = (id = 7) => ({ usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion' },
  session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
const reply = (value, status = 200, proof = value?.session_context) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...(proof ? { 'X-Render-Session-Context': proof } : {}) },
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function mutex() {
  let tail = Promise.resolve(); const calls = [];
  return { calls, request(name, options, fn) {
    assert.equal(name, BROWSER_SESSION_LOCK); assert.equal(options.mode, 'exclusive'); calls.push(name);
    const result = tail.then(fn); tail = result.catch(() => {}); return result;
  } };
}
const forbiddenStorage = new Proxy({}, { get() { throw new Error('Browser runtime must not inspect storage'); } });
function browser(fetchImpl, extra = {}) {
  return createApplicationSession({ mode: 'browser', fetchImpl, location: { origin }, storage: forbiddenStorage, locks: mutex(), ...extra });
}

test('browser start is one lifetime singleflight, with exact registered DTO and independent subscribers', async () => {
  const gate = deferred(), calls = [], locks = mutex();
  const runtime = browser(async (url, options) => { calls.push({ url, options }); await gate.promise; return reply(dto()); }, { locks });
  assert.ok(Object.isFrozen(runtime)); assert.equal(runtime.mode, 'browser');
  const initial = runtime.getSnapshot(); assert.equal(initial, runtime.getSnapshot()); assert.equal(runtime.getSession(), null);
  let first = 0, second = 0;
  const unsubscribe = runtime.subscribe(() => first++), remove = runtime.subscribe(() => second++);
  const a = runtime.start(), b = runtime.start(); assert.equal(a, b); unsubscribe();
  await settle(); assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/sesion');
  gate.resolve(); const result = await a;
  assert.equal(result.ok, true); assert.equal(result.session, runtime.getSession());
  assert.equal(first, 1); assert.equal(second, 2);
  assert.equal(await runtime.start(), result); assert.equal(calls.length, 1); assert.equal(locks.calls.length, 1);
  const binding = captureSessionBinding(runtime.getSession());
  assert.equal(binding.mode, 'cookie'); assert.equal(sessionBindingMatches(binding, runtime.getSession()), true);
  assert.equal(Object.hasOwn(runtime.getSession(), 'token'), false);
  remove(); runtime.dispose();
});

test('failed/anonymous start is not retried by React remount-like subscriptions or repeated start', async () => {
  for (const kind of ['anonymous', 'error']) {
    let calls = 0;
    const runtime = browser(async () => { calls++; if (kind === 'error') throw new Error('private transport detail'); return reply({}, 401); });
    const a = runtime.start();
    if (kind === 'error') await assert.rejects(a, error => error.code === 'browser_session_transport_failed' && !error.message.includes('private'));
    else assert.equal((await a).reason, 'anonymous');
    runtime.subscribe(() => {})(); assert.equal(runtime.start(), a); assert.equal(calls, 1); runtime.dispose();
  }
});

test('start installs its lifetime promise before synchronous loading subscriber reentry', async () => {
  let calls = 0, reentered;
  const runtime = browser(async () => { calls++; return reply(dto()); });
  runtime.subscribe(() => { if (runtime.getSnapshot().status === 'loading') reentered = runtime.start(); });
  const first = runtime.start(); assert.equal(reentered, first);
  assert.equal((await first).ok, true); assert.equal(calls, 1); runtime.dispose();
});

test('start result stays initial A after login B: snapshots, not cached start, are current authority', async () => {
  let current = dto(7), bootstraps = 0;
  const runtime = browser(async url => {
    if (url === '/api/sesion/desafio') return reply({ csrf_token: 'c'.repeat(43) });
    if (url === '/api/login/browser') { current = dto(8); return reply(current); }
    if (url === '/api/sesion') { bootstraps++; return reply(current); }
    throw new Error('Unexpected synthetic path');
  });
  const initial = runtime.start(), a = await initial;
  assert.equal(a.session.usuario.id, 7);
  let latest;
  const unsubscribe = runtime.subscribe(() => { latest = runtime.getSnapshot(); });
  const b = await runtime.login({ kind: 'password', body: { usuario: 'synthetic-B', password: 'synthetic' } });
  assert.equal(b.session.usuario.id, 8); assert.equal(latest.session, b.session);
  const count = bootstraps;
  assert.equal(runtime.start(), initial); assert.equal(await runtime.start(), a);
  assert.equal(runtime.getSession(), b.session); assert.equal(runtime.getSnapshot(), latest);
  assert.equal(bootstraps, count); unsubscribe(); runtime.dispose();
});

test('dispose cancels bootstrap observation and cleans subscriptions, without publishing late identity', async () => {
  const gate = deferred(); let signal, notifications = 0;
  const runtime = browser(async (_url, options) => { signal = options.signal; await gate.promise; return reply(dto()); });
  runtime.subscribe(() => notifications++);
  const pending = runtime.start(); await settle(); runtime.dispose();
  assert.equal(signal.aborted, true); const count = notifications;
  gate.resolve(); assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  assert.equal(runtime.getSession(), null); assert.equal(notifications, count);
  assert.throws(() => runtime.start(), error => error.code === 'application_session_disposed');
});

test('real controller login commits before page cleanup; same context login creates a new owned observation', async () => {
  const paths = [], notifications = []; let current = dto();
  const runtime = browser(async (url, options) => {
    paths.push(url);
    if (url === '/api/sesion/desafio') return reply({ csrf_token: 'c'.repeat(43) });
    if (url === '/api/login/browser') {
      assert.equal(options.signal, undefined); assert.equal(options.credentials, 'same-origin');
      return reply(current);
    }
    if (url === '/api/sesion') return reply(current);
    return reply({ ok: true }, 200, current.session_context);
  }, { notifyChange: value => notifications.push(value.reason) });
  const abort = new AbortController();
  const unsubscribe = runtime.subscribe(() => { if (runtime.getSession()) abort.abort(); });
  const result = await runtime.login({ kind: 'password', body: { usuario: 'synthetic', password: 'synthetic' }, signal: abort.signal });
  assert.equal(result.ok, true); assert.equal(runtime.getSession(), result.session);
  unsubscribe(); const first = result.session, binding = captureSessionBinding(first);
  await runtime.login({ kind: 'password', body: { usuario: 'synthetic', password: 'synthetic' } });
  assert.notEqual(runtime.getSession(), first); assert.equal(sessionBindingMatches(binding, runtime.getSession()), false);
  assert.deepEqual(paths.slice(0, 3), ['/api/sesion/desafio', '/api/login/browser', '/api/sesion']);
  assert.deepEqual(notifications, ['login', 'login']);
  const live = captureSessionBinding(runtime.getSession());
  const response = await runtime.fetch('/api/inicio', sessionRequestOptions(live));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await runtime.logout(), { revoked: true }); assert.equal(runtime.getSession(), null); runtime.dispose();
});

test('cancelled cookie-setting login retains shared lock until the raw request settles, without pretending logout', async () => {
  const gate = deferred(), entered = deferred(), locks = mutex(), calls = [];
  const transport = async (url, options) => {
    calls.push(url);
    if (url === '/api/sesion/desafio') return reply({ csrf_token: 'c'.repeat(43) });
    if (url === '/api/login/browser') { assert.equal(options.signal, undefined); entered.resolve(); await gate.promise; return reply(dto()); }
    return reply(dto());
  };
  const a = browser(transport, { locks }), b = browser(transport, { locks }), abort = new AbortController();
  const pending = a.login({ kind: 'password', body: { usuario: 'synthetic', password: 'synthetic' }, signal: abort.signal });
  await entered.promise; abort.abort(); const count = calls.length, next = b.start(); await settle();
  assert.equal(calls.length, count); assert.equal(a.getSession(), null);
  gate.resolve(); assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  assert.equal((await next).ok, true); assert.equal(calls.includes('/api/logout'), false); a.dispose(); b.dispose();
});

test('browser rejects foreign base, missing locks and invalid mode without touching storage or making HTTP calls', () => {
  let calls = 0; const fetchImpl = () => { calls++; };
  for (const apiBase of ['https://other.invalid', origin, '/other'])
    assert.throws(() => browser(fetchImpl, { apiBase }), error => error.code === 'application_session_origin_invalid');
  assert.throws(() => browser(fetchImpl, { locks: undefined }), error => error.code === 'browser_locks_required');
  assert.throws(() => createApplicationSession({ mode: 'unknown', fetchImpl }), ApplicationSessionError);
  assert.equal(calls, 0);
});

test('bearer default preserves existing storage key, parsing, explicit credentials and API base; start never requests', async () => {
  let raw = JSON.stringify({ token: 'synthetic-token', usuario: dto().usuario });
  const keys = [], calls = [], storage = { getItem(key) { keys.push(key); return raw; }, removeItem() { raw = null; } };
  const runtime = createApplicationSession({ storage, location: { pathname: '/inicio', replace() {} }, apiBase: 'https://api.invalid',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return reply({ ok: true }); } });
  assert.equal(runtime.mode, 'bearer'); const first = runtime.getSnapshot(); assert.equal(runtime.getSnapshot(), first);
  assert.equal((await runtime.start()).session, first.session); assert.equal(calls.length, 0);
  let notifications = 0; const unsubscribe = runtime.subscribe(() => notifications++);
  await runtime.fetch('/api/inicio'); assert.equal(calls[0].url, 'https://api.invalid/api/inicio');
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer synthetic-token');
  await runtime.fetch('/api/inicio', { headers: { Authorization: 'Bearer captured-other' } });
  assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer captured-other');
  assert.equal(runtime.getSnapshot(), first); raw = JSON.stringify({ token: 'new-synthetic', usuario: dto(8).usuario });
  await runtime.fetch('/api/inicio'); assert.equal(runtime.getSession().usuario.id, 8); assert.equal(notifications, 1);
  assert.notEqual(runtime.getSnapshot(), first); assert.ok(keys.every(key => key === 'render_sesion'));
  assert.throws(() => runtime.login({}), error => error.code === 'application_session_mode_unsupported');
  assert.throws(() => runtime.logout(), error => error.code === 'application_session_mode_unsupported');
  unsubscribe(); runtime.dispose();
});

test('legacy current 401 still removes only the old key and redirects; malformed/storage failure is anonymous', async () => {
  let raw = JSON.stringify({ token: 'synthetic-token', usuario: dto().usuario }); const removed = [], redirects = [];
  const runtime = createApplicationSession({ storage: { getItem: () => raw, removeItem(key) { removed.push(key); raw = null; } },
    location: { pathname: '/inicio', replace: path => redirects.push(path) }, fetchImpl: async () => reply({}, 401) });
  runtime.getSnapshot(); await runtime.fetch('/api/inicio');
  assert.equal(runtime.getSession(), null); assert.deepEqual(removed, ['render_sesion']); assert.deepEqual(redirects, ['/login']); runtime.dispose();
  for (const storage of [{ getItem: () => 'bad json' }, { getItem() { throw new Error('denied'); } }]) {
    const anonymous = createApplicationSession({ storage, fetchImpl: async () => { throw new Error('must not request'); } });
    assert.equal((await anonymous.start()).ok, false); assert.equal(anonymous.getSnapshot().status, 'anonymous'); anonymous.dispose();
  }
});

function legacyEvents() {
  let raw = JSON.stringify({ token: 'synthetic-A', usuario: dto(7).usuario });
  const handlers = new Set(), keys = [];
  let adds = 0, removes = 0;
  const eventTarget = {
    addEventListener(type, callback) { assert.equal(type, 'storage'); adds++; handlers.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'storage'); removes++; handlers.delete(callback); },
    dispatch(event) { for (const callback of [...handlers]) callback(event); },
  };
  const storage = { getItem(key) { keys.push(key); return raw; } };
  const runtime = createApplicationSession({ eventTarget, storage, fetchImpl: async () => reply({ ok: true }) });
  return { runtime, eventTarget, storage, keys, counts: () => ({ adds, removes, active: handlers.size }),
    replace(id) { raw = id === null ? null : JSON.stringify({ token: `synthetic-${id}`, usuario: dto(id).usuario }); } };
}

test('legacy start lazily attaches exactly one storage listener; explicit sync notifies independent subscribers from actual storage', async () => {
  const h = legacyEvents(); assert.deepEqual(h.counts(), { adds: 0, removes: 0, active: 0 });
  const initial = h.runtime.getSnapshot(); let a = 0, b = 0;
  const unsubscribeA = h.runtime.subscribe(() => a++), unsubscribeB = h.runtime.subscribe(() => b++);
  assert.equal(h.counts().adds, 0);
  const first = h.runtime.start(); assert.equal(h.runtime.start(), first); await first;
  assert.deepEqual(h.counts(), { adds: 1, removes: 0, active: 1 });
  assert.equal(h.runtime.sync(), initial); assert.equal(a, 0); assert.equal(b, 0);
  h.replace(8);
  // Even a supplied argument is not trusted: only current storage is read.
  const current = h.runtime.sync({ token: 'forged', usuario: dto(99).usuario });
  assert.equal(current.session.usuario.id, 8); assert.equal(a, 1); assert.equal(b, 1);
  assert.equal(h.runtime.getSnapshot(), current); h.runtime.sync(); assert.equal(b, 1);
  unsubscribeA(); h.replace(null); h.runtime.sync(); assert.equal(a, 1); assert.equal(b, 2);
  unsubscribeB(); assert.equal(h.counts().active, 1, 'React unsubscription does not dispose document runtime');
  h.runtime.dispose(); h.runtime.dispose();
  assert.deepEqual(h.counts(), { adds: 1, removes: 1, active: 0 });
  assert.ok(h.keys.every(key => key === 'render_sesion'));
});

test('external storage events filter key and storageArea and ignore all event DTOs', async () => {
  const h = legacyEvents(); await h.runtime.start(); let count = 0;
  h.runtime.subscribe(() => count++);
  const initial = h.runtime.getSnapshot(), readCount = h.keys.length; h.replace(8);
  h.eventTarget.dispatch({ key: 'other', storageArea: h.storage });
  h.eventTarget.dispatch({ key: 'render_sesion', storageArea: {} });
  assert.equal(count, 0); assert.equal(h.keys.length, readCount, 'Ignored events do not read storage');
  h.eventTarget.dispatch({ key: 'render_sesion', storageArea: h.storage, newValue: JSON.stringify({ usuario: dto(99).usuario }) });
  assert.equal(count, 1); assert.equal(h.runtime.getSession().usuario.id, 8); assert.notEqual(h.runtime.getSnapshot(), initial);
  const stable = h.runtime.getSnapshot(); h.eventTarget.dispatch({ key: 'render_sesion' });
  assert.equal(count, 1); assert.equal(h.runtime.getSnapshot(), stable);
  h.replace(null); h.eventTarget.dispatch({ key: null, storageArea: h.storage });
  assert.equal(count, 2); assert.equal(h.runtime.getSession(), null);
  h.replace(9); h.eventTarget.dispatch({ key: 'render_sesion', storageArea: null });
  assert.equal(count, 3); assert.equal(h.runtime.getSession().usuario.id, 9);
  h.runtime.dispose(); const reads = h.keys.length;
  h.eventTarget.dispatch({ key: null, storageArea: h.storage }); assert.equal(h.keys.length, reads);
});

test('legacy subscriber start reentry cannot install a second listener; disposal prevents restart/sync', async () => {
  const h = legacyEvents(); const first = h.runtime.start(); await first;
  let nested;
  h.runtime.subscribe(() => { nested = h.runtime.start(); });
  h.replace(8); h.runtime.sync(); assert.equal(nested, first); assert.equal(h.counts().adds, 1);
  h.runtime.dispose();
  assert.throws(() => h.runtime.start(), error => error.code === 'application_session_disposed');
  assert.throws(() => h.runtime.sync(), error => error.code === 'application_session_disposed');
  assert.equal(h.counts().active, 0);
  const unstarted = legacyEvents(); unstarted.runtime.dispose();
  assert.throws(() => unstarted.runtime.start(), error => error.code === 'application_session_disposed');
  assert.deepEqual(unstarted.counts(), { adds: 0, removes: 0, active: 0 });
});

test('browser runtime never attaches storage listeners and rejects legacy sync without storage reads', async () => {
  const eventTarget = { addEventListener() { throw new Error('No browser storage listener'); }, removeEventListener() { throw new Error('No browser storage cleanup'); } };
  const runtime = browser(async () => reply(dto()), { eventTarget });
  assert.throws(() => runtime.sync(), error => error.code === 'application_session_mode_unsupported');
  assert.equal((await runtime.start()).ok, true); runtime.dispose();
});

for (const trigger of ['sync', 'storage']) test(`legacy reads before ${trigger} cannot swallow the pending change notification`, async () => {
  const h = legacyEvents(); await h.runtime.start();
  let first = 0, second = 0;
  h.runtime.subscribe(() => { first++; h.runtime.sync(); });
  h.runtime.subscribe(() => second++);
  const a = h.runtime.getSnapshot();
  h.replace(8);
  assert.equal(h.runtime.getSession().usuario.id, 8);
  const b = h.runtime.getSnapshot(); assert.notEqual(b, a);
  assert.equal(first, 0); assert.equal(second, 0);
  const notify = () => trigger === 'sync' ? h.runtime.sync()
    : h.eventTarget.dispatch({ key: 'render_sesion', storageArea: h.storage });
  notify(); assert.equal(first, 1); assert.equal(second, 1);
  assert.equal(h.runtime.getSnapshot(), b); notify(); h.runtime.sync();
  assert.equal(first, 1); assert.equal(second, 1);
  h.replace(9); h.runtime.getSession(); h.runtime.getSnapshot(); notify();
  assert.equal(first, 2); assert.equal(second, 2); h.runtime.dispose();
});

test('first subscription establishes a quiet baseline without start, then reads cannot swallow sync', () => {
  const h = legacyEvents(); let count = 0;
  h.runtime.subscribe(() => count++); h.runtime.sync(); assert.equal(count, 0);
  h.replace(8); h.runtime.getSession(); h.runtime.sync(); assert.equal(count, 1);
  h.runtime.sync(); assert.equal(count, 1); h.runtime.dispose();
});
