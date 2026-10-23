import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { savePlanningCheck, updateSpecialDate, PLANNING_CHECK_SQL, SPECIAL_DATE_PATCH_SQL } from '../src/planning-writes.js';

test('QA157 planning writes require strict inputs and current locked authority without editorial publication side effects', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55804 }); let pool;
  t.after(async () => { await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA157 cleanup ENOENT: ${f.root}; port55804`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55804/render2_local_test';
  const identitySql = `SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`;
  const verify = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55804, url, identity });
  verify((await f.query(identitySql))[0]);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa157-planning-writes' });
  verify((await pool.query(identitySql)).rows[0]);
  const mutableId = 991571;
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,'qa157_mutable','QA157 fresh DB actor','admin',password_hash,true,1 FROM usuarios WHERE id=91004`, [mutableId]);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA157 synthetic planning',true) RETURNING id");
  const [special] = await f.query("INSERT INTO fechas_especiales(evento,idea,estado) VALUES('QA157 global without date','Initial idea','pendiente') RETURNING id");
  // Real pieces exist, but checklist operations must never mutate or publish them.
  await f.query("INSERT INTO historias(cliente_id,fecha_programada,copy) VALUES($1,'2026-10-23','QA157 history canary')", [client.id]);
  await f.query("INSERT INTO publicaciones(cliente_id,tipo,fecha_programada,copy) VALUES($1,'video','2026-10-23','QA157 piece canary')", [client.id]);
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Principal HTTP status; auth/body omitted'); return result.body; };
  const login = async usuario => checked(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const owner = await login('qa_franco'), staff = await login('qa_luciano'), mutable = await login('qa157_mutable');
  const checkBody = () => ({ cliente_id: client.id, fecha: '2026-10-23', publicado: true });
  const checkHttp = (body, token = owner) => request(f.base, '/api/check-publicacion', { token, method: 'POST', body });
  const specialHttp = (id, body, token = owner) => request(f.base, `/api/fechas-especiales/${id}`, { token, method: 'PATCH', body });
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  const snapshot = async (exclude = []) => {
    const hashes = {};
    for (const table of tables.filter(name => !exclude.includes(name))) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      hashes[table] = createHash('sha256').update(JSON.stringify(await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`))).digest('hex');
    }
    return hashes;
  };

  await t.test('HTTP checklist accepts only actual boolean; actor attribution comes from DB and false clears it without publishing', async () => {
    const invalid = [
      { ...checkBody(), publicado: 'false' }, { ...checkBody(), publicado: 1 }, { ...checkBody(), publicado: null },
      { cliente_id: client.id, fecha: '2026-10-23' }, { cliente_id: client.id, publicado: true },
      { ...checkBody(), cliente_id: String(client.id) }, { ...checkBody(), cliente_id: 0 },
      { ...checkBody(), confirmado_por: 'Spoofed caller' }, { ...checkBody(), unknown: true },
      ...['2026-02-30', '0000-01-01', '2026-1-01', '2026-10-23\n', ''].map(fecha => ({ ...checkBody(), fecha })),
    ];
    const before = await snapshot();
    for (const body of invalid) { checked(await checkHttp(body), 400); assert.deepEqual(await snapshot(), before); }
    checked(await checkHttp({ ...checkBody(), cliente_id: 2147483647 }), 404);
    checked(await checkHttp(checkBody(), staff), 403); assert.deepEqual(await snapshot(), before);
    const unrelated = await snapshot(['check_publicacion']);
    const [actor] = await f.query('SELECT nombre FROM usuarios WHERE id=91001');
    const saved = checked(await checkHttp(checkBody()));
    assert.equal(saved.publicado, true); assert.equal(saved.confirmado_por, actor.nombre); assert.ok(saved.confirmado_at);
    const cleared = checked(await checkHttp({ ...checkBody(), publicado: false }));
    assert.equal(cleared.id, saved.id); assert.equal(cleared.publicado, false);
    assert.equal(cleared.confirmado_por, null); assert.equal(cleared.confirmado_at, null);
    assert.equal((await f.query('SELECT count(*)::int n FROM check_publicacion WHERE cliente_id=$1 AND fecha=$2', [client.id, '2026-10-23']))[0].n, 1);
    assert.deepEqual(await snapshot(['check_publicacion']), unrelated, 'Checklist does not alter pieces, evidence, tasks, goals or other history');
  });

  await t.test('HTTP global special event without fecha supports omitted idea versus explicit clear; invalid payloads never write', async () => {
    const before = await snapshot();
    for (const body of [{}, { estado: 'invalid' }, { estado: null }, { idea: null }, { idea: false }, { unknown: 'x' }, { idea: 'bad\0text' }]) {
      checked(await specialHttp(special.id, body), 400); assert.deepEqual(await snapshot(), before);
    }
    for (const id of ['0', '01', '-1', '1.5', '2147483648', 'not-an-id']) { checked(await specialHttp(id, { estado: 'hecho' }), 400); assert.deepEqual(await snapshot(), before); }
    checked(await specialHttp(2147483647, { estado: 'hecho' }), 404);
    checked(await specialHttp(special.id, { estado: 'hecho' }, staff), 403); assert.deepEqual(await snapshot(), before);
    const unrelated = await snapshot(['fechas_especiales']);
    const changed = checked(await specialHttp(special.id, { estado: 'en_curso' }));
    assert.equal(changed.fecha, null); assert.equal(changed.estado, 'en_curso'); assert.equal(changed.idea, 'Initial idea');
    const clear = checked(await specialHttp(special.id, { idea: '' }));
    assert.equal(clear.idea, ''); assert.equal(clear.estado, 'en_curso');
    assert.deepEqual(await snapshot(['fechas_especiales']), unrelated);
  });

  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  async function reached(ready, pending) {
    let timer; try { await Promise.race([ready, pending.then(() => { throw Error('Expected planning barrier not reached'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded planning barrier timeout')), 12000); })]); }
    finally { clearTimeout(timer); }
  }
  const actorSql = 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE';
  function pause(when) {
    const ready = deferred(), gate = deferred(), queries = [], releases = []; let pid;
    return { ready, gate, queries, releases, get pid() { return pid; }, pool: { async connect() {
      const db = await pool.connect(); verify((await db.query(identitySql)).rows[0]); pid = (await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
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
  const auth = () => ({ id: mutableId, rol: 'admin', session_version: 1, nombre: 'Untrusted cached name' });
  const writers = [
    { name: 'check', sql: PLANNING_CHECK_SQL, body: () => ({ ...checkBody(), fecha: '2026-10-24' }),
      write: (db, actor, body) => savePlanningCheck(db, actor, body), mutate: body => { body.fecha = '2026-10-25'; body.publicado = false; } },
    { name: 'special', sql: SPECIAL_DATE_PATCH_SQL, body: () => ({ estado: 'hecho', idea: 'Captured idea' }),
      write: (db, actor, body) => updateSpecialDate(db, actor, String(special.id), body), mutate: body => { body.estado = 'pendiente'; body.idea = 'Mutated idea'; } },
  ];
  for (const writer of writers) {
    for (const [label, update, status] of [['role', "rol='edicion'", 403], ['epoch', 'session_version=2', 401], ['inactive', 'activo=false', 401]]) {
      await t.test(`${writer.name}: ${label} revoked before actor lock denies without DML`, async () => {
        await reset(); const barrier = pause('before');
        const pending = writer.write(barrier.pool, auth(), writer.body()).then(data => ({ data }), error => ({ error })); let before;
        try { await reached(barrier.ready.promise, pending);
          assert.equal(barrier.queries[0], 'BEGIN'); assert.ok(barrier.queries[1].includes('pg_advisory_xact_lock')); assert.equal(barrier.queries[2], actorSql);
          await f.query(`UPDATE usuarios SET ${update} WHERE id=$1`, [mutableId]); before = await snapshot();
        } finally { barrier.gate.resolve(); }
        const result = await pending; assert.equal(result.error?.status, status); assert.equal(result.data, undefined);
        assert.equal(barrier.queries.includes(writer.sql), false); assert.equal(barrier.queries.at(-1), 'ROLLBACK');
        assert.equal(barrier.releases.length, 1); assert.deepEqual(await snapshot(), before);
      });
    }
    await t.test(`${writer.name}: actor SHARE blocks exact revoker PID through domain COMMIT`, async () => {
      await reset(); const barrier = pause('after'), revoker = await pool.connect(), monitor = await pool.connect();
      let pending, revoke; let settled = false;
      try {
        verify((await revoker.query(identitySql)).rows[0]); verify((await monitor.query(identitySql)).rows[0]);
        const pid = (await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending = writer.write(barrier.pool, auth(), writer.body()); await reached(barrier.ready.promise, pending);
        revoke = revoker.query('UPDATE usuarios SET activo=false,session_version=session_version+1 WHERE id=$1', [mutableId]);
        revoke.then(() => { settled = true; }, () => { settled = true; });
        const deadline = Date.now() + 10000; let blocked = false;
        while (Date.now() < deadline && !settled) {
          const result = await monitor.query(`SELECT pid FROM pg_stat_activity WHERE pid=$1 AND $2::int=ANY(pg_blocking_pids(pid))
            AND query LIKE 'UPDATE usuarios SET activo=false%'`, [pid, barrier.pid]);
          if (result.rowCount === 1) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(blocked, true); assert.equal(settled, false); barrier.gate.resolve();
        const saved = await pending; assert.ok(saved.id); assert.equal((await revoke).rowCount, 1);
        assert.ok(barrier.queries.includes(writer.sql)); assert.equal(barrier.queries.at(-1), 'COMMIT');
        if (writer.name === 'check') {
          assert.equal(saved.confirmado_por, 'QA157 fresh DB actor');
          assert.ok(barrier.queries.includes('SELECT id FROM clientes WHERE id=$1 FOR SHARE'));
        }
        const before = await snapshot(); await assert.rejects(writer.write(pool, auth(), writer.body()), error => error.status === 401);
        assert.deepEqual(await snapshot(), before);
      } finally { barrier.gate.resolve(); await Promise.allSettled([pending, revoke].filter(Boolean)); revoker.release(); monitor.release(); }
    });
    await t.test(`${writer.name}: captures auth and input before lease, not caller replacements`, async () => {
      for (const revoked of [false, true]) {
        await reset(); const ready = deferred(), gate = deferred(), actor = auth(), body = writer.body();
        const pending = writer.write({ async connect() { ready.resolve(); await gate.promise; return pool.connect(); } }, actor, body)
          .then(data => ({ data }), error => ({ error })); let before;
        try { await reached(ready.promise, pending); actor.id = 91001; actor.session_version = 1; writer.mutate(body);
          if (revoked) await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]); before = await snapshot();
        } finally { gate.resolve(); }
        const result = await pending;
        if (revoked) { assert.equal(result.error?.status, 401); assert.deepEqual(await snapshot(), before); }
        else { assert.equal(result.error, undefined);
          if (writer.name === 'check') { assert.equal(result.data.fecha, '2026-10-24'); assert.equal(result.data.publicado, true); assert.equal(result.data.confirmado_por, 'QA157 fresh DB actor'); }
          else { assert.equal(result.data.estado, 'hecho'); assert.equal(result.data.idea, 'Captured idea'); }
        }
      }
    });
  }
});
