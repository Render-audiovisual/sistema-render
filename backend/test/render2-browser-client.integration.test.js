import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { createBrowserSessionState, bootstrapBrowserSession } from '../../frontend/src/shared/session/browser-session-state.js';
import { createBrowserApiFetch } from '../../frontend/src/shared/session/browser-api-fetch.js';
import { createEditorialSessionGuard } from '../../frontend/src/components/EditorialPublicationControl.model.js';
import { createPersonalListSaveQueue } from '../../frontend/src/pages/personalListSaveQueue.js';
import { createHomeEditorialLoader } from '../../frontend/src/components/homeEditorialControl.js';
import { createHomeEscalationsLoader } from '../../frontend/src/components/homeEscalations.js';
import { createHomeTeamLoader } from '../../frontend/src/components/homeTeamWorkload.js';
import { createHomeProductionPageLoader } from '../../frontend/src/components/homeProductionPage.js';
import { createFeedbackInventoryLoader } from '../../frontend/src/pages/feedbackTaskInventory.js';

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
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'QA client intent private list', bloques: [] }) });
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
      createHomeProductionPageLoader, createFeedbackInventoryLoader]) {
      const changes = [];
      const loader = create({ sesion: store.getSession(), period: clock.period, readSession: store.getSession,
        request, onChange: value => changes.push(value) });
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
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'Must not create under B', bloques: [] }) }), 'browser_response_unverified');
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
});
