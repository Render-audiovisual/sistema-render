import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { CLIENT_CATALOG_SQL, loadClientCatalogSnapshot } from '../src/client-catalog.js';

// Opt-in principal HTTP + physical PostgreSQL, generated fixture only. Wrappers
// pause real leased query execution: no fabricated rows/authority/projections.
test('QA147 client catalog revalidates authority at its first read-only RR snapshot', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55797 });
  let pool;
  t.after(async () => {
    await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA147 catalog fixture cleanup ENOENT: ${f.root}; port55797`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55797/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55797, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa147-own-client-catalog' });
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Principal HTTP status; never print credentials'); return result.body; };
  const login = async usuario => checked(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const mutableId = 991471, customId = 991472;
  for (const [id, name, role] of [[mutableId, 'qa147_mutable', 'admin'], [customId, 'qa147_custom', 'qa_catalog_custom']])
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$2,$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, name, role]);
  const owner = await login('qa_franco'), staff = await login('qa_luciano'), custom = await login('qa147_custom');
  const [client] = await f.query(`INSERT INTO clientes(nombre,activo,fecha_inicio,rubro,cuota_reels,cuota_carruseles)
    VALUES('QA147 catalog effective agreements',true,'2026-10-01','QA',9,8) RETURNING id`);
  for (const [date, reels, carousels, amount] of [['2026-10-01', 2, 1, '817293.46'], ['2026-11-01', 3, 2, '918374.57']]) {
    await f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,
      dias_historias,dias_reels,dias_carruseles,disenador_responsable,abono_mensual)
      VALUES($1,$2,$3,$4,ARRAY[1,3]::smallint[],ARRAY[2]::smallint[],ARRAY[4]::smallint[],'Designer QA',$5)`, [client.id, date, reels, carousels, amount]);
    await f.query('INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES($1,$2,$3,$4)',
      [client.id, date, amount, 'QA147_PRIVATE_FINANCE_CREATOR']);
  }
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const httpCatalog = async (token, period) => {
    const response = await fetch(new URL(`/api/clientes?${new URLSearchParams({ periodo: period })}`, f.base), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const target = rows => { const matches = rows.filter(row => row.id === client.id); assert.equal(matches.length, 1); return matches[0]; };
  const staffKeys = ['id','nombre','cuota_reels','cuota_carruseles','rubro','activo','fecha_inicio','fecha_fin',
    'dias_historias','dias_reels','dias_carruseles','disenador_responsable','configuracion_vigente_desde','configuracion_completa',
    'grupo_feed_id','grupo_feed_nombre','cuota_feed_reels','cuota_feed_carruseles','cuota_feed_compartida'];

  await t.test('HTTP and helper retain period parity, owner-only abonos and closed staff/custom projections without DML', async () => {
    const before = await snapshot();
    for (const [period, reels, carousels, amount] of [['2026-09', 0, 0, null], ['2026-10', 2, 1, '817293.46'], ['2026-11', 3, 2, '918374.57']]) {
      for (const [token, actor] of [[owner, { id: 91001, rol: 'admin', session_version: 1 }],
        [staff, { id: 91003, rol: 'edicion', session_version: 1 }], [custom, { id: customId, rol: 'qa_catalog_custom', session_version: 1 }]]) {
        const http = await httpCatalog(token, period), rows = checked(http);
        assert.equal(http.cache, 'no-store'); assert.ok(Array.isArray(rows));
        assert.deepEqual(await loadClientCatalogSnapshot(pool, actor, `${period}-01`), rows);
        const row = target(rows);
        assert.equal(row.cuota_reels, reels); assert.equal(row.cuota_carruseles, carousels);
        if (actor.rol === 'admin') {
          assert.equal(row.abono_mensual, amount); assert.match(row.agreement_revision, /^a1:/);
        } else {
          const expectedKeys = amount === null ? staffKeys.filter(key => !['dias_historias','dias_reels','dias_carruseles'].includes(key)) : staffKeys;
          assert.deepEqual(Object.keys(row).sort(), [...expectedKeys].sort());
          for (const key of ['abono_mensual','abono_vigente_desde','agreement_revision']) assert.equal(Object.hasOwn(row, key), false);
          for (const privateValue of ['817293.46','918374.57','QA147_PRIVATE_FINANCE_CREATOR']) assert.equal(JSON.stringify(rows).includes(privateValue), false);
        }
      }
    }
    checked(await httpCatalog(null, '2026-10'), 401);
    assert.deepEqual(await snapshot(), before);
  });

  function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
  async function reachedBeforeSettlement(ready, pending) {
    let timer;
    try { await Promise.race([ready, pending.then(() => { throw Error('Expected real query barrier was not reached'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded fixture barrier timeout')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  function pausedPool(when) {
    const ready = deferred(), gate = deferred(), queries = [], releases = [];
    let paused = false;
    return { ready, gate, queries, releases, pool: { connect: async () => {
      const db = await pool.connect();
      return { release(error) { releases.push(error); db.release(error); }, async query(...args) {
        const sql = typeof args[0] === 'string' ? args[0] : args[0].text;
        queries.push({ sql, values: args[1] });
        const actor = /\bFROM\s+usuarios\b/i.test(sql);
        if (actor && !paused && when === 'before') { paused = true; ready.resolve(); await gate.promise; }
        // Crucially, NO diagnostic SELECT runs before the first actor SELECT:
        // even SELECT current_setting could establish the RR snapshot early.
        const result = await db.query(...args);
        if (actor && !paused && when === 'after') {
          paused = true;
          const settings = (await db.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
          assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
          ready.resolve(); await gate.promise;
        }
        return result;
      } };
    } } };
  }
  const resetActor = () => f.query("UPDATE usuarios SET rol='admin',activo=true,session_version=1 WHERE id=$1", [mutableId]);

  for (const [name, update] of [['role downgrade', "rol='edicion'"], ['epoch revocation', 'session_version=2'], ['inactive account', 'activo=false']]) {
    await t.test(`${name} committed after connect but BEFORE first snapshot rejects401 without any commercial query or DML`, async () => {
      await resetActor();
      const barrier = pausedPool('before');
      const pending = loadClientCatalogSnapshot(barrier.pool, { id: mutableId, rol: 'admin', session_version: 1 }, '2026-10-01')
        .then(data => ({ data }), error => ({ error }));
      let before;
      try {
        await reachedBeforeSettlement(barrier.ready.promise, pending);
        assert.match(barrier.queries[0].sql, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
        await f.query(`UPDATE usuarios SET ${update} WHERE id=$1`, [mutableId]);
        before = await snapshot();
      } finally { barrier.gate.resolve(); }
      const outcome = await pending;
      assert.equal(outcome.error?.status, 401); assert.equal(outcome.data, undefined);
      assert.equal(barrier.queries.some(query => query.sql === CLIENT_CATALOG_SQL), false);
      assert.equal(barrier.queries.filter(query => /\bFROM\s+usuarios\b/i.test(query.sql)).length, 1);
      assert.ok(barrier.queries.some(query => query.sql === 'ROLLBACK'));
      assert.equal(barrier.releases.length, 1);
      assert.deepEqual(await snapshot(), before, 'The denied read makes no writes, including user/config/fee/history rows');
    });
  }

  await t.test('auth observation is captured before a real pool lease; mutating the caller cannot switch actor or epoch', async () => {
    await resetActor();
    const ready = deferred(), gate = deferred();
    const observed = { id: mutableId, rol: 'admin', session_version: 1 };
    const pending = loadClientCatalogSnapshot({ connect: async () => { ready.resolve(); await gate.promise; return pool.connect(); } }, observed, '2026-10-01')
      .then(data => ({ data }), error => ({ error }));
    let before;
    try {
      await reachedBeforeSettlement(ready.promise, pending);
      await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]);
      observed.id = 91001; observed.rol = 'admin'; observed.session_version = 1;
      before = await snapshot();
    } finally { gate.resolve(); }
    const outcome = await pending;
    assert.equal(outcome.error?.status, 401); assert.equal(outcome.data, undefined);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('revocation AFTER first snapshot permits only the old-consistent catalog, not a torn or indefinitely reusable authority', async () => {
    await resetActor();
    const barrier = pausedPool('after');
    const observed = { id: mutableId, rol: 'admin', session_version: 1 };
    const pending = loadClientCatalogSnapshot(barrier.pool, observed, '2026-10-01').then(data => ({ data }), error => ({ error }));
    let before;
    try {
      await reachedBeforeSettlement(barrier.ready.promise, pending);
      const external = await pool.connect();
      try {
        await external.query('BEGIN');
        await external.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]);
        await external.query("UPDATE cliente_abonos SET importe='719283.64' WHERE cliente_id=$1 AND vigente_desde='2026-10-01'", [client.id]);
        await external.query('COMMIT');
      } catch (error) { await external.query('ROLLBACK'); throw error; }
      finally { external.release(); }
      before = await snapshot();
    } finally { barrier.gate.resolve(); }
    const outcome = await pending;
    assert.equal(outcome.error, undefined);
    assert.equal(target(outcome.data).abono_mensual, '817293.46', 'Client query shares the already-established actor snapshot');
    assert.ok(barrier.queries.some(query => query.sql === 'COMMIT')); assert.equal(barrier.releases.length, 1);
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(loadClientCatalogSnapshot(pool, observed, '2026-10-01'), error => error.status === 401);
    assert.equal(target(await loadClientCatalogSnapshot(pool, { ...observed, session_version: 2 }, '2026-10-01')).abono_mensual, '719283.64');
    assert.deepEqual(await snapshot(), before);
  });
});
