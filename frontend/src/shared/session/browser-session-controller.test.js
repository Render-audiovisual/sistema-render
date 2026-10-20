import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionController, BROWSER_SESSION_LOCK, BrowserSessionControllerError } from './browser-session-controller.js';
import { createBrowserSessionState } from './browser-session-state.js';

const origin = 'https://render.example.test';
const dto = (id = 7, context = 'A') => ({ usuario: { id, usuario: `qa${id}`, nombre: 'Synthetic QA', rol: 'edicion' }, session_context: context.repeat(43), csrf_token: 'C'.repeat(43) });
const install = (store, value = dto()) => store.acceptBootstrap(store.beginBootstrap(), value);
const response = (body, status = 200, proof = body?.session_context) => new Response(JSON.stringify(body), { status, headers: proof ? { 'X-Render-Session-Context': proof } : {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function serializedLocks() {
  let tail = Promise.resolve(); const calls = [], events = [];
  return { calls, events, request(name, options, work) {
    assert.equal(name, 'render:browser-session:v1'); assert.deepEqual(options, { mode: 'exclusive' });
    calls.push({ name, options });
    const result = tail.then(async () => { events.push('acquired'); try { return await work(); } finally { events.push('released'); } });
    tail = result.catch(() => {}); return result;
  } };
}
function fixture({ store = createBrowserSessionState(), locks = serializedLocks(), fetchImpl, notifyChange } = {}) {
  const calls = [];
  const controller = createBrowserSessionController({ origin, store, locks, notifyChange, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    if (fetchImpl) return fetchImpl(url, init);
    if (url === '/api/sesion/desafio') return response({ csrf_token: 'D'.repeat(43) });
    if (url.startsWith('/api/login/')) return response(dto());
    return response(dto());
  } });
  return { controller, store, locks, calls };
}
const login = controller => controller.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic password' } });
const hasCode = code => error => error instanceof BrowserSessionControllerError && error.code === code;

test('profile refresh uses one locked proof bootstrap with strict captured identity and new server photo DTO', async () => {
  const photo = 'data:image/png;base64,c3ludGhldGlj';
  const f = fixture({ fetchImpl: async () => response({ ...dto(), usuario: { ...dto().usuario, foto_perfil: photo } }) });
  install(f.store); const previous = f.store.getSession(), intent = f.store.captureIntent();
  const pending = f.controller.refreshProfile({ sessionIntent: intent });
  // The original observation survives queueing; loading begins under the lock.
  assert.equal(f.store.getSession(), previous);
  await Promise.resolve();
  assert.equal(f.store.getSnapshot().status, 'loading'); assert.equal(f.store.getSession(), null);
  const result = await pending;
  assert.equal(result.ok, true); assert.notEqual(result.session, previous);
  assert.equal(result.session.usuario.foto_perfil, photo); assert.equal(f.store.getSession(), result.session);
  assert.deepEqual(f.calls.map(c => c.url), ['/api/sesion']); assert.equal(f.locks.calls.length, 1);
  assert.equal(f.store.isCurrent(intent), false); f.controller.dispose();
});

test('profile refresh refuses copied/stale intent before dispatch, without withdrawing a current replacement', () => {
  const f = fixture(); install(f.store); const intent = f.store.captureIntent();
  assert.throws(() => f.controller.refreshProfile({ sessionIntent: { ...intent } }), hasCode('browser_profile_intent_obsolete'));
  install(f.store, dto(8, 'B')); const b = f.store.getSession();
  assert.throws(() => f.controller.refreshProfile({ sessionIntent: intent }), hasCode('browser_profile_intent_obsolete'));
  assert.equal(f.store.getSession(), b); assert.equal(f.calls.length, 0); assert.equal(f.locks.calls.length, 0);
});

test('profile refresh rejects cookie identity/context/CSRF/role changes and missing proof, never publishing them', async () => {
  for (const kind of ['id', 'context', 'csrf', 'role', 'proof', '401']) {
    const value = dto();
    if (kind === 'id') value.usuario.id = 8;
    if (kind === 'context') value.session_context = 'B'.repeat(43);
    if (kind === 'csrf') value.csrf_token = 'E'.repeat(43);
    if (kind === 'role') value.usuario.rol = 'admin';
    const f = fixture({ fetchImpl: async () => kind === '401' ? response({}, 401) : response(value, 200, kind === 'proof' ? null : value.session_context) });
    install(f.store); const intent = f.store.captureIntent(), published = [];
    f.store.subscribe(() => { if (f.store.getSession()) published.push(f.store.getSession()); });
    await assert.rejects(f.controller.refreshProfile({ sessionIntent: intent }), error => error instanceof BrowserSessionControllerError);
    assert.equal(f.store.getSession(), null); assert.deepEqual(published, []); assert.equal(f.calls.length, 1);
    f.controller.dispose();
  }
});

test('profile refresh queues behind cooperative lock and rejects concurrent controller work', async () => {
  const locks = serializedLocks(), hold = deferred(), entered = deferred();
  const blocker = locks.request(BROWSER_SESSION_LOCK, { mode: 'exclusive' }, async () => { entered.resolve(); await hold.promise; });
  await entered.promise;
  const f = fixture({ locks }); install(f.store);
  const pending = f.controller.refreshProfile({ sessionIntent: f.store.captureIntent() });
  assert.equal(f.calls.length, 0);
  assert.throws(() => f.controller.bootstrap(), hasCode('browser_session_busy'));
  hold.resolve(); await blocker; assert.equal((await pending).ok, true); f.controller.dispose();
});

test('queued profile refresh revalidates original intent under lock before loading or HTTP, preserving external B', async () => {
  const locks = serializedLocks(), hold = deferred(), entered = deferred();
  const blocker = locks.request(BROWSER_SESSION_LOCK, { mode: 'exclusive' }, async () => { entered.resolve(); await hold.promise; });
  await entered.promise;
  const f = fixture({ locks }); install(f.store);
  const a = f.store.getSession(), intent = f.store.captureIntent(), pending = f.controller.refreshProfile({ sessionIntent: intent });
  assert.equal(f.store.getSession(), a); assert.equal(f.store.getSnapshot().status, 'authenticated');
  install(f.store, dto(8, 'B')); const b = f.store.getSession(), snapshot = f.store.getSnapshot();
  const changes = []; f.store.subscribe(() => changes.push(f.store.getSnapshot()));
  hold.resolve(); await blocker;
  assert.deepEqual(await pending, { ok: false, reason: 'obsolete' });
  assert.equal(f.calls.length, 0); assert.equal(f.store.getSession(), b); assert.equal(f.store.getSnapshot(), snapshot);
  assert.deepEqual(changes, []); f.controller.dispose(); assert.equal(f.store.getSession(), b);
});

test('profile refresh reentrant disposal during lock-owned loading cancels before HTTP', async () => {
  const f = fixture(); install(f.store); const intent = f.store.captureIntent();
  f.store.subscribe(() => { if (f.store.getSnapshot().status === 'loading') f.controller.dispose(); });
  assert.deepEqual(await f.controller.refreshProfile({ sessionIntent: intent }), { ok: false, reason: 'cancelled' });
  assert.equal(f.calls.length, 0); assert.equal(f.store.getSession(), null);
  assert.equal(f.store.getSnapshot().status, 'unknown');
});

for (const kind of ['success', 'failure', 'cancel']) test(`late profile ${kind} never overwrites a newer B observation`, async () => {
  const held = deferred(), entered = deferred();
  const f = fixture({ fetchImpl: async () => { entered.resolve(); return held.promise; } });
  install(f.store); const abort = new AbortController();
  const pending = f.controller.refreshProfile({ sessionIntent: f.store.captureIntent(), signal: abort.signal });
  await entered.promise; install(f.store, dto(8, 'B')); const b = f.store.getSession();
  if (kind === 'cancel') abort.abort();
  if (kind === 'failure') held.reject(new Error('private transport details')); else held.resolve(response(dto()));
  if (kind === 'failure') await assert.rejects(pending, hasCode('browser_session_transport_failed'));
  else assert.equal((await pending).ok, false);
  assert.equal(f.store.getSession(), b); f.controller.dispose();
  assert.equal(f.store.getSession(), b);
});

test('requires origin-wide exclusive lock with exact shared name; no local fallback', async () => {
  assert.equal(BROWSER_SESSION_LOCK, 'render:browser-session:v1');
  for (const locks of [undefined, null, {}, { request: false }]) assert.throws(() => createBrowserSessionController({ origin, store: createBrowserSessionState(), fetchImpl() { throw Error('no fetch'); }, locks }), hasCode('browser_locks_required'));
  const f = fixture(); assert.equal(f.controller.isBusy(), false);
  const pending = f.controller.bootstrap(); assert.equal(f.controller.isBusy(), true);
  assert.equal((await pending).ok, true); assert.equal(f.controller.isBusy(), false); assert.equal(f.locks.calls.length, 1);
});
test('fixed password/Google routes and closed body snapshots; only proof bootstrap publishes, no JWT', async () => {
  for (const kind of ['password', 'google']) {
    const receipt = deferred(), reached = deferred();
    const f = fixture({ fetchImpl: async url => {
      if (url === '/api/sesion/desafio') return response({ csrf_token: 'D'.repeat(43) });
      if (url.startsWith('/api/login/')) { reached.resolve(); return receipt.promise; }
      return response(dto());
    } });
    const body = kind === 'password' ? { usuario: 'qa', password: ' exact synthetic password ' } : { credential: 'raw-synthetic-provider-token' };
    const original = JSON.stringify(body), pending = f.controller.login({ kind, body });
    Object.keys(body).forEach(key => { body[key] = 'mutated'; });
    await reached.promise; assert.equal(f.store.getSession(), null); assert.equal(f.store.getSnapshot().status, 'loading');
    assert.deepEqual(f.calls.map(c => c.url), ['/api/sesion/desafio', kind === 'password' ? '/api/login/browser' : '/api/login/browser/google']);
    const sent = f.calls[1].init; assert.equal(sent.body, original); assert.equal(sent.method, 'POST');
    assert.equal(sent.headers['X-Render-CSRF'], 'D'.repeat(43)); assert.equal(sent.signal, undefined); assert.equal(f.calls[0].init.signal, undefined);
    receipt.resolve(response(dto())); assert.equal((await pending).ok, true);
    assert.equal(f.calls[2].url, '/api/sesion'); assert.equal('token' in f.store.getSession(), false); assert.equal(f.locks.calls.length, 1);
  }
});
test('malformed modes/extra body fields fail before lock or fetch without exposing credentials', () => {
  const f = fixture();
  for (const input of [{ kind: 'other', body: {} }, { kind: 'password', body: { usuario: 'qa', password: 'SECRET', browser: true } },
    { kind: 'password', body: { usuario: 'qa', password: 'SECRET', rol: 'admin' } }, { kind: 'google', body: { credential: 7 } }]) {
    assert.throws(() => f.controller.login(input), error => hasCode('browser_login_input_invalid')(error) && !error.message.includes('SECRET'));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.locks.calls.length, 0);
});
test('receipt/bootstrap mismatch, absent proof, JWT and failed post-cookie bootstrap never publish or retry', async () => {
  for (const scenario of ['id', 'context', 'csrf', 'proof', 'receipt-jwt', 'bootstrap-jwt', '401', '500', 'offline']) {
    const f = fixture({ fetchImpl: async url => {
      if (url === '/api/sesion/desafio') return response({ csrf_token: 'D'.repeat(43) });
      if (url.startsWith('/api/login/')) return response(scenario === 'receipt-jwt' ? { ...dto(), token: 'NEVER_EXPOSE' } : dto());
      if (scenario === 'offline') throw Error('PRIVATE_PROVIDER_DETAIL');
      if (['401', '500'].includes(scenario)) return response({}, Number(scenario));
      const value = dto();
      if (scenario === 'id') value.usuario.id = 8;
      if (scenario === 'context') value.session_context = 'B'.repeat(43);
      if (scenario === 'csrf') value.csrf_token = 'E'.repeat(43);
      if (scenario === 'bootstrap-jwt') value.token = 'NEVER_EXPOSE';
      return response(value, 200, scenario === 'proof' ? null : value.session_context);
    } });
    await assert.rejects(login(f.controller), error => error instanceof BrowserSessionControllerError && !/PRIVATE|NEVER_EXPOSE/.test(error.message));
    assert.equal(f.store.getSession(), null); assert.equal(f.store.getSnapshot().status, 'error');
    assert.equal(f.calls.filter(c => c.url.startsWith('/api/login/')).length, 1);
    assert.ok(f.calls.length <= 3); assert.equal(f.controller.isBusy(), false);
  }
});
test('fresh bootstrap role wins over login receipt when context and ID agree', async () => {
  const f = fixture({ fetchImpl: async url => url === '/api/sesion/desafio' ? response({ csrf_token: 'D'.repeat(43) })
    : response(url === '/api/sesion' ? { ...dto(), usuario: { ...dto().usuario, rol: 'community' } } : dto()) });
  assert.equal((await login(f.controller)).session.usuario.rol, 'community');
});
test('queued cancellation performs no fetch when lock later becomes available', async () => {
  const locks = serializedLocks(), holding = deferred(), acquired = deferred();
  const blocker = locks.request(BROWSER_SESSION_LOCK, { mode: 'exclusive' }, async () => { acquired.resolve(); await holding.promise; });
  await acquired.promise;
  const f = fixture({ locks }), abort = new AbortController();
  const pending = f.controller.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' }, signal: abort.signal });
  abort.abort(); assert.equal(f.calls.length, 0); holding.resolve(); await blocker;
  assert.deepEqual(await pending, { ok: false, reason: 'cancelled' }); assert.equal(f.calls.length, 0); assert.equal(f.controller.isBusy(), false);
});
test('canceled pending challenge or POST retains shared lock until settled; B login cannot interleave', async () => {
  for (const phase of ['challenge', 'post']) {
    const locks = serializedLocks(), held = deferred(), reached = deferred(), abort = new AbortController();
    const a = fixture({ locks, fetchImpl: async url => {
      if ((phase === 'challenge' && url === '/api/sesion/desafio') || (phase === 'post' && url.startsWith('/api/login/'))) { reached.resolve(); return held.promise; }
      return response({ csrf_token: 'D'.repeat(43) });
    } });
    const first = a.controller.login({ kind: 'password', body: { usuario: 'A', password: 'synthetic' }, signal: abort.signal });
    await reached.promise; abort.abort();
    const b = fixture({ locks }), second = login(b.controller);
    await Promise.resolve(); assert.equal(b.calls.length, 0); assert.equal(a.controller.isBusy(), true);
    assert.equal(locks.events.filter(e => e === 'released').length, 0);
    held.resolve(response(phase === 'challenge' ? { csrf_token: 'D'.repeat(43) } : dto()));
    assert.deepEqual(await first, { ok: false, reason: 'cancelled' }); assert.equal((await second).ok, true);
    assert.equal(a.store.getSession(), null); assert.equal(a.calls.some(c => c.url === '/api/sesion'), false);
    assert.deepEqual(b.calls.map(c => c.url), ['/api/sesion/desafio', '/api/login/browser', '/api/sesion']);
  }
});
test('cancel/dispose during receipt or bootstrap body prevents restoration and holds lock through body settlement', async () => {
  for (const phase of ['receipt', 'bootstrap']) for (const cancel of ['abort', 'dispose']) {
    const reached = deferred(), held = deferred(), abort = new AbortController(), locks = serializedLocks();
    const f = fixture({ locks, fetchImpl: async url => {
      if (url === '/api/sesion/desafio') return response({ csrf_token: 'D'.repeat(43) });
      const isBody = phase === 'receipt' ? url.startsWith('/api/login/') : url === '/api/sesion';
      if (isBody) return { ok: true, status: 200, headers: new Headers({ 'X-Render-Session-Context': dto().session_context }), json() { reached.resolve(); return held.promise; } };
      return response(dto());
    } });
    const pending = f.controller.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' }, signal: abort.signal });
    await reached.promise; if (cancel === 'abort') abort.abort(); else f.controller.dispose();
    install(f.store, dto(8, 'B'));
    const b = fixture({ locks }), next = b.controller.bootstrap(); await Promise.resolve(); assert.equal(b.calls.length, 0);
    held.resolve(dto()); assert.deepEqual(await pending, { ok: false, reason: 'cancelled' }); await next;
    assert.equal(f.store.getSession().usuario.id, 8);
  }
});
test('logout captures original intent before queue and cannot revoke or clear replacement B', async () => {
  const locks = serializedLocks(), holding = deferred(), acquired = deferred();
  const blocker = locks.request(BROWSER_SESSION_LOCK, { mode: 'exclusive' }, async () => { acquired.resolve(); await holding.promise; });
  await acquired.promise;
  const f = fixture({ locks }); install(f.store); const pending = f.controller.logout(); install(f.store, dto(8, 'B'));
  holding.resolve(); await blocker;
  assert.deepEqual(await pending, { revoked: false, reason: 'obsolete' }); assert.equal(f.calls.length, 0); assert.equal(f.store.getSession().usuario.id, 8);
});
test('logout sends original context; late logout response cannot invalidate new local B', async () => {
  const held = deferred(), reached = deferred();
  const f = fixture({ fetchImpl: (url, init) => {
    assert.equal(url, '/api/logout'); assert.equal(init.headers.get('X-Render-Session-Context'), dto().session_context);
    reached.resolve(); return held.promise;
  } });
  install(f.store); const pending = f.controller.logout(); await reached.promise; install(f.store, dto(8, 'B'));
  held.resolve(response({ ok: true }, 200, dto().session_context));
  assert.equal((await pending).revoked, false); assert.equal(f.store.getSession().usuario.id, 8);
});
test('logout success versus offline/unconfirmed stays honest without publishing credentials', async () => {
  for (const outcome of ['ok', 'false', 'offline']) {
    const f = fixture({ fetchImpl: async () => {
      if (outcome === 'offline') throw Error('PRIVATE_OFFLINE_DETAIL');
      return response({ ok: outcome === 'ok' }, 200, dto().session_context);
    } });
    install(f.store); const result = await f.controller.logout();
    assert.equal(result.revoked, outcome === 'ok'); if (outcome !== 'ok') assert.equal(result.reason, 'unconfirmed');
    assert.equal(f.store.getSession(), null); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});
test('logout during bootstrap cancels observation and returns unverified, never confirmed revocation', async () => {
  const held = deferred(), reached = deferred();
  const f = fixture({ fetchImpl: async () => { reached.resolve(); return held.promise; } });
  const pending = f.controller.bootstrap(); await reached.promise;
  assert.deepEqual(await f.controller.logout(), { revoked: false, reason: 'unverified_session' });
  held.resolve(response(dto())); assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  assert.equal(f.calls.length, 1); assert.equal(f.store.getSession(), null);
});
test('disposed old controller cannot clear new store session; busy operations reject without interleaving', async () => {
  const f = fixture(); await f.controller.bootstrap(); install(f.store, dto(8, 'B')); f.controller.dispose();
  assert.equal(f.store.getSession().usuario.id, 8); assert.deepEqual(await f.controller.logout(), { revoked: false, reason: 'disposed' });
  assert.throws(() => f.controller.bootstrap(), hasCode('browser_controller_disposed'));
  const held = deferred(), reached = deferred(), g = fixture({ fetchImpl: async () => { reached.resolve(); return held.promise; } });
  const pending = g.controller.bootstrap(); await reached.promise;
  assert.throws(() => login(g.controller), hasCode('browser_session_busy')); held.resolve(response(dto())); await pending;
});
test('lock rejection is generic, no fetch, and notifier throw/rejection cannot corrupt success', async () => {
  const f = fixture({ locks: { request() { return Promise.reject(Error('PRIVATE_LOCK_DETAIL')); } } });
  await assert.rejects(f.controller.bootstrap(), error => hasCode('browser_session_transport_failed')(error) && !error.message.includes('PRIVATE'));
  assert.equal(f.calls.length, 0); assert.equal(f.controller.isBusy(), false); assert.equal(f.store.getSnapshot().status, 'error');
  for (const notifyChange of [() => { throw Error('PRIVATE_NOTIFY'); }, () => Promise.reject(Error('PRIVATE_NOTIFY'))]) {
    const g = fixture({ notifyChange }); assert.equal((await login(g.controller)).ok, true);
  }
});
test('notifier superseding store while login unwinds converts success to obsolete', async () => {
  const store = createBrowserSessionState();
  const f = fixture({ store, notifyChange: () => install(store, dto(8, 'B')) });
  const result = await login(f.controller); assert.equal(result.ok, false); assert.equal(result.reason, 'obsolete'); assert.equal(store.getSession().usuario.id, 8);
});
test('subscriber superseding accepted bootstrap cannot return stale successful session', async () => {
  const store = createBrowserSessionState(); let changed = false;
  const unsubscribe = store.subscribe(() => {
    if (!changed && store.getSession()?.usuario.id === 7) { changed = true; install(store, dto(8, 'B')); }
  });
  const f = fixture({ store }); const result = await f.controller.bootstrap(); unsubscribe();
  assert.deepEqual(result, { ok: false, reason: 'obsolete' }); assert.equal(store.getSession().usuario.id, 8);
  f.controller.dispose(); assert.equal(store.getSession().usuario.id, 8);
});
test('supersession during lock release is fenced again after shared lock returns', async () => {
  const store = createBrowserSessionState(), serialized = serializedLocks();
  const locks = { request(name, options, callback) {
    return serialized.request(name, options, async () => {
      const result = await callback(); install(store, dto(8, 'B')); return result;
    });
  } };
  const f = fixture({ store, locks });
  assert.deepEqual(await f.controller.bootstrap(), { ok: false, reason: 'obsolete' });
  assert.equal(store.getSession().usuario.id, 8);
});
test('reentrant global disposal while loading or publishing authentication cannot restore its own observation', async () => {
  for (const phase of ['loading', 'authenticated']) {
    const f = fixture(); let stopped = false;
    const unsubscribe = f.store.subscribe(() => {
      if (!stopped && f.store.getSnapshot().status === phase) { stopped = true; f.controller.dispose(); }
    });
    const result = await f.controller.bootstrap(); unsubscribe();
    assert.equal(result.ok, false); assert.equal(f.store.getSession(), null);
    if (phase === 'loading') assert.equal(f.calls.length, 0);
    assert.equal(f.controller.isBusy(), false);
  }
});
test('disposing during publication cannot clear a newer reentrant B observation', async () => {
  const f = fixture(); let changed = false;
  const unsubscribe = f.store.subscribe(() => {
    if (!changed && f.store.getSession()?.usuario.id === 7) {
      changed = true; f.controller.dispose(); install(f.store, dto(8, 'B'));
    }
  });
  const result = await f.controller.bootstrap(); unsubscribe();
  assert.equal(result.ok, false); assert.equal(f.store.getSession().usuario.id, 8);
});
test('component cancellation after verified publication does not undo committed login; explicit logout still cancels', async () => {
  const f = fixture(), abort = new AbortController();
  const unsubscribe = f.store.subscribe(() => { if (f.store.getSession()) abort.abort(); });
  const result = await f.controller.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' }, signal: abort.signal });
  unsubscribe(); assert.ok(result.ok); assert.equal(f.store.getSession().usuario.id, 7);
  const g = fixture(); let invoked = false;
  const stop = g.store.subscribe(() => {
    if (!invoked && g.store.getSession()) { invoked = true; void g.controller.logout(); }
  });
  const canceled = await g.controller.bootstrap(); stop();
  assert.equal(canceled.ok, false); assert.equal(g.store.getSession(), null);
});
test('explicit logout during login notification or lock release withdraws only its published A intent', async () => {
  for (const phase of ['notify', 'release']) for (const replace of [false, true]) {
    const store = createBrowserSessionState(), base = serializedLocks(); let controller, logoutResult;
    const withdraw = () => {
      if (replace) install(store, dto(8, 'B'));
      logoutResult = controller.logout();
    };
    const locks = phase === 'release' ? { request(name, options, callback) {
      return base.request(name, options, async () => { const result = await callback(); withdraw(); return result; });
    } } : base;
    const f = fixture({ store, locks, notifyChange: phase === 'notify' ? withdraw : undefined }); controller = f.controller;
    const result = await login(controller);
    assert.deepEqual(result, { ok: false, reason: 'cancelled' });
    assert.deepEqual(await logoutResult, { revoked: false, reason: 'unverified_session' });
    assert.equal(store.getSession()?.usuario.id ?? null, replace ? 8 : null);
    assert.equal(f.calls.some(call => call.url === '/api/logout'), false);
  }
});
