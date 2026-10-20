import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapturedRequest, isSessionFailure } from './captured-request.js';
import { createBrowserSessionState } from './browser-session-state.js';

const legacy = (id = 7, token = 'synthetic-A') => ({ token, usuario: { id, rol: 'edicion', activo: true } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function cookie() {
  const store = createBrowserSessionState();
  const accept = (id = 7) => { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, {
    usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion' },
    session_context: (id === 7 ? 'a' : 'c').repeat(43), csrf_token: (id === 7 ? 'b' : 'd').repeat(43) }); return store.getSession(); };
  return { store, accept };
}
test('captured legacy request keeps exact bearer and body/signal even before a queued dispatch', async () => {
  let live = legacy(); const calls = [], body = new Blob(['synthetic']), abort = new AbortController();
  const scope = createCapturedRequest({ session: live, readSession: () => live, request: async (...args) => { calls.push(args); return 1; } });
  assert.ok(Object.isFrozen(scope));
  assert.equal(await scope.request('/api/tareas/1', { method: 'PUT', body, signal: abort.signal,
    headers: { 'Content-Range': 'bytes 0-8/9' } }), 1);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-A');
  assert.equal(calls[0][1].body, body); assert.equal(calls[0][1].signal, abort.signal);
  live = legacy(8, 'synthetic-B');
  await assert.rejects(scope.request('/api/tareas/1'), error => isSessionFailure(error)); assert.equal(calls.length, 1);
});
test('genuine cookie request carries original intent, no Authorization; same-ID rebootstrap invalidates it', async () => {
  const h = cookie(), session = h.accept(), calls = [];
  const scope = createCapturedRequest({ session, readSession: h.store.getSession, request: async (_url, options) => { calls.push(options); return 'ok'; } });
  assert.equal(await scope.request('/api/tareas', { method: 'POST', body: '{}' }), 'ok');
  assert.equal(h.store.isCurrent(calls[0].sessionIntent), true);
  assert.equal(new Headers(calls[0].headers).has('Authorization'), false);
  h.accept(); assert.equal(scope.current(), false); assert.throws(() => scope.options(), error => isSessionFailure(error));
  await assert.rejects(scope.request('/api/tareas'), error => isSessionFailure(error)); assert.equal(calls.length, 1);
});
for (const outcome of ['success', 'failure']) test(`late ${outcome} after another account is withdrawn, never republished`, async () => {
  let live = legacy(); const pending = deferred();
  const scope = createCapturedRequest({ session: live, readSession: () => live, request: () => pending.promise });
  const result = scope.request('/api/tareas'); live = legacy(8, 'synthetic-B');
  if (outcome === 'success') pending.resolve({ private: 'A' }); else pending.reject(new Error('private A failure'));
  await assert.rejects(result, error => error.code === 'session_binding_obsolete' && !error.message.includes('private'));
});
test('scope lifecycle prevents dispatch and post-await commits without changing authentication', async () => {
  let active = true, calls = 0; const pending = deferred(), session = legacy();
  const scope = createCapturedRequest({ session, readSession: () => session, isActive: () => active,
    request: () => { calls++; return pending.promise; } });
  const result = scope.request('/api/tareas'); active = false; pending.resolve({});
  await assert.rejects(result, error => isSessionFailure(error));
  await assert.rejects(scope.request('/api/tareas'), error => isSessionFailure(error)); assert.equal(calls, 1);
});
test('copied/mixed cookie sessions, unavailable readers and caller credential conflicts fail closed', async () => {
  const h = cookie(), session = h.accept();
  for (const value of [{ ...session }, { ...session, token: 'fake' }, null]) {
    const scope = createCapturedRequest({ session: value, readSession: () => session, request: () => assert.fail('no dispatch') });
    await assert.rejects(scope.request('/api/tareas'), error => isSessionFailure(error));
  }
  const scope = createCapturedRequest({ session, readSession: () => session, request: () => assert.fail('no dispatch') });
  await assert.rejects(scope.request('/api/tareas', { headers: { Authorization: 'Bearer wrong' } }), error => isSessionFailure(error));
  const denied = createCapturedRequest({ session, readSession: () => { throw Error('unavailable'); }, request: () => assert.fail('no dispatch') });
  assert.equal(denied.current(), false);
});
test('current transport/domain failures retain their original meaning; session failures are recognizable', async () => {
  const session = legacy(), failure = Object.assign(new Error('conflict'), { status: 409 });
  const scope = createCapturedRequest({ session, readSession: () => session, request: async () => { throw failure; } });
  await assert.rejects(scope.request('/api/tareas'), error => error === failure);
  for (const name of ['BrowserSessionError', 'BrowserSessionControllerError', 'ApplicationSessionError']) assert.equal(isSessionFailure({ name }), true);
  assert.equal(isSessionFailure(new Error('ordinary')), false);
});
