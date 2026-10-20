import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginAbuseBucketKey, LOGIN_IDENTIFIER_LIMIT } from '../src/login-abuse.js';

const origin = 'http://127.0.0.1:5195';
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Explicit opt-in, real principal/PG and actual password verification. The API
// listens at a dynamic fixture port while Origin is the configured :5195.
// This tests the HTTP transport contract, NOT a browser, TLS or proxy setup.
test('principal browser sessions: real passwords, cookie/context isolation, current authority and logout CAS', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ browserSessions: true, port: 55680 });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own browser-session fixture stopped and removed: ${fixture.root}`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55680/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55680, url, identity });
  const http = async (route, { method = 'GET', headers = {}, body, raw } = {}) => {
    const response = await fetch(new URL(`/api${route}`, fixture.base), { method, redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(raw === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: raw }),
    });
    const text = await response.text();
    let data = null; try { data = JSON.parse(text); } catch { /* OPTIONS may be empty/plaintext. */ }
    return { status: response.status, body: data, cookie: response.headers.get('set-cookie'), cache: response.headers.get('cache-control'),
      allowOrigin: response.headers.get('access-control-allow-origin'), credentials: response.headers.get('access-control-allow-credentials'),
      allowHeaders: response.headers.get('access-control-allow-headers'), vary: response.headers.get('vary'), retry: response.headers.get('retry-after') };
  };
  const checked = (response, status = 200, code) => {
    assert.equal(response.status, status, 'Principal HTTP status; never print credentials, cookies or response bodies');
    if (code) assert.equal(response.body?.code, code);
    return response;
  };
  const noCookie = response => assert.equal(response.cookie, null, 'Old/error responses must not overwrite a newer session cookie');
  const pair = response => { assert.ok(typeof response.cookie === 'string', 'Expected cookie'); return response.cookie.split(';')[0]; };
  const cookieFlags = (response, name, sameSite, maxAge) => {
    assert.ok(response.cookie?.startsWith(`${name}=`), 'Expected environment-specific cookie name');
    const flags = response.cookie.split(';').map(value => value.trim());
    for (const flag of ['Path=/', 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${maxAge}`]) assert.ok(flags.includes(flag), `Expected ${flag}`);
    assert.ok(!flags.includes('Secure'), 'Only the explicit numeric-loopback HTTP fixture uses a dev cookie');
    assert.ok(!/;\s*Domain=/i.test(response.cookie), 'Cookie is host-only'); assert.equal(response.cache, 'no-store');
  };
  const challenge = async () => {
    const response = checked(await http('/sesion/desafio', { headers: { origin, 'sec-fetch-site': 'same-origin' } }));
    cookieFlags(response, 'render_dev_login', 'Strict', 600);
    assert.deepEqual(Object.keys(response.body), ['csrf_token']); return { cookie: pair(response), csrf: response.body.csrf_token };
  };
  const loginHeaders = proof => ({ origin, cookie: proof.cookie, 'x-render-csrf': proof.csrf, 'sec-fetch-site': 'same-origin' });
  const loginBrowser = async usuario => {
    const proof = await challenge();
    const response = checked(await http('/login/browser', { method: 'POST', headers: loginHeaders(proof), body: { usuario, password: fixturePassword } }));
    cookieFlags(response, 'render_dev_session', 'Lax', 28800);
    assert.deepEqual(Object.keys(response.body).sort(), ['usuario', 'session_context', 'csrf_token'].sort());
    const cookie = pair(response), token = cookie.slice('render_dev_session='.length);
    assert.ok(!JSON.stringify(response.body).includes(token), 'Browser JSON must not expose bearer credential');
    return { cookie, context: response.body.session_context, csrf: response.body.csrf_token, user: response.body.usuario };
  };
  const headersFor = session => ({ origin, cookie: session.cookie, 'x-render-session-context': session.context,
    'x-render-csrf': session.csrf, 'sec-fetch-site': 'same-origin' });
  const bootstrap = async session => {
    const response = checked(await http('/sesion', { headers: headersFor(session) })); noCookie(response);
    assert.equal(response.cache, 'no-store'); assert.equal(response.body.usuario.id, session.user.id);
    assert.ok(response.body.session_context === session.context && response.body.csrf_token === session.csrf, 'Bootstrap must match exact cookie context');
    assert.equal(Object.hasOwn(response.body, 'token'), false); return response.body;
  };
  const loginBearer = async usuario => {
    const response = checked(await http('/login', { method: 'POST', body: { usuario, password: fixturePassword } })); noCookie(response);
    assert.equal(typeof response.body.token, 'string'); return response.body.token;
  };
  const tables = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  const snapshot = async (includeRate = true) => {
    const state = {};
    for (const name of tables.filter(name => includeRate || name !== 'auth_login_buckets'))
      state[name] = fingerprint(await fixture.query(`SELECT * FROM "${name}" r ORDER BY to_jsonb(r)::text`));
    return state;
  };
  let a, b, bearer, editingTask;

  await t.test('real synthetic passwords issue HttpOnly cookies; bootstrap restores stable identities and bearer compatibility stays separate', async () => {
    a = await loginBrowser('qa_franco'); b = await loginBrowser('qa_luciano');
    assert.equal(a.user.id, 91001); assert.equal(b.user.id, 91003);
    assert.ok(a.context !== b.context && a.csrf !== b.csrf, 'Independent logins have independent binding');
    await bootstrap(a); await bootstrap(b);
    bearer = await loginBearer('qa_franco');
    const legacy = checked(await http('/inicio', { headers: { authorization: `Bearer ${bearer}` } }));
    assert.equal(legacy.body.user.id, 91001); noCookie(legacy);
    const before = await snapshot();
    checked(await http('/inicio', { headers: headersFor(b) }));
    checked(await http('/contratos', { headers: headersFor(a) }));
    checked(await http('/contratos', { headers: headersFor(b) }), 403);
    checked(await http('/sueldos', { headers: headersFor(b) }), 403); // No permitted finance/provider call.
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('valid cookie+context+CSRF performs actual JSON operational writes and persists actor-bound rows', async () => {
    const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA browser session task client',true) RETURNING id");
    const created = checked(await http('/tareas', { method: 'POST', headers: headersFor(a), body: {
      titulo: 'QA browser-session operational task', workspace: 'render_os', tipo_tarea: 'edicion', subtipo: 'video',
      cliente_id: client.id, asignado_a_id: 91003, colaborador_ids: [],
    } }), 201).body;
    editingTask = created;
    assert.deepEqual(await fixture.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [created.id]),
      [{ tarea_id: created.id, usuario_id: 91003, tipo: 'responsable' }]);
    const saved = checked(await http(`/tareas/${created.id}?workspace=render_os`, { method: 'PATCH', headers: headersFor(b),
      body: { expected_revision: created.revision, estado: 'en_progreso' } })).body;
    assert.equal(saved.revision, created.revision + 1); assert.equal(saved.estado, 'en_progreso'); editingTask = saved;
    assert.deepEqual(checked(await http('/moodboards/boards/initialize', { method: 'POST', headers: headersFor(b), body: {} })).body, { ok: true });
    assert.equal((await fixture.query('SELECT board_id FROM moodboard_board_clients WHERE cliente_id=$1', [client.id])).length, 1);
  });

  await t.test('cookie B plus A context rejects all mutation paths with 409 and no SQL writes, including multipart entry', async () => {
    const crossed = { ...headersFor(a), cookie: b.cookie }, before = await snapshot();
    const calls = [
      ['/moodboards/boards/initialize', 'POST', {}],
      [`/tareas/${editingTask.id}?workspace=render_os`, 'PATCH', { expected_revision: editingTask.revision, estado: 'en_revision' }],
      [`/tareas/${editingTask.id}?workspace=render_os`, 'DELETE', undefined], ['/logout', 'POST', {}],
    ];
    for (const [route, method, body] of calls) noCookie(checked(await http(route, { method, headers: crossed, body }), 409, 'browser_session_changed'));
    noCookie(checked(await http('/drive/uploads', { method: 'POST', headers: { ...crossed,
      'content-type': 'multipart/form-data; boundary=render2-boundary' }, raw: '--render2-boundary--\r\n' }), 409, 'browser_session_changed'));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('CSRF/origin denials and malformed/duplicate cookie or bearer ambiguity never fall back or write', async () => {
    const before = await snapshot(), valid = headersFor(b);
    const missingCSRF = { ...valid }; delete missingCSRF['x-render-csrf'];
    const missingContext = { ...valid }; delete missingContext['x-render-session-context'];
    noCookie(checked(await http('/moodboards/boards/initialize', { method: 'POST', headers: missingCSRF, body: {} }), 403, 'browser_csrf_invalid'));
    noCookie(checked(await http('/moodboards/boards/initialize', { method: 'POST', headers: { ...valid, 'x-render-csrf': a.csrf }, body: {} }), 403, 'browser_csrf_invalid'));
    noCookie(checked(await http('/moodboards/boards/initialize', { method: 'POST', headers: missingContext, body: {} }), 409, 'browser_session_changed'));
    for (const headers of [{ ...valid, origin: 'https://hostile.invalid' }, { ...valid, 'sec-fetch-site': 'cross-site' }])
      noCookie(checked(await http('/moodboards/boards/initialize', { method: 'POST', headers, body: {} }), 403));
    for (const cookie of ['render_dev_session=invalid', `${b.cookie}; ${b.cookie}`, `${b.cookie}; malformed`, '__Host-render_session=invalid']) {
      noCookie(checked(await http('/inicio', { headers: { origin, cookie } }), 401));
      noCookie(checked(await http('/inicio', { headers: { cookie, authorization: `Bearer ${bearer}` } }), 400, 'browser_credentials_ambiguous'));
    }
    noCookie(checked(await http('/inicio', { headers: { cookie: b.cookie, authorization: `Bearer ${bearer}` } }), 400, 'browser_credentials_ambiguous'));
    noCookie(checked(await http('/inicio'), 401));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('login challenge and 32kb parser reject invalid browser password/Google input before rate or identity writes; no provider is configured', async () => {
    const proof = await challenge(), headers = loginHeaders(proof), before = await snapshot();
    const input = { usuario: 'qa_luciano', password: fixturePassword };
    for (const badHeaders of [{ origin }, { ...headers, origin: 'https://hostile.invalid' },
      { ...headers, 'x-render-csrf': a.csrf }, { ...headers, cookie: `${proof.cookie}; ${proof.cookie}` },
      { ...headers, authorization: `Bearer ${bearer}` }])
      noCookie(checked(await http('/login/browser', { method: 'POST', headers: badHeaders, body: input }), 403));
    for (const body of [{}, [], { usuario: [], password: 'x' }, { usuario: 'x', password: {} },
      { usuario: 'x', password: 'x', rol: 'admin' }, { usuario: '', password: 'x' }])
      noCookie(checked(await http('/login/browser', { method: 'POST', headers, body }), 400));
    for (const body of [{}, [], { credential: '' }, { credential: [] }, { credential: 'x', rol: 'admin' }])
      noCookie(checked(await http('/login/browser/google', { method: 'POST', headers, body }), 400));
    for (const route of ['/login/browser', '/login/browser/google']) {
      noCookie(checked(await http(route, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, raw: '{"broken":' }), 400));
      const large = JSON.stringify(route.endsWith('/google') ? { credential: 'x'.repeat(33000) } : { usuario: 'x', password: 'x'.repeat(33000) });
      noCookie(checked(await http(route, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, raw: large }), 413));
    }
    assert.deepEqual(await snapshot(), before, 'Rejected login inputs must not reserve rate buckets or mutate accounts');
    const business = await snapshot(false);
    noCookie(checked(await http('/login/browser/google', { method: 'POST', headers, body: { credential: 'synthetic-valid-shaped-no-provider-token' } }), 500));
    assert.deepEqual(await snapshot(false), business, 'Absent Google configuration cannot link users or issue cookies');
  });

  await t.test('credentialed CORS is configured-origin-only; hostile origins receive no wildcard or reflected credentials', async () => {
    const allowed = checked(await http('/sesion/desafio', { headers: { origin } }));
    assert.equal(allowed.allowOrigin, origin); assert.equal(allowed.credentials, 'true'); assert.ok(allowed.vary?.includes('Origin'));
    const preflight = checked(await http('/tareas', { method: 'OPTIONS', headers: { origin,
      'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type,x-render-session-context,x-render-csrf' } }), 204);
    assert.equal(preflight.allowOrigin, origin); assert.equal(preflight.credentials, 'true');
    assert.ok(preflight.allowHeaders?.toLowerCase().includes('x-render-session-context'));
    assert.ok(preflight.allowHeaders?.toLowerCase().includes('x-render-csrf'));
    for (const method of ['GET', 'OPTIONS']) {
      const denied = checked(await http('/sesion/desafio', { method, headers: { origin: 'https://hostile.invalid' } }), 403);
      assert.ok(denied.allowOrigin !== '*' && denied.allowOrigin !== 'https://hostile.invalid', 'Never wildcard/reflect hostile credentialed origin'); noCookie(denied);
    }
  });

  await t.test('current DB role, revocation and inactivity govern cookie authorization immediately', async () => {
    await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=91001");
    try {
      assert.equal((await bootstrap(a)).usuario.rol, 'edicion');
      noCookie(checked(await http('/contratos', { headers: headersFor(a) }), 403));
    } finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91001"); }
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
    let before = await snapshot(); noCookie(checked(await http('/sesion', { headers: headersFor(b) }), 401)); assert.deepEqual(await snapshot(), before);
    b = await loginBrowser('qa_luciano'); await bootstrap(b);
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=91003');
    try {
      before = await snapshot(); noCookie(checked(await http('/sesion', { headers: headersFor(b) }), 401)); assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91003'); }
  });

  await t.test('blocked stale logout CAS cannot revoke a new epoch and never sets cookies; normal logout revokes only its account', async () => {
    const barrier = new pg.Client({ connectionString: url }); await barrier.connect();
    let pending;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT id FROM usuarios WHERE id=91001 FOR UPDATE');
      const pid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = http('/logout', { method: 'POST', headers: headersFor(a), body: {} });
      let blocked = false; const until = Date.now() + 2500;
      while (Date.now() < until) {
        if ((await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))', [pid])).rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(blocked, 'Actual logout must wait behind the fixture-held actor row lock');
      const version = (await barrier.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001 RETURNING session_version')).rows[0].session_version;
      await barrier.query('COMMIT');
      const stale = checked(await pending, 401); noCookie(stale);
      assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91001'))[0].session_version, version);
      a = await loginBrowser('qa_franco'); await bootstrap(a); await bootstrap(b);
      const success = checked(await http('/logout', { method: 'POST', headers: headersFor(a), body: {} })); noCookie(success); assert.equal(success.body.ok, true);
      noCookie(checked(await http('/sesion', { headers: headersFor(a) }), 401));
      noCookie(checked(await http('/inicio', { headers: { authorization: `Bearer ${bearer}` } }), 401));
      await bootstrap(b);
    } finally {
      await barrier.query('ROLLBACK'); if (pending) await pending.catch(() => {}); await barrier.end();
    }
  });

  await t.test('browser and external password routes share the same durable identifier rate bucket; exhaust only at suite end', async () => {
    const identifier = 'qa_browser_rate_shared_55680', proof = await challenge(), before = await snapshot(false);
    const body = { usuario: identifier, password: 'synthetic-invalid-only' };
    for (let attempt = 0; attempt < LOGIN_IDENTIFIER_LIMIT; attempt += 1) {
      const browser = attempt % 2 === 0;
      noCookie(checked(await http(browser ? '/login/browser' : '/login', { method: 'POST',
        ...(browser ? { headers: loginHeaders(proof) } : {}), body }), 401));
    }
    for (const route of ['/login/browser', '/login']) {
      const result = checked(await http(route, { method: 'POST', ...(route.endsWith('/browser') ? { headers: loginHeaders(proof) } : {}), body }), 429);
      assert.ok(/^[1-9]\d*$/.test(result.retry || ''), 'Rate denial includes bounded retry'); noCookie(result);
    }
    const key = loginAbuseBucketKey('identifier', identifier, fixture.secret);
    const [bucket] = await fixture.query('SELECT attempts FROM auth_login_buckets WHERE bucket_key=$1', [key]);
    assert.equal(bucket.attempts, LOGIN_IDENTIFIER_LIMIT + 1, 'Existing durable limiter saturates at limit+1 across both routes');
    assert.deepEqual(await snapshot(false), before, 'Only documented rate reservations may change on rejected login attempts');
  });
});
