import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';

// Actual principal HTTP, manually carried cookies, generated disposable PG only.
// Not a native-browser/TLS proof. Ordinary discovery opens no services.
test('cookie and bearer profile verification share one account budget without weakening transport boundaries', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55904, browserSessions: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Own cookie profile-abuse fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55904,
    url: 'postgresql://render2_fixture@127.0.0.1:55904/render2_local_test', identity });
  const usuario = 'qa_luciano';
  const session = await loginProductionCookieSession(f.base, usuario, fixturePassword);
  const sibling = await loginProductionCookieSession(f.base, usuario, fixturePassword);
  const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
  assert.equal(login.status, 200); assert.equal(typeof login.body.token, 'string');
  assert.equal(login.body.usuario.id, session.user.id);
  const token = login.body.token;
  const actorKey = createHmac('sha256', f.secret)
    .update(JSON.stringify(['auth-profile-credentials-v1', session.user.id])).digest('hex');
  const buckets = () => f.query('SELECT * FROM auth_login_buckets ORDER BY bucket_key');
  const users = () => f.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id');
  const beforeUsers = await users(), loginBuckets = await buckets();
  assert.equal(loginBuckets.some(row => row.bucket_key === actorKey), false);
  const bodyFor = route => route === 'perfil'
    ? { usuario_actual: usuario, password_actual: 'Synthetic-wrong-cookie-272!', usuario_nuevo: 'qa_cookie272_never_saved' }
    : { usuario, password_actual: 'Synthetic-wrong-cookie-272!', password_nueva: 'Synthetic-valid-cookie-272!' };
  const cookieHeaders = {
    cookie: session.cookie, 'x-render-session-context': session.context, 'x-render-csrf': session.csrf,
  };
  // Raw HTTP is limited to malformed transport proofs and inspecting Set-Cookie;
  // normal cookie operations use the shared production-context-checking helper.
  const raw = async (route, headers = {}) => {
    const response = await fetch(new URL(`/api/usuarios/${route}`, f.base), {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { origin: 'http://127.0.0.1:5195', 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', ...headers }, body: JSON.stringify(bodyFor(route)),
    });
    return { status: response.status, body: await response.json(),
      setCookie: response.headers.get('set-cookie'), retryAfter: response.headers.get('retry-after') };
  };
  const cookieCall = (route, method = 'GET', body) => productionCookieRequest(f.base, `/api${route}`, { session, method, body });

  await t.test('unauthenticated, crossed contexts and invalid CSRF reject before any budget reservation', async () => {
    for (const route of ['perfil', 'password']) {
      assert.equal((await raw(route)).status, 401);
      const crossed = await raw(route, { ...cookieHeaders, 'x-render-session-context': sibling.context });
      assert.equal(crossed.status, 409); assert.equal(crossed.body.code, 'browser_session_changed');
      const csrf = await raw(route, { ...cookieHeaders, 'x-render-csrf': sibling.csrf });
      assert.equal(csrf.status, 403); assert.equal(csrf.body.code, 'browser_csrf_invalid');
      assert.deepEqual(await buckets(), loginBuckets);
      assert.deepEqual(await users(), beforeUsers);
    }
  });

  await t.test('twenty concurrent cookie/bearer attempts across both forms admit exactly ten verifications', async () => {
    // Each transport exercises each endpoint five times; neither can acquire
    // an independent budget by changing transport or credential form.
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => {
      const route = i % 2 ? 'password' : 'perfil', body = bodyFor(route);
      return i % 4 < 2
        ? cookieCall(`/usuarios/${route}`, 'PATCH', body)
        : request(f.base, `/api/usuarios/${route}`, { token, method: 'PATCH', body });
    }));
    assert.equal(results.filter(result => result.status === 401).length, 10);
    assert.equal(results.filter(result => result.status === 429).length, 10);
    for (const result of results) {
      assert.ok([401, 429].includes(result.status), 'Only wrong-password or budget denial is expected');
      assert.equal(result.body.code, result.status === 401 ? 'current_password_invalid' : 'PROFILE_RATE_LIMITED');
    }
    const rows = await buckets(), profile = rows.filter(row => row.bucket_key === actorKey);
    assert.equal(profile.length, 1); assert.equal(profile[0].attempts, 10);
    assert.match(profile[0].bucket_key, /^[a-f0-9]{64}$/);
    assert.deepEqual(rows.filter(row => row.bucket_key !== actorKey), loginBuckets,
      'Existing independent login buckets remain byte-for-byte unchanged');
    assert.deepEqual(await users(), beforeUsers);
  });

  await t.test('budget denial does not clear cookies, mutate buckets or revoke authenticated GET access', async () => {
    const before = await buckets();
    for (const route of ['perfil', 'password']) {
      const denied = await raw(route, cookieHeaders);
      assert.equal(denied.status, 429); assert.equal(denied.body.code, 'PROFILE_RATE_LIMITED');
      assert.equal(denied.setCookie, null, 'Throttling must not clear or replace the held cookie');
      assert.match(denied.retryAfter ?? '', /^[1-9]\d*$/);
      assert.ok(Number(denied.retryAfter) <= 900);
    }
    for (const held of [session, sibling]) {
      assert.equal((await productionCookieRequest(f.base, '/api/sesion', { session: held })).status, 200);
      assert.equal((await productionCookieRequest(f.base, '/api/inicio', { session: held })).status, 200);
    }
    assert.equal((await request(f.base, '/api/inicio', { token })).status, 200);
    assert.deepEqual(await buckets(), before);
    assert.deepEqual(await users(), beforeUsers);
  });
});
