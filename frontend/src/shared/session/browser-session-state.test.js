import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionState, parseBrowserSession, bootstrapBrowserSession } from './browser-session-state.js';
const dto = (id = 7, context = 'A') => ({ usuario: { id, usuario: `qa${id}`, nombre: 'Synthetic QA', rol: 'edicion' },
  session_context: context.repeat(43), csrf_token: 'C'.repeat(43) });
const install = (store, value = dto()) => store.acceptBootstrap(store.beginBootstrap(), value);
const response = (body, status = 200, proof = body?.session_context) => new Response(JSON.stringify(body),
  { status, headers: proof ? { 'X-Render-Session-Context': proof } : {} });
test('unknown/loading/authenticated are distinct; immutable state stores no JWT or authority bags', () => {
  const store = createBrowserSessionState(), snapshots = [];
  const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));
  assert.equal(store.getSnapshot().status, 'unknown'); assert.equal(store.captureIntent(), null);
  assert.equal(store.acceptBootstrap(null, dto()), false); assert.equal(store.failBootstrap(null), false);
  const ticket = store.beginBootstrap(); assert.equal(store.getSnapshot().status, 'loading');
  assert.equal(store.getSession(), null);
  const value = dto(); value.usuario.password_hash = 'not stored'; value.usuario.finanzas = { private: true };
  assert.ok(store.acceptBootstrap(ticket, value)); assert.equal(store.getSnapshot().status, 'authenticated');
  const session = store.getSession(); assert.deepEqual(Object.keys(session.usuario), ['id', 'usuario', 'nombre', 'rol']);
  assert.equal('token' in session, false); assert.ok(Object.isFrozen(session)); assert.ok(Object.isFrozen(session.usuario));
  const intent = store.captureIntent(); assert.ok(Object.isFrozen(intent)); assert.ok(store.isCurrent(intent));
  assert.equal(store.isCurrent({ ...intent }), false); assert.equal(store.acceptBootstrap(ticket, dto(8, 'B')), false);
  unsubscribe(); install(store, null); assert.equal(snapshots.length, 2);
});
test('malformed, credential-bearing and inactive DTOs reject without inventing identity', () => {
  for (const value of [null, [], {}, { ...dto(), token: 'never allowed' }, { ...dto(), csrf_token: 'A'.repeat(43) },
    { ...dto(), session_context: 'short' }, { ...dto(), usuario: { ...dto().usuario, id: '7' } },
    { ...dto(), usuario: { ...dto().usuario, activo: false } }, { ...dto(), usuario: { ...dto().usuario, rol: '' } }])
    assert.throws(() => parseBrowserSession(value));
});
test('old intents cannot clear another login or a newly observed same-cookie session', () => {
  const store = createBrowserSessionState(); install(store);
  const old = store.captureIntent(); install(store, dto(8, 'B'));
  assert.equal(store.invalidate(old), false); assert.equal(store.getSession().usuario.id, 8);
  const current = store.captureIntent(); assert.ok(store.invalidate(current)); assert.equal(store.getSnapshot().status, 'anonymous');
  install(store); const sameCookie = store.captureIntent(); install(store);
  assert.equal(store.isCurrent(sameCookie), false);
});
test('bootstrap uses raw same-origin no-store transport and matches response proof before accepting', async () => {
  const store = createBrowserSessionState();
  await bootstrapBrowserSession({ store, fetchImpl: async (url, init) => {
    assert.equal(url, '/api/sesion'); assert.equal(init.credentials, 'same-origin');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers, undefined);
    return response(dto());
  } });
  assert.equal(store.getSession().usuario.id, 7);
  for (const proof of [undefined, 'B'.repeat(43)]) {
    const broken = createBrowserSessionState();
    await assert.rejects(bootstrapBrowserSession({ store: broken, fetchImpl: async () => response(dto(), 200, proof === undefined ? null : proof) }));
    assert.equal(broken.getSnapshot().status, 'error'); assert.equal(broken.getSession(), null);
  }
});
test('late success,401 or failure from earlier bootstrap cannot replace or clear a newer observation', async () => {
  for (const result of ['success', '401', 'offline']) {
    const store = createBrowserSessionState(); let finish, reject;
    const old = bootstrapBrowserSession({ store, fetchImpl: () => new Promise((resolve, no) => { finish = resolve; reject = no; }) });
    await bootstrapBrowserSession({ store, fetchImpl: async () => response(dto(8, 'B')) });
    if (result === 'offline') reject(Error('offline'));
    else finish(result === '401' ? response({}, 401) : response(dto()));
    assert.equal(await old, false); assert.equal(store.getSession().usuario.id, 8);
  }
});
test('current401 is anonymous; network/500/config failures remain error, not successful logout or fallback', async () => {
  for (const status of [401, 500, 404]) {
    const store = createBrowserSessionState();
    const pending = bootstrapBrowserSession({ store, fetchImpl: async () => response({}, status) });
    if (status === 401) { assert.ok(await pending); assert.equal(store.getSnapshot().status, 'anonymous'); }
    else { await assert.rejects(pending); assert.equal(store.getSnapshot().status, 'error'); }
    assert.equal(store.getSession(), null);
  }
});
test('explicit cancellation rejects a late bootstrap and old cancellation cannot clear a newer session', async () => {
  const store = createBrowserSessionState(), ticket = store.beginBootstrap();
  assert.ok(store.cancelBootstrap(ticket)); assert.equal(store.getSnapshot().status, 'unknown');
  assert.equal(store.acceptBootstrap(ticket, dto()), false);
  install(store, dto(8, 'B')); assert.equal(store.cancelBootstrap(ticket), false);
  assert.equal(store.getSession().usuario.id, 8);
});
test('abort cancels observation even when fetch ignores the signal; a late body cannot restore authentication', async () => {
  for (const replace of [false, true]) {
    const store = createBrowserSessionState(), controller = new AbortController(); let finish;
    const pending = bootstrapBrowserSession({ store, signal: controller.signal,
      fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
    if (replace) install(store, dto(8, 'B'));
    controller.abort();
    if (!replace) assert.equal(store.getSnapshot().status, 'unknown');
    finish(response(dto())); assert.equal(await pending, false);
    assert.equal(store.getSession()?.usuario.id ?? null, replace ? 8 : null);
  }
  const controller = new AbortController(); controller.abort();
  assert.equal(await bootstrapBrowserSession({ store: createBrowserSessionState(), signal: controller.signal,
    fetchImpl: () => assert.fail('already cancelled') }), false);
});
