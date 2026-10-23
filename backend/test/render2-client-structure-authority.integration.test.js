import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { saveClientStructure, CLIENT_STRUCTURE_UPSERT_SQL } from '../src/client-structure.js';

test('QA150 structure writes revalidate current admin under client mutex and retain actor SHARE through commit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55800 }); let pool;
  t.after(async () => { await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA150 cleanup ENOENT: ${f.root}; port55800`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55800/render2_local_test';
  const identitySql = `SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`;
  const verify = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55800, url, identity });
  verify((await f.query(identitySql))[0]);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa150-structure' });
  verify((await pool.query(identitySql)).rows[0]);
  const mutableId = 991501;
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,'qa150_mutable','QA150 mutable','admin',password_hash,true,1 FROM usuarios WHERE id=91004`, [mutableId]);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA150 synthetic structure',true) RETURNING id");
  const checked = (result, status = 201) => { assert.equal(result.status, status, 'Principal HTTP status; credentials omitted'); return result.body; };
  const login = async usuario => checked(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } }), 200).token;
  const owner = await login('qa_franco'), staff = await login('qa_luciano');
  const post = (token, body) => request(f.base, '/api/estructura', { token, method: 'POST', body });
  const input = day => ({ cliente_id: client.id, dia_semana: day, tema: 'Original', horario: '10:30', cta_fijo: 'CTA QA150', tipo: 'Promo' });
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) { assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const rows = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
      hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    return hashes;
  };
  await t.test('HTTP admin creates/updates same row, preserves optional COALESCE values, reactivates; staff denied unchanged', async () => {
    const first = checked(await post(owner, input(1))); assert.equal(first.cliente_id, client.id); assert.equal(first.dia_semana, 1);
    const second = checked(await post(owner, { cliente_id: client.id, dia_semana: 1, tema: 'Updated', horario: null, cta_fijo: '', tipo: null }));
    assert.equal(second.id, first.id); assert.equal(second.tema, 'Updated');
    assert.equal(second.horario, '10:30'); assert.equal(second.cta_fijo, 'CTA QA150'); assert.equal(second.tipo, 'Promo');
    await f.query('UPDATE estructura_cliente SET activo=false WHERE id=$1', [first.id]);
    const active = checked(await post(owner, { cliente_id: client.id, dia_semana: 1, tema: 'Reactivated' }));
    assert.equal(active.id, first.id); assert.equal(active.activo, true);
    assert.equal((await f.query('SELECT count(*)::int total FROM estructura_cliente WHERE cliente_id=$1 AND dia_semana=1', [client.id]))[0].total, 1);
    const before = await snapshot(); checked(await post(staff, input(2)), 403); assert.deepEqual(await snapshot(), before);
  });

  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const observe = promise => { const state = { promise, settled: false }; promise.then(() => { state.settled = true; }, () => { state.settled = true; }); return state; };
  async function reached(ready, pending) {
    let timer; try { await Promise.race([ready, pending.then(() => { throw Error('Expected real query barrier not reached'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded structure barrier timeout')), 12000); })]); }
    finally { clearTimeout(timer); }
  }
  const actorSql = 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE';
  function pausedPool(when) {
    const ready = deferred(), gate = deferred(), queries = [], releases = []; let pid;
    return { ready, gate, queries, releases, get pid() { return pid; }, pool: { async connect() {
      const db = await pool.connect();
      verify((await db.query(identitySql)).rows[0]); pid = (await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return { release(error) { releases.push(error); db.release(error); }, async query(sql, values) {
        queries.push(sql);
        if (sql === actorSql && when === 'before') { ready.resolve(); await gate.promise; }
        const result = await db.query(sql, values);
        if (sql === actorSql && when === 'after') { ready.resolve(); await gate.promise; }
        return result;
      } };
    } } };
  }
  const reset = () => f.query("UPDATE usuarios SET rol='admin',activo=true,session_version=1 WHERE id=$1", [mutableId]);
  const auth = () => ({ id: mutableId, rol: 'admin', session_version: 1 });
  for (const [label, update, status] of [['epoch', 'session_version=2', 401], ['inactive', 'activo=false', 401], ['role', "rol='edicion'", 403]]) {
    await t.test(`${label} committed before actor SHARE denies with zero structure/catalog/fee DML`, async () => {
      await reset(); const barrier = pausedPool('before');
      const pending = saveClientStructure(barrier.pool, auth(), input(2)).then(data => ({ data }), error => ({ error })); let before;
      try { await reached(barrier.ready.promise, pending);
        assert.equal(barrier.queries[0], 'BEGIN');
        assert.ok(barrier.queries[1].includes('pg_advisory_xact_lock'));
        assert.equal(barrier.queries[2], actorSql);
        await f.query(`UPDATE usuarios SET ${update} WHERE id=$1`, [mutableId]); before = await snapshot();
      } finally { barrier.gate.resolve(); }
      const result = await pending; assert.equal(result.error?.status, status); assert.equal(result.data, undefined);
      assert.equal(barrier.queries.includes(CLIENT_STRUCTURE_UPSERT_SQL), false); assert.equal(barrier.queries.at(-1), 'ROLLBACK');
      assert.equal(barrier.releases.length, 1); assert.deepEqual(await snapshot(), before);
    });
  }

  await t.test('actor SHARE blocks exact revoker PID until structure COMMIT, then next write denies401', async () => {
    await reset(); const barrier = pausedPool('after');
    const revoker = await pool.connect(), monitor = await pool.connect(); let revocation, pending;
    try {
      verify((await revoker.query(identitySql)).rows[0]); verify((await monitor.query(identitySql)).rows[0]);
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      pending = saveClientStructure(barrier.pool, auth(), input(3));
      await reached(barrier.ready.promise, pending);
      revocation = observe(revoker.query('UPDATE usuarios SET activo=false,session_version=session_version+1 WHERE id=$1', [mutableId]));
      const deadline = Date.now() + 10000; let blocked = false;
      while (Date.now() < deadline && !revocation.settled) {
        const result = await monitor.query(`SELECT pid FROM pg_stat_activity WHERE pid=$1
          AND $2::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE usuarios SET activo=false%'`, [revokerPid, barrier.pid]);
        if (result.rowCount === 1) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(blocked, true, 'Exact revoker must wait on structure actor lock');
      assert.equal(revocation.settled, false); barrier.gate.resolve();
      const saved = await pending; assert.equal(saved.cliente_id, client.id); assert.equal(saved.dia_semana, 3);
      assert.equal((await revocation.promise).rowCount, 1); assert.equal(barrier.queries.at(-1), 'COMMIT');
      const before = await snapshot(); await assert.rejects(saveClientStructure(pool, auth(), input(4)), error => error.status === 401);
      assert.deepEqual(await snapshot(), before);
    } finally {
      barrier.gate.resolve(); await Promise.allSettled([pending, revocation?.promise].filter(Boolean));
      revoker.release(); monitor.release();
    }
  });

  await t.test('body and identity capture precede pool lease; caller mutations cannot redirect accepted write or evade epoch revocation', async () => {
    for (const revoke of [false, true]) {
      await reset(); const ready = deferred(), gate = deferred(), actor = auth(), body = input(5);
      const pending = saveClientStructure({ async connect() { ready.resolve(); await gate.promise; return pool.connect(); } }, actor, body)
        .then(data => ({ data }), error => ({ error })); let before;
      try { await reached(ready.promise, pending);
        actor.id = 91001; actor.session_version = 1; body.dia_semana = 6; body.tema = 'mutated after capture';
        if (revoke) await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]);
        before = await snapshot();
      } finally { gate.resolve(); }
      const result = await pending;
      if (revoke) { assert.equal(result.error?.status, 401); assert.deepEqual(await snapshot(), before); }
      else { assert.equal(result.error, undefined); assert.equal(result.data.dia_semana, 5); assert.equal(result.data.tema, 'Original');
        assert.equal((await f.query('SELECT count(*)::int total FROM estructura_cliente WHERE cliente_id=$1 AND dia_semana=6', [client.id]))[0].total, 0); }
    }
  });
});
