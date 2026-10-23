import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { createBrowserSessionState, bootstrapBrowserSession, captureBrowserSessionIntent } from '../../frontend/src/shared/session/browser-session-state.js';
import { createBrowserApiFetch } from '../../frontend/src/shared/session/browser-api-fetch.js';
import { createEditorialSessionGuard } from '../../frontend/src/components/EditorialPublicationControl.model.js';
import { createPersonalListSaveQueue } from '../../frontend/src/pages/personalListSaveQueue.js';
import { createHomeEditorialLoader } from '../../frontend/src/components/homeEditorialControl.js';
import { createHomeEscalationsLoader } from '../../frontend/src/components/homeEscalations.js';
import { createHomeTeamLoader } from '../../frontend/src/components/homeTeamWorkload.js';
import { createHomeProductionPageLoader } from '../../frontend/src/components/homeProductionPage.js';
import { createFeedbackInventoryLoader } from '../../frontend/src/pages/feedbackTaskInventory.js';
import { createPersonalHomeLoader } from '../../frontend/src/pages/personalHome.js';
import { createApplicationSession } from '../../frontend/src/shared/session/application-session.js';
import { createLoginAttempts } from '../../frontend/src/shared/session/login-attempt.js';
import { createProfileSessionGuard } from '../../frontend/src/shared/session/profile-session.js';
import { createCapturedRequest, isSessionFailure } from '../../frontend/src/shared/session/captured-request.js';
import { canRetryTaskUpdate } from '../../frontend/src/workspace-task-state.js';

const origin = 'http://127.0.0.1:5195';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const observed = promise => promise.then(value => ({ value }), error => ({ error }));

// Explicitly a Node HTTP adapter + simulated Cookie jar, NOT browser cookie
// policy, a frontend proxy, Web Storage, Google login or an XSS/security claim.
// All responses and password verification come from the actual principal/PG.
test('browser client against principal HTTP: memory observations, exact mutation intent and deferred response fencing', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ browserSessions: true, port: 55682 });
  const rawResponses = [], gates = [];
  t.after(async () => {
    for (const gate of gates) gate.release.resolve();
    // Cancel unconsumed native clone branches in parallel, not sequentially:
    // a tee branch can wait for the other branch's cancellation to complete.
    await Promise.allSettled(rawResponses.filter(response => !response.bodyUsed && response.body && !response.body.locked)
      .map(response => response.body.cancel()));
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own browser-client fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55682,
    url: 'postgresql://render2_fixture@127.0.0.1:55682/render2_local_test', identity });
  const jar = new Map(), requests = [];
  let nextBodyGate = null, nextResponseGate = null;
  const gate = () => { const value = { entered: deferred(), release: deferred() }; gates.push(value); return value; };
  const waitEntered = async current => {
    let timer;
    try { await Promise.race([current.entered.promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Controlled HTTP observation did not reach its barrier')), 3000);
    })]); } finally { clearTimeout(timer); }
  };
  const wrapRawResponse = (response, entry, bodyGate = null) => {
    rawResponses.push(response);
    return new Proxy(response, { get(target, key) {
      if (key === 'clone') return () => wrapRawResponse(target.clone(), entry);
      if (key === 'json') return async () => {
        entry.bodyReads += 1;
        if (bodyGate) { bodyGate.entered.resolve(); await bodyGate.release.promise; }
        return target.json();
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const rawFetch = async (input, init = {}) => {
    // This test transport never resolves an arbitrary URL or contacts a
    // provider. Mapping is only /api on the configured synthetic origin.
    const intended = new URL(input, origin);
    assert.ok(intended.origin === origin && intended.pathname.startsWith('/api/'), 'Test adapter accepts only its own API paths');
    const headers = new Headers(init.headers || {});
    assert.equal(headers.has('Cookie'), false, 'Only the simulated jar supplies cookies');
    assert.equal(headers.has('Authorization'), false, 'No bearer injected into the cookie adapter');
    headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
    if (jar.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    const entry = { path: intended.pathname, method: init.method || 'GET', status: null, bodyReads: 0 };
    requests.push(entry);
    const bodyGate = intended.pathname === '/api/inicio' ? nextBodyGate : null;
    const responseGate = intended.pathname === '/api/inicio' ? nextResponseGate : null;
    if (bodyGate) nextBodyGate = null;
    if (responseGate) nextResponseGate = null;
    const response = await fetch(new URL(`${intended.pathname}${intended.search}`, fixture.base), {
      ...init, headers, redirect: 'error', signal: init.signal || AbortSignal.timeout(5000),
    });
    entry.status = response.status;
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie()
      : response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0], at = pair.indexOf('=');
      assert.ok(at > 0, 'Valid response cookie pair'); jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const wrapped = wrapRawResponse(response, entry, bodyGate);
    if (responseGate) { responseGate.entered.resolve(); await responseGate.release.promise; }
    return wrapped;
  };
  const store = createBrowserSessionState();
  const apiFetch = createBrowserApiFetch({ origin, store, fetchImpl: rawFetch });
  const checked = (response, status = 200) => { assert.equal(response.status, status, 'HTTP status; cookie/token values are never diagnostics'); return response; };
  const loginJarOnly = async usuario => {
    const challenge = checked(await rawFetch('/api/sesion/desafio', { credentials: 'same-origin', cache: 'no-store' }));
    const proof = await challenge.json();
    const response = checked(await rawFetch('/api/login/browser', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Render-CSRF': proof.csrf_token },
      body: JSON.stringify({ usuario, password: fixturePassword }),
    }));
    return response.json(); // Login changes only jar; accepting identity is an explicit bootstrap below.
  };
  const bootstrap = async expectedId => {
    assert.equal(await bootstrapBrowserSession({ store, fetchImpl: rawFetch }), true);
    assert.equal(store.getSnapshot().status, 'authenticated'); assert.equal(store.getSession().usuario.id, expectedId);
    const serialized = JSON.stringify(store.getSnapshot());
    assert.ok(!serialized.includes(jar.get('render_dev_session')), 'JWT is confined to simulated HTTP cookie jar, not session memory');
    assert.equal(Object.hasOwn(store.getSession(), 'token'), false);
    assert.deepEqual(Object.keys(store.getSession()).sort(), ['usuario', 'session_context', 'csrf_token'].sort());
  };
  const resetA = async () => { await loginJarOnly('qa_franco'); await bootstrap(91001); return store.captureIntent(); };
  const rejectsCode = (operation, code) => assert.rejects(operation, error => error?.name === 'BrowserSessionError' && error.code === code);
  const tables = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  const snapshot = async () => {
    const state = {};
    for (const name of tables) state[name] = digest(await fixture.query(`SELECT * FROM "${name}" r ORDER BY to_jsonb(r)::text`));
    return state;
  };
  let firstIntent, staleIntent, listId, listVersion;

  await t.test('actual A login does not authenticate memory until explicit proof-checked bootstrap; memory contains no JWT', async () => {
    assert.equal(store.getSession(), null); assert.equal(store.getSnapshot().status, 'unknown');
    const login = await loginJarOnly('qa_franco'); assert.equal(login.usuario.id, 91001);
    assert.equal(store.getSession(), null); assert.equal(store.getSnapshot().status, 'unknown');
    await bootstrap(91001); firstIntent = store.captureIntent(); assert.equal(store.isCurrent(firstIntent), true);
    assert.ok(Object.isFrozen(store.getSession()) && Object.isFrozen(store.getSession().usuario));
    const home = await (await apiFetch('/api/inicio')).json(); assert.equal(home.user.id, 91001);
  });

  await t.test('explicit A intent creates/edits real private list rows; current response consumers and clone read actual persisted data', async () => {
    const response = await apiFetch('/api/listas-personales', { method: 'POST', sessionIntent: firstIntent,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: randomUUID(), titulo: 'QA client intent private list', bloques: [] }) });
    checked(response, 201);
    const cloned = response.clone(), created = await response.json(), repeated = await cloned.json();
    assert.equal(created.id, repeated.id); assert.equal(typeof created.id, 'string'); listId = created.id; listVersion = created.version;
    assert.deepEqual(await fixture.query('SELECT id,usuario_id,titulo FROM listas_personales WHERE id=$1', [listId]),
      [{ id: listId, usuario_id: 91001, titulo: 'QA client intent private list' }]);
    const saved = await (await apiFetch(`/api/listas-personales/${listId}`, { method: 'PATCH', sessionIntent: store.captureIntent(),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'QA persisted through exact A intent', expected_version: listVersion }) })).json();
    listVersion = saved.version;
    assert.equal((await fixture.query('SELECT titulo FROM listas_personales WHERE id=$1', [listId]))[0].titulo, 'QA persisted through exact A intent');
    const raw = await apiFetch('/api/inicio');
    assert.throws(() => raw.body, error => error?.code === 'browser_stream_not_supported');
    assert.equal((await raw.json()).user.id, 91001);
  });

  await t.test('existing home and feedback loaders consume actual cookie-bound principal DTOs without changing business rows', async () => {
    const [clock] = await fixture.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period");
    const before = await snapshot();
    const request = async (url, options) => { const result = await apiFetch(url, options); checked(result); return result.json(); };
    for (const create of [createHomeEditorialLoader, createHomeEscalationsLoader, createHomeTeamLoader,
      createHomeProductionPageLoader, createFeedbackInventoryLoader, createPersonalHomeLoader]) {
      const changes = [];
      const loader = create({ sesion: store.getSession(), period: clock.period, readSession: store.getSession,
        request, allowTeamReview: true, onChange: value => changes.push(value) });
      try {
        if (loader.refresh) await loader.refresh(); else await loader.load({ view: 'all' });
        assert.equal(changes.at(-1)?.status, 'ready', 'Actual migrated loader must parse its principal DTO');
      } finally { loader.dispose(); }
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('existing personal-list queue composes the existing editorial guard with genuine cookie intent and persists CAS', async () => {
    const guard = createEditorialSessionGuard(store.getSession(), store.getSession);
    const saved = [];
    const requestDto = async (url, options) => {
      const response = await apiFetch(url, options), body = await response.json();
      if (!response.ok) throw Object.assign(new Error('Fixture write rejected'), { status: response.status });
      return body;
    };
    const queue = createPersonalListSaveQueue({ session: store.getSession(), readSession: store.getSession,
      request: (url, options) => guard.request(requestDto, url, options), delayMs: 60000,
      onSaved: value => saved.push(value.row) });
    try {
      assert.equal(queue.schedule({ key: `list:${listId}`, url: `/api/listas-personales/${listId}`, version: listVersion,
        payload: { titulo: 'QA existing queue through cookie binding' }, meta: { listId, recordId: listId } }), true);
      assert.equal(await queue.flush(), true); assert.equal(saved.length, 1); listVersion = saved[0].version;
      const [row] = await fixture.query('SELECT titulo,version,usuario_id FROM listas_personales WHERE id=$1', [listId]);
      assert.equal(row.titulo, 'QA existing queue through cookie binding'); assert.equal(row.version, listVersion); assert.equal(row.usuario_id, 91001);
    } finally { queue.dispose(); guard.cancel(); }
  });

  await t.test('existing queued A draft cannot write through a later B cookie or resume under B', async () => {
    let denied = 0, acknowledged = 0;
    const queue = createPersonalListSaveQueue({ session: store.getSession(), readSession: store.getSession,
      delayMs: 60000, onDenied: () => { denied++; }, onSaved: () => { acknowledged++; },
      request: async (url, options) => { const result = await apiFetch(url, options); return result.json(); } });
    try {
      assert.equal(queue.schedule({ key: `list:${listId}`, url: `/api/listas-personales/${listId}`, version: listVersion,
        payload: { titulo: 'Must not transfer private A draft' }, meta: { listId, recordId: listId } }), true);
      await loginJarOnly('qa_luciano');
      const before = await snapshot(); assert.equal(await queue.flush(), false);
      assert.equal(denied, 1); assert.equal(acknowledged, 0); assert.deepEqual(await snapshot(), before);
      await bootstrap(91003); const count = requests.length;
      assert.equal(await queue.retry(), false); assert.equal(requests.length, count);
    } finally { queue.dispose(); }
    await resetA();
  });

  await t.test('unsafe requests without genuine captured intent or with bearer/conflicting binding stop locally before HTTP/SQL', async () => {
    const before = await snapshot(), count = requests.length;
    await rejectsCode(() => apiFetch('/api/moodboards/boards/initialize', { method: 'POST', body: '{}' }), 'browser_intent_obsolete');
    await rejectsCode(() => apiFetch('/api/moodboards/boards/initialize', { method: 'POST', sessionIntent: { ...firstIntent }, body: '{}' }), 'browser_intent_obsolete');
    await rejectsCode(() => apiFetch('/api/inicio', { headers: { Authorization: 'Bearer synthetic-prohibited' } }), 'browser_bearer_not_allowed');
    await rejectsCode(() => apiFetch('/api/inicio', { headers: { 'X-Render-Session-Context': 'different' } }), 'browser_intent_headers_conflict');
    assert.equal(requests.length, count); assert.deepEqual(await snapshot(), before);
  });

  await t.test('cookie B/local A mutation is never rebased; server 409 has no SQL effects and wrapper invalidates only old observation', async () => {
    staleIntent = store.captureIntent(); const localA = store.getSession();
    const login = await loginJarOnly('qa_luciano'); assert.equal(login.usuario.id, 91003);
    assert.ok(store.getSession() === localA, 'Cookie rotation must not silently change in-memory identity');
    const before = await snapshot(), count = requests.length;
    await rejectsCode(() => apiFetch('/api/listas-personales', { method: 'POST', sessionIntent: staleIntent,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: randomUUID(), titulo: 'Must not create under B', bloques: [] }) }), 'browser_response_unverified');
    assert.equal(requests.length, count + 1); assert.equal(requests.at(-1).status, 409);
    assert.equal(store.getSession(), null); assert.equal(store.getSnapshot().status, 'anonymous');
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('cookie B/local A GET rejects mismatched server proof before any B body is delivered; explicit B bootstrap never revives A intent', async () => {
    staleIntent = await resetA(); await loginJarOnly('qa_luciano');
    assert.equal(store.getSession().usuario.id, 91001);
    const before = await snapshot();
    await rejectsCode(() => apiFetch('/api/inicio'), 'browser_response_context_changed');
    assert.equal(requests.at(-1).status, 200); assert.equal(requests.at(-1).bodyReads, 0, 'Reject B proof before consuming B data');
    assert.equal(store.getSession(), null); assert.deepEqual(await snapshot(), before);
    await bootstrap(91003); const bSession = store.getSession(), count = requests.length, current = await snapshot();
    assert.equal(store.isCurrent(staleIntent), false);
    await rejectsCode(() => apiFetch(`/api/listas-personales/${listId}`, { method: 'PATCH', sessionIntent: staleIntent,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'Never rebase old A draft', expected_version: listVersion }) }), 'browser_intent_obsolete');
    assert.equal(requests.length, count); assert.ok(store.getSession() === bSession); assert.deepEqual(await snapshot(), current);
    assert.equal((await (await apiFetch('/api/inicio')).json()).user.id, 91003);
  });

  await t.test('old response consumers/clone and JSON already reading are fenced after actual B bootstrap without overwriting B', async () => {
    await resetA();
    const old = await apiFetch('/api/inicio'), oldClone = old.clone();
    const held = gate(); nextBodyGate = held;
    const waiting = await apiFetch('/api/inicio');
    const pending = observed(waiting.json());
    await waitEntered(held);
    try {
      await loginJarOnly('qa_luciano'); await bootstrap(91003); const bSession = store.getSession();
      const before = await snapshot();
      held.release.resolve();
      const result = await pending;
      assert.ok(result.error?.code === 'browser_intent_obsolete' && result.value === undefined, 'Late A JSON cannot escape the post-read fence');
      for (const response of [old, oldClone]) for (const consumer of ['json', 'text', 'blob', 'arrayBuffer'])
        await rejectsCode(() => response[consumer](), 'browser_intent_obsolete');
      assert.throws(() => old.clone(), error => error?.code === 'browser_intent_obsolete');
      assert.throws(() => old.body, error => error?.code === 'browser_stream_not_supported');
      assert.ok(store.getSession() === bSession); assert.equal(store.getSnapshot().status, 'authenticated');
      assert.deepEqual(await snapshot(), before);
    } finally { held.release.resolve(); await pending; }
  });

  await t.test('delayed real A unauthorized response cannot invalidate a newer B bootstrap', async () => {
    await resetA();
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
    const held = gate(); nextResponseGate = held;
    const pending = observed(apiFetch('/api/inicio')); await waitEntered(held);
    try {
      assert.equal(requests.at(-1).status, 401);
      await loginJarOnly('qa_luciano'); await bootstrap(91003); const bSession = store.getSession(), before = await snapshot();
      held.release.resolve(); const result = await pending;
      assert.ok(result.error?.code === 'browser_intent_obsolete' && result.value === undefined, 'Old 401 is obsolete, not authority to clear B');
      assert.ok(store.getSession() === bSession); assert.equal(store.getSnapshot().status, 'authenticated');
      assert.deepEqual(await snapshot(), before);
      assert.equal((await (await apiFetch('/api/inicio')).json()).user.id, 91003);
    } finally { held.release.resolve(); await pending; }
  });

  await t.test('document runtime composes actual principal login, reads, identity fencing and logout without Storage', async () => {
    const locks = { request(name, options, work) {
      assert.equal(name, 'render:browser-session:v1'); assert.equal(options.mode, 'exclusive');
      return Promise.resolve().then(work); // Sequential test adapter, not native Web Locks proof.
    } };
    const runtime = createApplicationSession({ mode: 'browser', fetchImpl: rawFetch, location: { origin }, locks,
      storage: new Proxy({}, { get() { throw new Error('Cookie runtime must not access Web Storage'); } }) });
    try {
      const initial = runtime.start(); assert.equal(runtime.start(), initial);
      assert.equal((await initial).session.usuario.id, 91003);
      await runtime.login({ kind: 'password', body: { usuario: 'qa_franco', password: fixturePassword } });
      assert.equal(runtime.getSession().usuario.id, 91001);
      const original = runtime.getSession(), stale = createEditorialSessionGuard(original, runtime.getSession);
      const before = await snapshot();
      assert.equal((await (await runtime.fetch('/api/inicio')).json()).user.id, 91001);
      assert.deepEqual(await snapshot(), before);
      await runtime.login({ kind: 'password', body: { usuario: 'qa_agustin', password: fixturePassword } });
      const live = runtime.getSession(), count = requests.length;
      assert.equal(live.usuario.id, 91002); assert.notEqual(live, original);
      assert.equal(await stale.request(runtime.fetch, '/api/inicio'), undefined);
      assert.equal(stale.isCurrent(), false);
      assert.equal(requests.length, count, 'Stale view may not dispatch under the current cookie');
      assert.equal(runtime.start(), initial, 'Start is initial-only, never an identity authority after login');
      assert.equal(runtime.getSession(), live);
      assert.deepEqual(await runtime.logout(), { revoked: true });
      assert.equal(runtime.getSession(), null);
    } finally { runtime.dispose(); }
  });

  await t.test('existing Login attempt uses the real runtime and principal; verified publication survives page cleanup', async () => {
    const runtime = createApplicationSession({ mode: 'browser', fetchImpl: rawFetch, location: { origin },
      locks: { request: (_name, _options, work) => Promise.resolve().then(work) } });
    const states = [], navigations = [];
    const attempts = createLoginAttempts({ getRuntime: () => runtime, readSession: runtime.getSession,
      request: () => assert.fail('Browser Login must not use a bearer endpoint'),
      save: () => assert.fail('Browser Login must not persist bearer credentials'),
      navigate: user => navigations.push(user.id), onState: state => states.push(state) });
    attempts.mount();
    let remove = () => {};
    try {
      assert.equal((await runtime.start()).reason, 'anonymous');
      assert.equal(await attempts.login('password', { usuario: 'qa_luciano', password: fixturePassword }), true);
      assert.deepEqual(navigations, [91003]);
      assert.equal((await (await runtime.fetch('/api/inicio')).json()).user.id, 91003);
      remove = runtime.subscribe(() => { if (runtime.getSession()) attempts.cleanup(); });
      assert.equal(await attempts.login('password', { usuario: 'qa_franco', password: fixturePassword }), false);
      assert.equal(runtime.getSession().usuario.id, 91001, 'Page cleanup after verified commit is not global logout');
      assert.deepEqual(navigations, [91003], 'Unmounted page does not navigate or save late');
      assert.equal((await (await runtime.fetch('/api/inicio')).json()).user.id, 91001);
      assert.deepEqual(await runtime.logout(), { revoked: true });
    } finally { remove(); attempts.cleanup(); runtime.dispose(); }
  });

  await t.test('actual profile photo, failed verification and credential revocation use captured runtime identity', async () => {
    let failVerification = false;
    const runtime = createApplicationSession({ mode: 'browser', location: { origin },
      fetchImpl: (url, options) => failVerification && url === '/api/sesion'
        ? Promise.resolve(new Response(null, { status: 503 })) : rawFetch(url, options),
      locks: { request: (_name, _options, work) => Promise.resolve().then(work) } });
    const navigations = [];
    const guard = () => createProfileSessionGuard({ session: runtime.getSession(), readSession: runtime.getSession,
      isMounted: () => true, runtime, save: () => assert.fail('No bearer save'), clear: () => assert.fail('No Storage clear'),
      navigate: href => navigations.push(href) });
    const patch = (current, path, body) => current.request(runtime.fetch, path, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const password = 'Synthetic-profile73-only!';
    try {
      await runtime.login({ kind: 'password', body: { usuario: 'qa_franco', password: fixturePassword } });
      const first = guard(), original = runtime.getSession();
      const photo = 'data:image/png;base64,c3ludGhldGljLXByb2ZpbGU=';
      const response = checked(await patch(first, '/api/usuarios/foto', { usuario: 'qa_franco', foto_perfil: photo }));
      const user = await first.applyPhoto(await response.json());
      assert.equal(user, runtime.getSession().usuario); assert.notEqual(runtime.getSession(), original);
      assert.equal(user.foto_perfil, photo);
      assert.equal((await fixture.query('SELECT foto_perfil FROM usuarios WHERE id=91001'))[0].foto_perfil, photo);
      const saved = guard();
      const removal = checked(await patch(saved, '/api/usuarios/foto', { usuario: 'qa_franco', foto_perfil: '' }));
      failVerification = true;
      await assert.rejects(saved.applyPhoto(await removal.json()), error => error.code === 'browser_bootstrap_failed');
      assert.equal(runtime.getSession(), null); assert.equal(runtime.getSnapshot().status, 'error');
      assert.equal((await fixture.query('SELECT foto_perfil FROM usuarios WHERE id=91001'))[0].foto_perfil, null,
        'Successful photo PATCH remains committed even if its subsequent verification fails');
      failVerification = false;
      await runtime.login({ kind: 'password', body: { usuario: 'qa_franco', password: fixturePassword } });
      const credentials = guard(), live = runtime.getSession();
      const denied = await patch(credentials, '/api/usuarios/password', { usuario: 'qa_franco',
        password_actual: 'incorrect-synthetic', password_nueva: password });
      assert.equal(denied.status, 401); assert.equal((await denied.json()).code, 'current_password_invalid');
      assert.equal(credentials.current(), true); assert.equal(runtime.getSession(), live);
      const renamed = checked(await patch(credentials, '/api/usuarios/perfil', { usuario_actual: 'qa_franco',
        password_actual: fixturePassword, usuario_nuevo: 'qa_franco_profile73' }));
      assert.equal((await renamed.json()).id, 91001);
      assert.equal(credentials.requireReauthentication(), true); assert.equal(runtime.getSession(), null);
      await runtime.login({ kind: 'password', body: { usuario: 'qa_franco_profile73', password: fixturePassword } });
      const updated = guard();
      const changed = checked(await patch(updated, '/api/usuarios/password', { usuario: 'qa_franco_profile73',
        password_actual: fixturePassword, password_nueva: password }));
      assert.deepEqual(await changed.json(), { ok: true });
      assert.equal(updated.requireReauthentication(), true); assert.equal(runtime.getSession(), null);
      await runtime.login({ kind: 'password', body: { usuario: 'qa_franco_profile73', password } });
      assert.equal(runtime.getSession().usuario.id, 91001);
      assert.deepEqual(navigations, ['/login', '/login']);
      assert.deepEqual(await runtime.logout(), { revoked: true });
    } finally { runtime.dispose(); }
  });

  await t.test('actual Workspace update callback preserves cookie actor through CAS retry and blocks late or queued A work under B', async () => {
    const runtime = createApplicationSession({ mode: 'browser', location: { origin }, fetchImpl: rawFetch,
      locks: { request: (_name, _options, work) => Promise.resolve().then(work) } });
    const source = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
    const begin = source.indexOf('  const logActivity ='), end = source.indexOf('  const createTask =', begin);
    assert.ok(begin >= 0 && end > begin);
    const actualCallbacks = source.slice(begin, end);
    const dto = async (url, options) => {
      const response = await runtime.fetch(url, options), value = await response.json();
      if (!response.ok) throw Object.assign(new Error('Synthetic principal request failed'), { status: response.status });
      return value;
    };
    const create = (task, requestDto = dto, queue = Promise.resolve()) => {
      let rendered = [task]; const effects = [], reviewCalls = [];
      const tasksRef = { current: [task] }, sesion = runtime.getSession();
      const deps = { sesion, tasksRef, updateQueuesRef: { current: new Map([[task.id, queue]]) }, clients: [],
        setTasks: update => { effects.push('render'); rendered = update(rendered); },
        notify: () => effects.push('notify'), canRetryTaskUpdate, isSessionFailure,
        markReviewQueueStale: (guard, uncertain = false) => {
          guard.assertCurrent(); reviewCalls.push({ guard, uncertain });
          effects.push(uncertain ? 'review-uncertain' : 'review-stale');
        },
        captureRequest: () => createCapturedRequest({ session: sesion, readSession: runtime.getSession, request: requestDto }) };
      const update = new Function('deps', `const {sesion,tasksRef,updateQueuesRef,clients,setTasks,notify,canRetryTaskUpdate,isSessionFailure,captureRequest,markReviewQueueStale}=deps;\n${actualCallbacks}\nreturn updateTask;`)(deps);
      return { update, tasksRef, effects, reviewCalls, get rendered() { return rendered; },
        replaceView: () => { rendered = [{ id: task.id, revision: 999, titulo: 'B view' }]; tasksRef.current = rendered; } };
    };
    const login = usuario => runtime.login({ kind: 'password', body: { usuario, password: fixturePassword } });
    try {
      await login('qa_agustin');
      const task = await dto('/api/tareas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        sessionIntent: captureBrowserSessionIntent(runtime.getSession()),
        body: JSON.stringify({ titulo: 'QA74 captured task', asignado_a_id: 91002, tipo_tarea: 'diseno', workspace: 'render_os' }) });
      const f = create(task);
      await dto(`/api/tareas/${task.id}?workspace=render_os`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        sessionIntent: captureBrowserSessionIntent(runtime.getSession()), body: JSON.stringify({ prioridad: 'alta', expected_revision: task.revision }) });
      const before = requests.length;
      const updated = await f.update(task.id, { titulo: 'QA74 CAS kept actor' }, 'QA74 recorded activity');
      assert.equal(updated.titulo, 'QA74 CAS kept actor'); assert.equal(updated.prioridad, 'alta');
      const taskCalls = requests.slice(before).filter(entry => entry.path === `/api/tareas/${task.id}`);
      assert.deepEqual(taskCalls.map(entry => [entry.method, entry.status]), [['PATCH', 409], ['GET', 200], ['PATCH', 200]]);
      assert.equal(f.effects.filter(value => value === 'notify').length, 1);
      assert.deepEqual(f.reviewCalls.map(call => call.uncertain), [true, false], '409 invalidates review observation; the successful permitted CAS retry marks confirmed staleness');
      assert.equal(f.reviewCalls[0].guard,f.reviewCalls[1].guard,'retry and review invalidation remain bound to the same captured actor');
      const held = gate(), late = create(updated, async (url, options) => {
        const value = await dto(url, options);
        if (options?.method === 'PATCH') { held.entered.resolve(); await held.release.promise; }
        return value;
      });
      const commentCount = (await fixture.query('SELECT count(*)::int AS n FROM tarea_comentarios WHERE tarea_id=$1', [task.id]))[0].n;
      const pending = observed(late.update(task.id, { titulo: 'QA74 A persisted before B' }, 'Must not record under B'));
      await waitEntered(held); await login('qa_luciano'); late.replaceView(); const effectCount = late.effects.length;
      held.release.resolve(); assert.ok(isSessionFailure((await pending).error));
      assert.equal(late.effects.length, effectCount); assert.equal(late.rendered[0].titulo, 'B view');
      assert.equal(late.reviewCalls.length,0,'late A ACK cannot invalidate the B review view');
      assert.equal((await fixture.query('SELECT count(*)::int AS n FROM tarea_comentarios WHERE tarea_id=$1', [task.id]))[0].n, commentCount);
      await login('qa_agustin');
      const current = await dto(`/api/tareas/${task.id}?workspace=render_os`), waiting = gate();
      const queued = create(current, dto, waiting.release.promise);
      const result = observed(queued.update(task.id, { titulo: 'Must never dispatch under B' }, null));
      await login('qa_luciano'); const count = requests.length; waiting.release.resolve();
      assert.ok(isSessionFailure((await result).error)); assert.equal(requests.length, count);
      assert.equal(queued.reviewCalls.length,0,'queued obsolete A work cannot mark the B review view stale');
      assert.equal((await fixture.query('SELECT titulo FROM tareas WHERE id=$1', [task.id]))[0].titulo, 'QA74 A persisted before B');
    } finally { runtime.dispose(); }
  });
});
