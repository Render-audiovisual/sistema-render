import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const blockedError = 'Demasiados intentos de acceso. Esperá unos minutos y volvé a intentar.';
const privateCredential = 'QA_LOGIN_CREDENTIAL_PRIVATE_55623';
test('public login abuse: durable PostgreSQL limits, bounded failures and unchanged principal business state', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55623, deferLoginAbuseMigration: true });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own login-abuse fixture stopped and removed: ${fixture.root}`);
  });
  const hash = await bcrypt.hash(fixturePassword, 4);
  const spacedPassword = '  QA synthetic password with spaces  ';
  const spacedHash = await bcrypt.hash(spacedPassword, 4);
  for (const [id, active, alias, passwordHash] of [
    [112001, true, null, hash], [112002, false, null, hash],
    [112003, true, 'qa-login-ambiguous@example.invalid', hash], [112004, true, null, hash],
    [112005, true, null, spacedHash],
  // Ambiguity must involve an actual configured login identifier, never notification routing.
  ]) await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,google_email)
    VALUES ($1,$2,'QA login synthetic identity','edicion',$3,$4,1,$5)`,
  [id, id === 112004 ? 'qa-login-ambiguous@example.invalid' : `qa_login_${id}`, passwordHash, active, alias]);
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA auth invariant client') RETURNING id");
  await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
    VALUES ('QA historical066 approved','QA fixture',$1,'edicion','aprobada',
      '{"workspace":"render_os","revision_aprobada":true,"qa_history":"preserve"}')`, [client.id]);
  await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,"fecha_publicación_real")
    VALUES ($1,'video','publicada','2026-09-01','2026-09-01T12:00:00Z')`, [client.id]);
  // Capture pre067 tables once, including ledger/users/sessions/history. The
  // sole new security table is deliberately outside business invariance.
  const businessTables = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(businessTables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  const business = () => fixture.query(`SELECT * FROM (${businessTables.map(name => `SELECT '${name}' AS name,
    COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM "${name}" r`).join(' UNION ALL ')}) snapshot ORDER BY name`);
  const raw = async (path, body, { headers = {}, base = fixture.base, rawBody } = {}) => {
    const response = await fetch(new URL(path, base), { method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', ...headers }, body: rawBody === undefined ? JSON.stringify(body) : rawBody });
    const json = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: json, retryAfter: response.headers.get('retry-after') };
  };
  const password = (usuario, value = fixturePassword, options) => raw('/api/login', { usuario, password: value }, options);
  const wrong = (usuario = `qa_unknown_${randomUUID()}`, options) => password(usuario, privateCredential, options);
  const buckets = () => fixture.query('SELECT * FROM auth_login_buckets ORDER BY bucket_key');
  const phaseReset = async () => {
    // Explicit fixture-only expiry/reset; never a public reset endpoint or user change.
    await fixture.query(`UPDATE auth_login_buckets SET window_started_at=clock_timestamp()-interval '16 minutes',
      expires_at=clock_timestamp()-interval '1 minute'; DELETE FROM auth_login_buckets WHERE expires_at<clock_timestamp()`);
  };
  const errorOnly = (result, status) => {
    assert.equal(result.status, status); assert.deepEqual(Object.keys(result.body), ['error']);
    assert.equal(typeof result.body.error, 'string'); assert.ok(result.body.error.length > 0);
    assert.ok(!result.body.error.includes(privateCredential)); assert.ok(!result.body.error.includes('auth_login_buckets'));
    assert.ok(!result.body.error.includes('SELECT ')); assert.ok(!result.body.error.includes('stack'));
    if (status === 429) {
      assert.equal(result.body.error, blockedError); assert.match(result.retryAfter ?? '', /^[1-9]\d*$/);
      assert.ok(Number(result.retryAfter) <= 900);
    }
  };
  const parallel = async (inputs, execute, count = 16) => {
    const results = new Array(inputs.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(count, inputs.length) }, async () => {
      while (cursor < inputs.length) { const index = cursor++; results[index] = await execute(inputs[index], index); }
    })); return results;
  };
  const observe = async (pattern, waitEvent, attempts = 40) => {
    for (let i = 0; i < attempts; i++) {
      const rows = await fixture.query(`SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE $1
        AND (wait_event=$2 OR wait_event_type=$2)`, [pattern, waitEvent]);
      if (rows.length) return true;
      await new Promise(resolve => setTimeout(resolve, 15));
    } return false;
  };
  const seedPeer = async () => {
    await phaseReset(); errorOnly(await wrong('qa_peer_seed_a'), 401); errorOnly(await wrong('qa_peer_seed_b'), 401);
    const peers = await fixture.query('SELECT bucket_key FROM auth_login_buckets WHERE attempts=2');
    assert.equal(peers.length, 1); return peers[0].bucket_key;
  };
  let currentToken;
  await t.test('067 additive populated066 upgrade preserves every existing table and creates zero inferred buckets', async () => {
    const name = '067_auth_login_buckets.sql';
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [name]), []);
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.auth_login_buckets') AS relation"), [{ relation: null }]);
    const before = await business(); await fixture.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(await business(), before); assert.deepEqual(await buckets(), []);
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [name]);
  });
  await t.test('bounded plain credential shapes and small parser reject before any durable reservation', async () => {
    await phaseReset(); const before = await business();
    for (const body of [null, [], 'text', {}, { usuario: [], password: 'x' }, { usuario: 'x', password: {} },
      { usuario: 'x', password: 'x', role: 'admin' }, { usuario: '', password: 'x' }, { usuario: '   ', password: 'x' },
      { usuario: 'qa\nuser', password: 'x' }, { usuario: 'qa\u0085user', password: 'x' }, { usuario: 'é'.repeat(160) + 'a', password: 'x' },
      { usuario: 'x', password: '' }, { usuario: 'x', password: 'é'.repeat(513) }]) errorOnly(await raw('/api/login', body), 400);
    for (const body of [null, [], {}, { credential: [] }, { credential: '' }, { credential: 'é'.repeat(8193) }, { credential: 'x', usuario: 'x' }])
      errorOnly(await raw('/api/login/google', body), 400);
    errorOnly(await raw('/api/login', undefined, { rawBody: '{"usuario":' }), 400);
    errorOnly(await raw('/api/login', undefined, { rawBody: JSON.stringify({ usuario: 'x', password: 'x'.repeat(33000) }) }), 413);
    errorOnly(await raw('/api/login/google', undefined, { rawBody: JSON.stringify({ credential: 'x'.repeat(33000) }) }), 413);
    for (const [path, body] of [
      ['/API/LOGIN/', { usuario: 'x', password: 'x'.repeat(33000) }],
      ['/api/LOGIN/GOOGLE/', { credential: 'x'.repeat(33000) }],
    ]) errorOnly(await raw(path, undefined, { rawBody: JSON.stringify(body) }), 413);
    assert.deepEqual(await buckets(), []); assert.deepEqual(await business(), before);
  });
  await t.test('unknown/wrong/inactive/ambiguous failures are generic; valid UTF8 bounds and unchanged password semantics', async () => {
    await phaseReset(); const before = await business();
    const failures = [await wrong('qa_unknown_generic'), await password('qa_login_112001', 'wrong synthetic password'),
      await password('qa_login_112002'), await password('qa-login-ambiguous@example.invalid')];
    for (const result of failures) errorOnly(result, 401);
    assert.equal(new Set(failures.map(result => result.body.error)).size, 1);
    errorOnly(await wrong('é'.repeat(160)), 401); errorOnly(await password('qa_unknown_password_bound', 'é'.repeat(512)), 401);
    const good = await password('  QA_LOGIN_112001  '); assert.equal(good.status, 200); assert.equal(good.body.usuario.id, 112001); currentToken = good.body.token;
    assert.deepEqual(Object.keys(good.body).sort(), ['token', 'usuario']); assert.equal(typeof currentToken, 'string');
    const spaced = await password('qa_login_112005', spacedPassword); assert.equal(spaced.status, 200);
    errorOnly(await password('qa_login_112005', spacedPassword.trim()), 401);
    assert.deepEqual(await business(), before);
  });
  await t.test('normalization and successful attempts count: twentieth succeeds, twenty-first is429 without token', async () => {
    await phaseReset(); const before = await business();
    for (let i = 0; i < 20; i++) {
      const result = await password(i % 2 ? ' QA_LOGIN_112001 ' : 'qa_login_112001'); assert.equal(result.status, 200);
    }
    errorOnly(await password('qa_login_112001'), 429);
    assert.deepEqual((await buckets()).map(row => row.attempts).sort((a, b) => a - b), [21, 21]);
    assert.deepEqual(await business(), before);
  });
  await t.test('independent concurrent HTTP clients allow exactly20 identifier attempts and commit bounded denials', async () => {
    await phaseReset(); const before = await business();
    const responses = await parallel(Array.from({ length: 32 }, (_, i) => i), i => wrong(i % 2 ? ' QA_CONCURRENT_TARGET ' : 'qa_concurrent_target'), 32);
    assert.equal(responses.filter(result => result.status === 401).length, 20); assert.equal(responses.filter(result => result.status === 429).length, 12);
    for (const result of responses) errorOnly(result, result.status === 401 ? 401 : 429);
    assert.deepEqual((await buckets()).map(row => row.attempts).sort((a, b) => a - b), [21, 32]);
    const [clock] = await fixture.query(`SELECT GREATEST(1,ceil(extract(epoch FROM (expires_at-clock_timestamp()))))::int AS seconds
      FROM auth_login_buckets WHERE attempts=21`);
    for (const result of responses.filter(result => result.status === 429)) {
      assert.ok(Number(result.retryAfter) >= clock.seconds && Number(result.retryAfter) <= clock.seconds + 3,
        'Retry-After follows remaining denied DB window, not a renewed application-clock window');
    }
    assert.deepEqual(await business(), before);
  });
  await t.test('120 direct-peer attempts shared by password/Google; forwarded headers cannot evade or throttle protected routes', async () => {
    await phaseReset(); const before = await business();
    const responses = await parallel(Array.from({ length: 128 }, (_, i) => i), async i => {
      const headers = { 'x-forwarded-for': `198.51.100.${i + 1}`, forwarded: `for=203.0.113.${i + 1}`, 'x-real-ip': `192.0.2.${i + 1}` };
      const result = i < 100 ? await wrong(`qa_peer_unknown_${i}`, { headers })
        : await raw('/api/login/google', { credential: privateCredential }, { headers });
      errorOnly(result, result.status === 429 ? 429 : i < 100 ? 401 : 500); return result;
    });
    assert.equal(responses.filter(result => result.status === 429).length, 8);
    assert.equal(responses.filter(result => result.status !== 429).length, 120);
    assert.equal((await buckets()).filter(row => row.attempts === 121).length, 1);
    errorOnly(await password('qa_login_112001', fixturePassword, { headers: { 'x-forwarded-for': '203.0.113.254' } }), 429);
    errorOnly(await raw('/api/login/google', { credential: privateCredential }), 429);
    assert.equal((await request(fixture.base, '/api/health')).status, 200);
    assert.equal((await request(fixture.base, '/api/sesion', { token: currentToken })).status, 200);
    const preflight = await fetch(`${fixture.base}/api/login`, { method: 'OPTIONS', signal: AbortSignal.timeout(5000) }); assert.equal(preflight.status, 204);
    assert.deepEqual(await business(), before);
  });
  await t.test('persisted schema contains only HMAC keys/counters/times; peer and identical-string identifier remain separated', async () => {
    await phaseReset(); errorOnly(await wrong('127.0.0.1'), 401);
    const rows = await buckets(); assert.equal(rows.length, 2); assert.notEqual(rows[0].bucket_key, rows[1].bucket_key);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['bucket_key', 'attempts', 'window_started_at', 'expires_at'].sort());
      assert.match(row.bucket_key, /^[0-9a-f]{64}$/); assert.equal(row.attempts, 1);
      const duration = new Date(row.expires_at) - new Date(row.window_started_at); assert.equal(duration, 900000);
      assert.ok(!JSON.stringify(row).includes('127.0.0.1')); assert.ok(!JSON.stringify(row).includes(privateCredential));
      assert.ok(!JSON.stringify(row).includes('qa_login')); assert.ok(!JSON.stringify(row).includes(currentToken));
    }
  });
  await t.test('new actual server processes retain shared DB denial across restart with unchanged fixed window', async () => {
    await phaseReset(); const before = await business();
    for (let i = 0; i < 20; i++) errorOnly(await wrong('qa_persisted_restart_target'), 401);
    const started = (await buckets()).map(row => ({ key: row.bucket_key, started: row.window_started_at, expiry: row.expires_at }));
    for (let run = 0; run < 2; run++) {
      const server = await fixture.launchActual({ entry: 'server' });
      try {
        const { base } = await server.ready; errorOnly(await wrong('qa_persisted_restart_target', { base }), 429);
        assert.deepEqual(server.intervals(), []);
      } finally { await server.stop(); }
    }
    assert.deepEqual((await buckets()).map(row => ({ key: row.bucket_key, started: row.window_started_at, expiry: row.expires_at })), started);
    assert.deepEqual((await buckets()).map(row => row.attempts).sort((a, b) => a - b), [21, 22]);
    assert.deepEqual(await business(), before);
  });
  await t.test('database expiry after actual row serialization resets a capped peer despite pre-wait unexpired window', async () => {
    const peer = await seedPeer();
    await fixture.query(`UPDATE auth_login_buckets SET attempts=121,window_started_at=clock_timestamp()-interval '15 minutes',
      expires_at=clock_timestamp()+interval '0.5 seconds' WHERE bucket_key=$1`, [peer]);
    const before = await business(), tag = `qa_auth_expiry_${randomUUID().replaceAll('-', '')}`;
    let blocker, pending;
    try {
      blocker = fixture.query(`/* ${tag} */ BEGIN; SELECT bucket_key FROM auth_login_buckets WHERE bucket_key='${peer}' FOR UPDATE; SELECT pg_sleep(0.85); ROLLBACK`);
      assert.equal(await observe(`%${tag}%`, 'PgSleep'), true);
      assert.equal((await fixture.query('SELECT expires_at>clock_timestamp() AS live FROM auth_login_buckets WHERE bucket_key=$1', [peer]))[0].live, true);
      pending = wrong('qa_post_lock_expiry'); assert.equal(await observe('%auth_login_buckets%', 'Lock'), true);
      errorOnly(await pending, 401); await blocker;
      const [reset] = await fixture.query('SELECT attempts,expires_at>clock_timestamp() AS live FROM auth_login_buckets WHERE bucket_key=$1', [peer]);
      assert.equal(reset.attempts, 1); assert.equal(reset.live, true); assert.deepEqual(await business(), before);
    } finally { await Promise.allSettled([blocker, pending].filter(Boolean)); }
  });
  await t.test('locked bucket times out503 below5s with no partially advanced counters or business writes', async () => {
    const peer = await seedPeer(), before = await business(), counters = await buckets(), tag = `qa_auth_timeout_${randomUUID().replaceAll('-', '')}`;
    let blocker, pending;
    try {
      blocker = fixture.query(`/* ${tag} */ BEGIN; SELECT bucket_key FROM auth_login_buckets WHERE bucket_key='${peer}' FOR UPDATE; SELECT pg_sleep(2.5); ROLLBACK`);
      assert.equal(await observe(`%${tag}%`, 'PgSleep'), true);
      const start = performance.now(); pending = wrong('qa_lock_timeout_target');
      assert.equal(await observe('%auth_login_buckets%', 'Lock'), true);
      errorOnly(await pending, 503); assert.ok(performance.now() - start < 5000);
      await blocker; assert.deepEqual(await buckets(), counters); assert.deepEqual(await business(), before);
    } finally { await Promise.allSettled([blocker, pending].filter(Boolean)); }
  });
  await t.test('bounded expired pruning removes at most100 and preserves live windows using PostgreSQL time', async () => {
    await phaseReset();
    await fixture.query(`INSERT INTO auth_login_buckets(bucket_key,attempts,window_started_at,expires_at)
      SELECT md5('qa_expired_a:'||g)||md5('qa_expired_b:'||g),1,clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes'
      FROM generate_series(1,105) g`);
    const liveKey = 'f'.repeat(64);
    await fixture.query(`INSERT INTO auth_login_buckets(bucket_key,attempts,window_started_at,expires_at)
      VALUES ($1,7,clock_timestamp(),clock_timestamp()+interval '15 minutes')`, [liveKey]);
    const before = await business(); errorOnly(await wrong('qa_bounded_prune'), 401);
    const [remaining] = await fixture.query('SELECT count(*)::int AS n FROM auth_login_buckets WHERE expires_at<clock_timestamp()');
    assert.equal(remaining.n, 5); assert.equal((await fixture.query('SELECT attempts FROM auth_login_buckets WHERE bucket_key=$1', [liveKey]))[0].attempts, 7);
    assert.deepEqual(await business(), before);
  });
  await t.test('real prune SQL uses expiry index with10000 live buckets, without forcing planner or executing DELETE', async () => {
    await phaseReset();
    await fixture.query(`INSERT INTO auth_login_buckets(bucket_key,attempts,window_started_at,expires_at)
      SELECT md5('qa_live_plan_a:'||g)||md5('qa_live_plan_b:'||g),1,clock_timestamp(),clock_timestamp()+interval '15 minutes'
      FROM generate_series(1,10000) g`);
    await fixture.query('ANALYZE auth_login_buckets');
    const digest = () => fixture.query(`SELECT count(*)::int AS n,
      md5(string_agg(to_jsonb(b)::text,'' ORDER BY bucket_key)) AS checksum FROM auth_login_buckets b`);
    const before = await business(), countersBefore = await digest(); assert.equal(countersBefore[0].n, 10000);
    const { LOGIN_PRUNE_SQL } = await import('../src/login-abuse.js');
    assert.equal(typeof LOGIN_PRUNE_SQL, 'string');
    const explained = await fixture.query(`EXPLAIN (FORMAT JSON) ${LOGIN_PRUNE_SQL}`, [[]]);
    const root = explained[0]['QUERY PLAN'][0].Plan;
    const flatten = node => [node, ...(node.Plans ?? []).flatMap(flatten)];
    const candidates = flatten(root).find(node => node['Subplan Name'] === 'CTE candidates');
    assert.ok(candidates, 'Inspect actual exported candidate CTE, never a handwritten replacement query');
    const nodes = flatten(candidates);
    assert.ok(nodes.some(node => node['Index Name'] === 'auth_login_buckets_expiry_idx'
      && /Index/.test(node['Node Type']) && /expires_at/.test(node['Index Cond'] ?? '')),
    `Candidate expiry must be index-accessible: ${JSON.stringify(nodes.map(node => ({ type: node['Node Type'], index: node['Index Name'], condition: node['Index Cond'] })))}`);
    assert.equal(nodes.some(node => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'auth_login_buckets'), false,
      'LIMIT100 must not hide a full scan over live windows');
    assert.deepEqual(await digest(), countersBefore, 'EXPLAIN without ANALYZE must not execute prune or mutate buckets');
    assert.deepEqual(await business(), before);
  });
  await t.test('missing storage503 fails closed before password/Google verification; malformed input400 still precedes SQL', async () => {
    await phaseReset(); const before = await business();
    await fixture.query('ALTER TABLE auth_login_buckets RENAME TO qa_missing_auth_login_buckets');
    try {
      errorOnly(await password('qa_login_112001'), 503);
      errorOnly(await raw('/api/login/google', { credential: privateCredential }), 503);
      errorOnly(await raw('/api/login', { usuario: [], password: 'x' }), 400);
      assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE nombre='067_auth_login_buckets.sql'"),
        [{ nombre: '067_auth_login_buckets.sql' }]);
      const server = await fixture.launchActual({ entry: 'server' });
      try {
        const exited = await server.done;
        assert.equal(exited.code, 1, 'Applied ledger must not let actual startup bypass missing auth storage');
        assert.equal(exited.signal, null);
        assert.deepEqual(await fixture.query("SELECT to_regclass('public.auth_login_buckets') AS relation"), [{ relation: null }]);
        assert.notEqual((await fixture.query("SELECT to_regclass('public.qa_missing_auth_login_buckets') AS relation"))[0].relation, null);
      } finally { await server.stop(); }
      assert.deepEqual(await business(), before);
    } finally { await fixture.query('ALTER TABLE qa_missing_auth_login_buckets RENAME TO auth_login_buckets'); }
    assert.equal((await password('qa_login_112001')).status, 200);
  });
  await t.test('logout revokes real successful session without changing credentials or bypassing durable counting', async () => {
    await phaseReset(); const success = await password('qa_login_112001'); assert.equal(success.status, 200);
    const token = success.body.token;
    assert.equal((await request(fixture.base, '/api/sesion', { token })).status, 200);
    assert.equal((await request(fixture.base, '/api/logout', { token, method: 'POST', body: {} })).status, 200);
    assert.equal((await request(fixture.base, '/api/sesion', { token })).status, 401);
    const before = await business(); const again = await password('qa_login_112001'); assert.equal(again.status, 200);
    assert.equal(again.body.usuario.id, 112001); assert.deepEqual(await business(), before);
    assert.deepEqual((await buckets()).map(row => row.attempts), [2, 2]);
  });
});
