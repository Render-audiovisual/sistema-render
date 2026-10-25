import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Two actual forked server entrypoints, not two in-process routers. The harness
// owns every worker (including on failure) and one generated disposable PG.
test('profile credential budget is shared across actual processes and survives their replacement', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55907, clusterOnly: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own multiprocess profile-abuse fixture and entry workers stopped; cleanup ENOENT: ${f.root}`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55907,
    url: 'postgresql://render2_fixture@127.0.0.1:55907/render2_local_test', identity });
  const first = await f.launchActual({ entry: 'server' });
  const a = (await first.ready).base;
  const second = await f.launchActual({ entry: 'server' });
  const b = (await second.ready).base;
  assert.notEqual(a, b, 'Independently listening actual entry workers');
  const login = async (base, usuario) => {
    const result = await request(base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, 'Synthetic fixture login succeeds');
    assert.equal(typeof result.body.token, 'string');
    return { id: result.body.usuario.id, usuario, token: result.body.token };
  };
  const actor = await login(a, 'qa_luciano'), sibling = await login(b, 'qa_luciano');
  const other = await login(b, 'qa_designer');
  assert.equal(actor.id, sibling.id); assert.notEqual(actor.id, other.id);
  const keyFor = id => createHmac('sha256', f.secret)
    .update(JSON.stringify(['auth-profile-credentials-v1', id])).digest('hex');
  const actorKey = keyFor(actor.id), otherKey = keyFor(other.id);
  const buckets = () => f.query('SELECT * FROM auth_login_buckets ORDER BY bucket_key');
  // xmin/ctid additionally detect identical-value UPDATEs on denied requests;
  // snapshots prove persisted invariants, not a trace of every SQL statement.
  const bucketVersions = () => f.query(`SELECT bucket_key,xmin::text AS version,ctid::text AS location,
    md5(to_jsonb(b)::text) AS fingerprint FROM auth_login_buckets b ORDER BY bucket_key`);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row => row.tablename).filter(name => !/^auth_|^browser_session/.test(name));
  assert.ok(tables.includes('usuarios'));
  for (const name of tables) assert.match(name, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
  const domain = async () => {
    const current = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
      .map(row => row.tablename).filter(name => !/^auth_|^browser_session/.test(name));
    assert.deepEqual(current, tables, 'Domain table list remains stable');
    const hashes = {};
    for (const name of tables) {
      const rows = await f.query(`SELECT * FROM "${name}" r ORDER BY to_jsonb(r)::text`);
      hashes[name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    return hashes;
  };
  // Includes complete usuarios rows, password hashes, versions and all history;
  // only digests, never source rows/credentials, enter assertion diagnostics.
  const beforeDomain = await domain(), beforeLogin = await buckets();
  assert.equal(beforeLogin.some(row => row.bucket_key === actorKey || row.bucket_key === otherKey), false);
  const loginUnchanged = async () => assert.deepEqual((await buckets())
    .filter(row => ![actorKey, otherKey, expiredKey].includes(row.bucket_key)), beforeLogin);
  const wrong = 'Synthetic-wrong-multiprocess-277!';
  const attempt = async (base, session, index) => {
    const route = index % 2 ? 'password' : 'perfil';
    const body = route === 'perfil'
      ? { usuario_actual: session.usuario, password_actual: wrong, usuario_nuevo: 'qa_multi277_never_saved' }
      : { usuario: session.usuario, password_actual: wrong, password_nueva: 'Synthetic-valid-multiprocess-277!' };
    const response = await fetch(new URL(`/api/usuarios/${route}`, base), {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(),
      retryAfter: response.headers.get('retry-after'), setCookie: response.headers.get('set-cookie') };
  };
  const check = (result, status) => {
    assert.equal(result.status, status, 'Expected profile verification HTTP status');
    assert.deepEqual(Object.keys(result.body).sort(), ['code', 'error']);
    assert.equal(result.body.code, status === 401 ? 'current_password_invalid' : 'PROFILE_RATE_LIMITED');
    assert.equal(typeof result.body.error, 'string');
    for (const value of [wrong, fixturePassword, f.secret, actor.token, sibling.token, other.token,
      'postgresql://', 'password_hash', 'SELECT ', 'stack'])
      assert.equal(result.body.error.includes(value), false, 'Sanitized profile error');
    assert.equal(result.setCookie, null, 'Verification failure must not replace or clear a session cookie');
    if (status === 429) {
      assert.match(result.retryAfter ?? '', /^[1-9]\d*$/);
      assert.ok(Number(result.retryAfter) <= 900);
    }
  };
  const validSessions = async bases => {
    for (const base of bases) for (const session of [actor, sibling, other]) {
      assert.equal((await request(base, '/api/sesion', { token: session.token })).status, 200);
      assert.equal((await request(base, '/api/inicio', { token: session.token })).status, 200);
    }
  };
  const expiredKey = 'e'.repeat(64);
  assert.ok(![actorKey, otherKey, ...beforeLogin.map(row => row.bucket_key)].includes(expiredKey));

  await t.test('concurrent forms, sessions and workers admit ten shared account verifications', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      attempt(i % 4 < 2 ? a : b, i % 8 < 4 ? actor : sibling, i)));
    assert.equal(results.filter(result => result.status === 401).length, 10);
    assert.equal(results.filter(result => result.status === 429).length, 10);
    for (const result of results) check(result, result.status === 401 ? 401 : 429);
    const rows = await buckets(), profile = rows.filter(row => row.bucket_key === actorKey);
    assert.equal(profile.length, 1); assert.equal(profile[0].attempts, 10);
    assert.match(profile[0].bucket_key, /^[a-f0-9]{64}$/);
    assert.equal(new Date(profile[0].expires_at) - new Date(profile[0].window_started_at), 900000);
    assert.deepEqual(rows.filter(row => row.bucket_key !== actorKey), beforeLogin);
    await validSessions([a, b]);
    assert.deepEqual(await domain(), beforeDomain);
  });

  let exhausted, versions;
  await t.test('denials on both workers preserve counters, timestamps and expired cleanup candidates', async () => {
    await f.query(`INSERT INTO auth_login_buckets(bucket_key,attempts,window_started_at,expires_at)
      VALUES($1,1,clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes')`, [expiredKey]);
    exhausted = await buckets(); versions = await bucketVersions();
    for (const base of [a, b]) for (const i of [0, 1]) check(await attempt(base, actor, i), 429);
    assert.deepEqual(await buckets(), exhausted);
    assert.deepEqual(await bucketVersions(), versions, 'No bucket tuple rewritten or pruned by denial');
    await loginUnchanged(); assert.deepEqual(await domain(), beforeDomain);
  });

  await t.test('stopping both entry workers and starting a replacement does not reset the durable budget', async () => {
    await Promise.all([first.stop(), second.stop()]);
    const replacement = await f.launchActual({ entry: 'server' });
    const base = (await replacement.ready).base;
    // Never require a different port after restart: the OS may reuse one.
    for (const [session, index] of [[actor, 0], [sibling, 1]]) check(await attempt(base, session, index), 429);
    assert.deepEqual(await buckets(), exhausted);
    assert.deepEqual(await bucketVersions(), versions);
    await validSessions([base]); await loginUnchanged();
    assert.deepEqual(await domain(), beforeDomain);

    check(await attempt(base, other, 1), 401);
    assert.deepEqual(await f.query('SELECT bucket_key,attempts FROM auth_login_buckets WHERE bucket_key=$1', [otherKey]),
      [{ bucket_key: otherKey, attempts: 1 }]);
    assert.deepEqual((await buckets()).filter(row => row.bucket_key === actorKey),
      exhausted.filter(row => row.bucket_key === actorKey));
    await loginUnchanged(); await validSessions([base]);
    assert.deepEqual(await domain(), beforeDomain);
    t.diagnostic(`Domain hashes unchanged across ${tables.length} public tables; account rows include credentials and versions.`);
    // Replacement remains registered with f.cleanup even if an assertion fails.
  });
});
