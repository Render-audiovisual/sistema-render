import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loadUserCatalogSnapshot, USER_CATALOG_ADMIN_SQL, USER_CATALOG_PUBLIC_SQL } from '../src/user-catalog.js';

// Opt-in generated fixture only. Barriers wrap real leased SQL, never fake rows.
test('QA149 user catalog authority and account fields share the first RR readonly snapshot', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55799 }); let pool;
  t.after(async () => {
    await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA149 fixture cleanup ENOENT: ${f.root}; port55799`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55799/render2_local_test';
  const identitySql = `SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const verify = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55799, url, identity });
  verify((await f.query(identitySql))[0]);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa149-user-catalog' });
  verify((await pool.query(identitySql)).rows[0]);
  const mutableId = 991491, customId = 991492, inactiveId = 991493;
  for (const [id, usuario, rol, active] of [[mutableId, 'qa149_mutable', 'admin', true],
    [customId, 'qa149_custom', 'qa_catalog_custom', true], [inactiveId, 'qa149_inactive', 'edicion', false]]) {
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,email_notificaciones,google_email)
      SELECT $1,$2,$2,$3,password_hash,$4,1,$5,$6 FROM usuarios WHERE id=91004`,
    [id, usuario, rol, active, `private-${id}@qa149.invalid`, `google-${id}@qa149.invalid`]);
  }
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Principal HTTP status; credentials omitted'); return result.body; };
  const login = async usuario => checked(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const owner = await login('qa_franco'), staff = await login('qa_luciano'), custom = await login('qa149_custom');
  const catalog = async token => {
    const response = await fetch(new URL('/api/usuarios', f.base), { redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const rows = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
      hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    return hashes;
  };
  const target = rows => { const row = rows.find(row => row.id === mutableId); assert.ok(row, 'Expected synthetic account'); return row; };
  const publicKeys = ['id', 'usuario', 'nombre', 'rol', 'activo', 'foto_perfil', 'created_at'];
  const adminKeys = [...publicKeys, 'email_notificaciones', 'google_email', 'whatsapp_vinculado', 'admin_revision'];

  await t.test('HTTP no-store retains admin fields and active-only staff/custom public fields with no hashes or DML', async () => {
    const before = await snapshot();
    for (const [token, actor] of [[owner, { id: 91001, rol: 'admin', session_version: 1 }],
      [staff, { id: 91003, rol: 'edicion', session_version: 1 }], [custom, { id: customId, rol: 'qa_catalog_custom', session_version: 1 }]]) {
      const response = await catalog(token), rows = checked(response);
      assert.equal(response.cache, 'no-store'); assert.ok(Array.isArray(rows));
      const direct = await loadUserCatalogSnapshot(pool, actor);
      // JSON normalizes driver Date values exactly as the actual HTTP serializer.
      assert.equal(JSON.stringify(direct), JSON.stringify(rows), 'HTTP/helper projection parity');
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), [...(actor.rol === 'admin' ? adminKeys : publicKeys)].sort());
        assert.equal(Object.keys(row).some(key => /password|hash|session_version|token/i.test(key)), false);
      }
      if (actor.rol === 'admin') {
        assert.ok(rows.some(row => row.id === inactiveId));
        assert.equal(target(rows).email_notificaciones, `private-${mutableId}@qa149.invalid`);
        assert.equal(target(rows).google_email, `google-${mutableId}@qa149.invalid`);
      } else {
        assert.ok(rows.every(row => row.activo === true)); assert.equal(rows.some(row => row.id === inactiveId), false);
        assert.equal(JSON.stringify(rows).includes('@qa149.invalid'), false);
      }
    }
    checked(await catalog(null), 401); assert.deepEqual(await snapshot(), before);
  });

  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  async function reached(ready, pending) {
    let timer;
    try { await Promise.race([ready, pending.then(() => { throw Error('Expected actor barrier was not reached'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded actor barrier timeout')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  const actorSql = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
  function pause(when) {
    const ready = deferred(), gate = deferred(), queries = [], releases = []; let paused = false;
    return { ready, gate, queries, releases, pool: { async connect() {
      const db = await pool.connect();
      return { release(error) { releases.push(error); db.release(error); }, async query(...args) {
        const sql = typeof args[0] === 'string' ? args[0] : args[0].text; queries.push(sql);
        if (sql === actorSql && !paused && when === 'before') { paused = true; ready.resolve(); await gate.promise; }
        // No diagnostic SELECT may establish the snapshot before actor SELECT.
        const result = await db.query(...args);
        if (sql === actorSql && !paused && when === 'after') {
          paused = true;
          const settings = (await db.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
          assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
          ready.resolve(); await gate.promise;
        }
        return result;
      } };
    } } };
  }
  const reset = () => f.query("UPDATE usuarios SET rol='admin',activo=true,session_version=1 WHERE id=$1", [mutableId]);
  for (const [label, update] of [['role', "rol='edicion'"], ['epoch', 'session_version=2'], ['inactive', 'activo=false']]) {
    await t.test(`${label} revocation before actor SELECT denies401 before either catalog query`, async () => {
      await reset(); const barrier = pause('before');
      const pending = loadUserCatalogSnapshot(barrier.pool, { id: mutableId, rol: 'admin', session_version: 1 }).then(data => ({ data }), error => ({ error }));
      let before;
      try { await reached(barrier.ready.promise, pending);
        assert.equal(barrier.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await f.query(`UPDATE usuarios SET ${update} WHERE id=$1`, [mutableId]); before = await snapshot();
      } finally { barrier.gate.resolve(); }
      const result = await pending; assert.equal(result.error?.status, 401); assert.equal(result.data, undefined);
      assert.equal(barrier.queries.includes(USER_CATALOG_ADMIN_SQL), false); assert.equal(barrier.queries.includes(USER_CATALOG_PUBLIC_SQL), false);
      assert.equal(barrier.queries.at(-1), 'ROLLBACK'); assert.equal(barrier.releases.length, 1);
      assert.deepEqual(await snapshot(), before);
    });
  }

  await t.test('auth is captured before real lease; caller mutation cannot replace the revoked account', async () => {
    await reset(); const ready = deferred(), gate = deferred();
    const auth = { id: mutableId, rol: 'admin', session_version: 1 };
    const pending = loadUserCatalogSnapshot({ async connect() { ready.resolve(); await gate.promise; return pool.connect(); } }, auth)
      .then(data => ({ data }), error => ({ error })); let before;
    try { await reached(ready.promise, pending);
      await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]);
      auth.id = 91001; auth.rol = 'admin'; auth.session_version = 1; before = await snapshot();
    } finally { gate.resolve(); }
    const result = await pending; assert.equal(result.error?.status, 401); assert.equal(result.data, undefined);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('after actor snapshot revocation returns only old-consistent account fields; next call denies401', async () => {
    await reset(); const barrier = pause('after'), auth = { id: mutableId, rol: 'admin', session_version: 1 };
    const pending = loadUserCatalogSnapshot(barrier.pool, auth).then(data => ({ data }), error => ({ error })); let before;
    try { await reached(barrier.ready.promise, pending);
      const external = await pool.connect();
      try {
        verify((await external.query(identitySql)).rows[0]); await external.query('BEGIN');
        await external.query("UPDATE usuarios SET session_version=2,email_notificaciones='changed@qa149.invalid' WHERE id=$1", [mutableId]);
        await external.query('COMMIT');
      } catch (error) { await external.query('ROLLBACK'); throw error; }
      finally { external.release(); }
      before = await snapshot();
    } finally { barrier.gate.resolve(); }
    const result = await pending; assert.equal(result.error, undefined);
    assert.equal(target(result.data).email_notificaciones, `private-${mutableId}@qa149.invalid`);
    assert.ok(barrier.queries.includes(USER_CATALOG_ADMIN_SQL)); assert.equal(barrier.queries.at(-1), 'COMMIT');
    assert.equal(barrier.releases.length, 1); assert.deepEqual(await snapshot(), before);
    await assert.rejects(loadUserCatalogSnapshot(pool, auth), error => error.status === 401);
    assert.equal(target(await loadUserCatalogSnapshot(pool, { ...auth, session_version: 2 })).email_notificaciones, 'changed@qa149.invalid');
    assert.deepEqual(await snapshot(), before);
  });
});
