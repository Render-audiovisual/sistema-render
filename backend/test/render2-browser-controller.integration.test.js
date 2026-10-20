import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { createBrowserSessionState } from '../../frontend/src/shared/session/browser-session-state.js';
import { createBrowserSessionController, BROWSER_SESSION_LOCK } from '../../frontend/src/shared/session/browser-session-controller.js';

const origin = 'http://127.0.0.1:5195';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const observed = promise => promise.then(value => ({ value }), error => ({ error }));

// Actual principal HTTP/password/PG, but a simulated Cookie jar and cooperative
// FIFO lock. This does not prove browser cookie policy, native Web Locks, a
// frontend proxy, Google authentication or cross-tab notification delivery.
test('browser controller serializes actual cookie changes and proof bootstrap without rebasing logout', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ browserSessions: true, port: 55683 });
  const gates = [], responses = [], pending = [], controllers = [];
  t.after(async () => {
    for (const gate of gates) gate.release.resolve();
    for (const controller of controllers) controller.dispose();
    await Promise.allSettled(pending);
    await Promise.allSettled(responses.filter(r => !r.bodyUsed && r.body && !r.body.locked).map(r => r.body.cancel()));
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own controller fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55683,
    url: 'postgresql://render2_fixture@127.0.0.1:55683/render2_local_test', identity });
  const jar = new Map(), requests = [], lockEvents = [];
  let tail = Promise.resolve(), activeLocks = 0, nextGate = null;
  const locks = { request(name, options, callback) {
    assert.equal(name, BROWSER_SESSION_LOCK); assert.equal(options.mode, 'exclusive');
    lockEvents.push('requested');
    const result = tail.then(async () => {
      assert.equal(activeLocks++, 0, 'Only one cooperative cookie operation owns the lock');
      lockEvents.push('acquired');
      try { return await callback(); } finally { activeLocks--; lockEvents.push('released'); }
    });
    tail = result.catch(() => {}); return result;
  } };
  const gate = path => {
    const value = { path, entered: deferred(), release: deferred() };
    gates.push(value); nextGate = value; return value;
  };
  const entered = async value => {
    let timer;
    try { await Promise.race([value.entered.promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Own HTTP barrier was not reached')), 5000);
    })]); } finally { clearTimeout(timer); }
  };
  const rawFetch = async (input, init = {}) => {
    const url = new URL(input, origin);
    assert.ok(url.origin === origin && url.pathname.startsWith('/api/'), 'Adapter permits only own API paths');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('Cookie'), false); assert.equal(headers.has('Authorization'), false);
    headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
    if (jar.size) headers.set('Cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const hold = nextGate?.path === url.pathname ? nextGate : null;
    if (hold) nextGate = null;
    requests.push({ path: url.pathname, method: init.method || 'GET', signal: Boolean(init.signal) });
    const response = await fetch(new URL(url.pathname + url.search, fixture.base), {
      ...init, headers, redirect: 'error', signal: init.signal || AbortSignal.timeout(10000),
    });
    responses.push(response);
    const cookies = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const cookie of cookies) {
      const pair = cookie.split(';')[0], at = pair.indexOf('=');
      assert.ok(at > 0, 'Response contains a valid cookie pair');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    // Apply the real Set-Cookie before withholding fetch resolution. Logical
    // cancellation must not pretend that this committed cookie never existed.
    if (hold) { hold.entered.resolve(); await hold.release.promise; }
    return response;
  };
  const make = () => {
    const store = createBrowserSessionState(), notifications = [], published = [];
    store.subscribe(() => { const value = store.getSession(); if (value) published.push(value.usuario.id); });
    const controller = createBrowserSessionController({ origin, store, fetchImpl: rawFetch, locks,
      notifyChange: value => notifications.push(value.reason) });
    controllers.push(controller); return { store, controller, notifications, published };
  };
  const login = (actor, usuario, extra = {}) => actor.controller.login({ kind: 'password',
    body: { usuario, password: fixturePassword }, ...extra });
  const track = operation => { const value = observed(operation); pending.push(value); return value; };
  const versions = () => fixture.query('SELECT id,session_version FROM usuarios WHERE id IN (91001,91003) ORDER BY id');
  const a = make(), b = make();

  await t.test('invalid mode is synchronous and does not acquire a lock or contact HTTP', () => {
    const count = requests.length, events = lockEvents.length;
    assert.throws(() => a.controller.login({ kind: 'invalid', body: {} }), error => error.code === 'browser_login_input_invalid');
    assert.equal(requests.length, count); assert.equal(lockEvents.length, events);
  });

  await t.test('B cannot even request a challenge until A cookie receipt AND proof bootstrap finish', async () => {
    const hold = gate('/api/login/browser'), start = requests.length;
    const first = track(login(a, 'qa_franco')); await entered(hold);
    assert.equal(a.store.getSession(), null); assert.equal(a.controller.isBusy(), true);
    const count = requests.length, second = track(login(b, 'qa_luciano'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(requests.length, count); assert.equal(activeLocks, 1);
    assert.equal(b.store.getSession(), null);
    hold.release.resolve();
    const ar = await first, br = await second;
    assert.ok(!ar.error && ar.value.ok && ar.value.session.usuario.id === 91001);
    assert.ok(!br.error && br.value.ok && br.value.session.usuario.id === 91003);
    assert.deepEqual(requests.slice(start).map(r => r.path), [
      '/api/sesion/desafio', '/api/login/browser', '/api/sesion',
      '/api/sesion/desafio', '/api/login/browser', '/api/sesion',
    ]);
    assert.equal((await b.controller.bootstrap()).session.usuario.id, 91003);
    assert.equal(a.store.getSession().usuario.id, 91001);
    assert.ok(!JSON.stringify(b.store.getSnapshot()).includes(jar.get('render_dev_session')), 'No JWT published in session memory');
  });

  await t.test('old A logout with cookie B never revokes or rebases onto B; current B logout is confirmed', async () => {
    const before = await versions();
    const stale = await a.controller.logout();
    assert.equal(stale.revoked, false); assert.deepEqual(await versions(), before);
    assert.equal((await b.controller.bootstrap()).session.usuario.id, 91003);
    assert.deepEqual(await b.controller.logout(), { revoked: true });
    const after = await versions();
    assert.equal(after[0].session_version, before[0].session_version);
    assert.equal(after[1].session_version, before[1].session_version + 1);
    assert.equal(b.store.getSession(), null);
    const check = make(); assert.equal((await check.controller.bootstrap()).ok, false);
  });

  for (const action of ['abort', 'dispose', 'logout']) await t.test(`${action} after cookie commit suppresses publication but retains lock until fetch settles`, async () => {
    const cancelled = make(), successor = make(), signal = new AbortController();
    const before = await versions(), hold = gate('/api/login/browser');
    const first = track(login(cancelled, 'qa_franco', { signal: signal.signal })); await entered(hold);
    assert.equal(requests.at(-1).signal, false, 'Cookie-setting login must not be aborted midflight');
    if (action === 'abort') signal.abort();
    else if (action === 'dispose') cancelled.controller.dispose();
    else assert.deepEqual(await cancelled.controller.logout(), { revoked: false, reason: 'unverified_session' });
    const count = requests.length, second = track(login(successor, 'qa_luciano'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(requests.length, count); assert.equal(activeLocks, 1);
    assert.equal(cancelled.controller.isBusy(), true); assert.equal(cancelled.store.getSession(), null);
    assert.deepEqual(await versions(), before, 'Cancellation/disposal is not server logout');
    hold.release.resolve();
    const result = await first, next = await second;
    assert.ok(!result.error && result.value.ok === false && result.value.reason === 'cancelled');
    assert.deepEqual(cancelled.published, []);
    assert.ok(!next.error && next.value.ok && next.value.session.usuario.id === 91003);
    assert.equal(cancelled.controller.isBusy(), false); assert.equal(activeLocks, 0);
    assert.equal((await successor.controller.bootstrap()).session.usuario.id, 91003);
    assert.deepEqual(await versions(), before);
    assert.ok(!requests.slice(count).some(r => r.path === '/api/logout'), 'No compensating logout of a potentially newer cookie');
  });
});
