import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Opt-in actual HTTP against a generated disposable cluster only. Discovery
// does not connect to PostgreSQL or open listeners; never accepts an ambient URL.
test('profile credential verification shares a durable account budget without revoking sessions or writing on denial', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55903 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Own profile-abuse fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55903,
    url: 'postgresql://render2_fixture@127.0.0.1:55903/render2_local_test', identity });
  const api = (route, options) => request(f.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, 'Fixture login succeeds');
    assert.equal(typeof result.body.token, 'string');
    return { id: result.body.usuario.id, usuario, token: result.body.token };
  };
  const actor = await login('qa_luciano'), secondSession = await login('qa_luciano');
  const other = await login('qa_designer');
  const keyFor = id => createHmac('sha256', f.secret)
    .update(JSON.stringify(['auth-profile-credentials-v1', id])).digest('hex');
  const actorKey = keyFor(actor.id), otherKey = keyFor(other.id);
  const buckets = () => f.query('SELECT * FROM auth_login_buckets ORDER BY bucket_key');
  // Fingerprint complete rows, including credentials/versions, without printing
  // hashes, tokens or credentials in assertion diagnostics.
  const users = () => f.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id');
  const beforeUsers = await users(), loginBuckets = await buckets();
  assert.equal(loginBuckets.some(row => row.bucket_key === actorKey || row.bucket_key === otherKey), false);
  const wrong = 'Synthetic-wrong-current-profile-271!';
  const attempt = async (session, index) => {
    const route = index % 2 ? 'password' : 'perfil';
    const body = route === 'perfil'
      ? { usuario_actual: session.usuario, password_actual: wrong, usuario_nuevo: 'qa_profile271_never_saved' }
      : { usuario: session.usuario, password_actual: wrong, password_nueva: 'Synthetic-valid-new-profile-271!' };
    const response = await fetch(new URL(`/api/usuarios/${route}`, f.base), {
      method: 'PATCH', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
  };
  const check = (result, status) => {
    assert.equal(result.status, status, 'Expected credential verification HTTP status');
    assert.equal(result.body.code, status === 429 ? 'PROFILE_RATE_LIMITED' : 'current_password_invalid');
    assert.deepEqual(Object.keys(result.body).sort(), ['code', 'error']);
    assert.equal(typeof result.body.error, 'string');
    assert.ok(!result.body.error.includes(wrong), 'Credential must not enter error response');
    if (status === 429) {
      assert.match(result.retryAfter ?? '', /^[1-9]\d*$/);
      assert.ok(Number(result.retryAfter) <= 900);
    }
  };

  await t.test('twenty concurrent alternating forms and sessions consume exactly ten shared reservations', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      attempt(i % 4 < 2 ? actor : secondSession, i)));
    assert.equal(results.filter(result => result.status === 401).length, 10);
    assert.equal(results.filter(result => result.status === 429).length, 10);
    for (const result of results) check(result, result.status === 401 ? 401 : 429);
    const rows = await buckets(), profile = rows.filter(row => row.bucket_key === actorKey);
    assert.equal(profile.length, 1, 'Both endpoints and sessions have one account HMAC key');
    assert.equal(profile[0].attempts, 10);
    assert.match(profile[0].bucket_key, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(profile[0]).sort(), ['attempts', 'bucket_key', 'expires_at', 'window_started_at']);
    assert.equal(new Date(profile[0].expires_at) - new Date(profile[0].window_started_at), 900000);
    assert.deepEqual(rows.filter(row => row.bucket_key !== actorKey), loginBuckets,
      'Profile attempts neither consume login buckets nor create endpoint/peer buckets');
    assert.deepEqual(await users(), beforeUsers);
  });

  await t.test('exhausted denials preserve every bucket including expired cleanup candidates', async () => {
    const expiredKey = 'e'.repeat(64);
    assert.notEqual(expiredKey, actorKey); assert.notEqual(expiredKey, otherKey);
    await f.query(`INSERT INTO auth_login_buckets(bucket_key,attempts,window_started_at,expires_at)
      VALUES($1,1,clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes')`, [expiredKey]);
    const before = await buckets();
    for (const i of [0, 1]) check(await attempt(actor, i), 429);
    assert.equal((await api('/sesion', { token: actor.token })).status, 200);
    assert.equal((await api('/inicio', { token: secondSession.token })).status, 200);
    assert.deepEqual(await buckets(), before, 'Denial must not increment, renew or prune buckets');
    assert.deepEqual(await users(), beforeUsers);
  });

  await t.test('another actor independently reaches password verification', async () => {
    const [before] = await f.query('SELECT * FROM auth_login_buckets WHERE bucket_key=$1', [actorKey]);
    check(await attempt(other, 1), 401);
    const rows = await f.query('SELECT bucket_key,attempts FROM auth_login_buckets WHERE bucket_key=$1', [otherKey]);
    assert.deepEqual(rows, [{ bucket_key: otherKey, attempts: 1 }]);
    assert.deepEqual(await f.query('SELECT * FROM auth_login_buckets WHERE bucket_key=$1', [actorKey]), [before]);
    assert.deepEqual(await users(), beforeUsers);
  });

  await t.test('fixture-only expiry reopens verification without modifying account or session policy', async () => {
    await f.query(`UPDATE auth_login_buckets SET window_started_at=clock_timestamp()-interval '16 minutes',
      expires_at=clock_timestamp()-interval '1 minute' WHERE bucket_key=$1`, [actorKey]);
    check(await attempt(actor, 0), 401);
    const [reset] = await f.query(`SELECT attempts,expires_at>clock_timestamp() AS live,
      extract(epoch FROM (expires_at-window_started_at))::int AS seconds FROM auth_login_buckets WHERE bucket_key=$1`, [actorKey]);
    assert.deepEqual(reset, { attempts: 1, live: true, seconds: 900 });
    assert.deepEqual(await users(), beforeUsers);
  });

  await t.test('all original sessions retain authenticated GET access after failures and throttling', async () => {
    for (const session of [actor, secondSession, other]) {
      assert.equal((await api('/sesion', { token: session.token })).status, 200);
      assert.equal((await api('/inicio', { token: session.token })).status, 200);
    }
    assert.deepEqual(await users(), beforeUsers);
  });
});
