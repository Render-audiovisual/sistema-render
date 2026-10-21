import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('explicit monthly preparation: observed revision, shared quotas and current transactional authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55747 });
  const connections = new Set();
  let jobPool;
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await jobPool?.end();
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA108 cleanup ENOENT: ${f.root}; PostgreSQL port55747`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55747/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55747, url, identity });
  // Never resolve a configured DATABASE_URL: the trusted job uses only this
  // identity-checked, generated disposable cluster, and its pool closes above.
  jobPool = new pg.Pool({ connectionString: url, max: 2, application_name: 'qa108-trusted-job', statement_timeout: 15000 });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa108-own-barrier', statement_timeout: 15000 });
    connections.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); connections.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 991081,'qa108_community','QA108 community','community',password_hash,true,1 FROM usuarios WHERE id=91004`);
  const community = await login('qa108_community');
  const period = '2026-10', marker = 'QA108_PRIVATE_AGREEMENT', amount = 817293.46;
  const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos', 'grupos_feed', 'tareas', 'tarea_asignaciones',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_responsables', 'cliente_objetivo_eventos',
    'cliente_objetivo_vinculos', 'cliente_objetivo_cuota_revisiones', 'publicaciones', 'historias',
    'editorial_publicacion_eventos', 'task_editing_deliveries', 'task_editing_reviews'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await f.query(`SELECT * FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const read = async (key, token = admin) => {
    const body = ok(await api(`/cliente-objetivos?periodo=${period}`, token));
    assert.equal(JSON.stringify(body).includes(marker), false); assert.equal(JSON.stringify(body).includes(String(amount)), false);
    const row = body.clientes.find(item => item.clave === key); assert.ok(row);
    assert.match(row.preparacion_revision, /^[0-9a-f]{64}$/); return row;
  };
  const bodyFor = row => ({ periodo: period, clave: row.clave, responsables: [91003],
    responsables_por_formato: { video: [91003], carrusel: [91003] }, expected_preparation_revision: row.preparacion_revision });
  const prepare = (body, token = admin) => api('/cliente-objetivos/preparar', token, 'POST', body);
  const createBasic = async name => ok(await api('/clientes', admin, 'POST', { nombre: name }), 201);
  const configure = async (client, reels, carruseles = 0) => {
    const catalog = ok(await api(`/clientes?periodo=${period}`, admin));
    const current = catalog.find(row => row.id === client.id); assert.ok(current);
    return ok(await api(`/clientes/${client.id}/configuraciones`, admin, 'POST', {
      nombre: current.nombre, rubro: 'Servicios', vigente_desde: period, cuota_reels: reels, cuota_carruseles: carruseles,
      dias_historias: [1], dias_reels: [2], dias_carruseles: [3], disenador_responsable: 'Augusto',
      abono_mensual: amount, expected_revision: current.agreement_revision,
    }));
  };
  const client = await createBasic('QA108 basic onboarding'), key = `cliente-${client.id}`;
  let configured, prepared;

  await t.test('actual basic creation followed by repeated goal GETs never prepares or creates work', async () => {
    const before = await snapshot();
    for (const token of [admin, community, employee]) {
      const row = await read(key, token);
      assert.equal(row.preparado, false); assert.equal(row.reels, 0); assert.equal(row.carruseles, 0); assert.deepEqual(row.piezas, []);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('configuration needs a fresh observation; missing/malformed/unknown bodies and denied roles cannot write', async () => {
    const zero = await read(key); await configure(client, 2, 1);
    const before = await snapshot();
    ok(await prepare(bodyFor(zero)), 409);
    configured = await read(key); assert.equal(configured.reels, 2); assert.equal(configured.carruseles, 1);
    assert.notEqual(configured.preparacion_revision, zero.preparacion_revision);
    const valid = bodyFor(configured), { expected_preparation_revision, ...missing } = valid;
    ok(await prepare(missing), 428);
    for (const invalid of [null, '', 1, [], 'f'.repeat(63), `${expected_preparation_revision}\n`])
      ok(await prepare({ ...valid, expected_preparation_revision: invalid }), 400);
    ok(await prepare({ ...valid, unknown_field: true }), 400);
    ok(await prepare({ ...valid, automaticObservation: expected_preparation_revision }), 400);
    ok(await prepare(valid, employee), 403); ok(await prepare(valid, null), 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('two authorized preparations observing the same cohort have exactly one ACK and one conflict, with real ID access', async () => {
    const body = bodyFor(configured);
    const results = await Promise.all([prepare(body, admin), prepare(body, secondAdmin)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const ack = results.find(result => result.status === 200).body;
    assert.equal(ack.creadas, 3); assert.equal(ack.vinculadas, 0); assert.ok(Number.isSafeInteger(ack.objetivo_id));
    prepared = await read(key); assert.equal(prepared.preparado, true); assert.equal(prepared.piezas.length, 3);
    assert.equal(new Set(prepared.piezas.map(piece => piece.tarea_id)).size, 3);
    for (const piece of prepared.piezas) {
      const task = ok(await api(`/tareas/${piece.tarea_id}?workspace=render_os`, employee)); assert.equal(task.id, piece.tarea_id);
      const assignments = await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [piece.tarea_id]);
      assert.deepEqual(assignments, [{ usuario_id: 91003, tipo: 'responsable' }]);
    }
    const before = await snapshot(); ok(await prepare(body), 409); assert.deepEqual(await snapshot(), before);
  });

  await t.test('observed committed ACK loss is not replay authorization; explicit reread permits safe no-duplicate preparation', async () => {
    const isolated = await createBasic('QA108 lost observation'), isolatedKey = `cliente-${isolated.id}`;
    await configure(isolated, 1);
    const fresh = bodyFor(await read(isolatedKey));
    // Ignore a genuine completed response to simulate loss of caller observation,
    // not TCP disconnect and not a claim about native UI behavior.
    ok(await prepare(fresh, community));
    const afterCommit = await snapshot(); ok(await prepare(fresh, community), 409);
    assert.deepEqual(await snapshot(), afterCommit);
    const observed = await read(isolatedKey), savedIds = observed.piezas.map(piece => piece.tarea_id);
    const refreshed = ok(await prepare(bodyFor(observed), community));
    assert.equal(refreshed.creadas, 0); assert.equal(refreshed.vinculadas, 0);
    assert.deepEqual((await read(isolatedKey)).piezas.map(piece => piece.tarea_id), savedIds);
  });

  await t.test('piece state, assignment IDs and quota changes invalidate held preparation before any DML', async () => {
    let held = bodyFor(await read(key));
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91004,'colaborador')", [prepared.piezas[0].tarea_id]);
    let before = await snapshot(); ok(await prepare(held), 409); assert.deepEqual(await snapshot(), before);
    held = bodyFor(await read(key));
    await f.query("UPDATE tareas SET estado='en_progreso' WHERE id=$1", [prepared.piezas[0].tarea_id]);
    before = await snapshot(); ok(await prepare(held), 409); assert.deepEqual(await snapshot(), before);
    held = bodyFor(await read(key)); await configure(client, 3, 1);
    before = await snapshot(); ok(await prepare(held), 409); assert.deepEqual(await snapshot(), before);
    // A fresh preparation observation does not authorize accepting quota drift.
    ok(await prepare(bodyFor(await read(key))), 409); assert.deepEqual(await snapshot(), before);
  });

  await t.test('shared feed prepares one quota across two real accounts; membership change invalidates held observation', async () => {
    const first = await createBasic('QA108 shared A'), second = await createBasic('QA108 shared B');
    const [group] = await f.query("INSERT INTO grupos_feed(nombre,cuota_reels,cuota_carruseles) VALUES('QA108 shared',1,1) RETURNING id");
    await f.query('UPDATE clientes SET grupo_feed_id=$1 WHERE id=ANY($2::int[])', [group.id, [first.id, second.id]]);
    const sharedKey = `grupo-${group.id}`, observed = await read(sharedKey), held = bodyFor(observed);
    assert.equal(observed.cuentas.length, 2); assert.equal(observed.reels, 1); assert.equal(observed.carruseles, 1);
    const result = ok(await prepare(held, community)); assert.equal(result.creadas, 2);
    const saved = await read(sharedKey); assert.equal(saved.piezas.length, 2);
    assert.equal(new Set(saved.piezas.map(piece => piece.tarea_id)).size, 2);
    const next = bodyFor(saved);
    await f.query('UPDATE clientes SET grupo_feed_id=NULL WHERE id=$1', [second.id]);
    const before = await snapshot(); ok(await prepare(next, community), 409); assert.deepEqual(await snapshot(), before);
    assert.equal((await read(sharedKey)).cuentas.length, 2, 'Stored historical accounts are preserved; fingerprint must still observe live membership');
  });

  await t.test('trusted scheduler stale observation cannot override a newer explicit CM assignment; real repeated jobs create no duplicate work/publications', async () => {
    const { prepareGoal, reconcileMonthlyGoals } = await import('../src/client-goals.js');
    const basic = await createBasic('QA108 scheduler stale intent'); await configure(basic, 1);
    const isolatedKey = `cliente-${basic.id}`, old = await read(isolatedKey);
    const changed = { ...bodyFor(old), responsables: [91004], responsables_por_formato: { video: [91004], carrusel: [91004] } };
    const ack = ok(await prepare(changed, community)); assert.equal(ack.creadas, 1);
    const saved = await read(isolatedKey), ids = saved.piezas.map(piece => piece.tarea_id);
    assert.equal(ids.length, 1);
    assert.deepEqual(saved.responsables_por_formato.video.map(person => person.id), [91004]);
    const before = await snapshot();
    await assert.rejects(prepareGoal(jobPool, { period, key: isolatedKey,
      responsibleIds: [91003], responsibleByType: { video: [91003], carrusel: [91003] },
      persistResponsibles: true, actor: 'Generación mensual automática', automaticObservation: old.preparacion_revision }),
    error => error.status === 409);
    assert.deepEqual(await snapshot(), before, 'Old trusted job must not rewrite configured assignments or any business rows');
    const automatic = await createBasic('QA108 real scheduler generation'); await configure(automatic, 1);
    const automaticKey = `cliente-${automatic.id}`;
    // Synthetic persisted assignment fixture, as used by the actual scheduler;
    // no public internal-observation field or fake auth grant is introduced.
    await f.query(`INSERT INTO cliente_objetivo_responsables(clave,tipo,usuario_id,actualizado_por)
      VALUES ($1,'video',91003,'QA108 fixture'),($1,'carrusel',91003,'QA108 fixture')`, [automaticKey]);
    assert.equal((await read(automaticKey)).preparado, false);
    const publications = before.publicaciones, stories = before.historias, evidence = before.editorial_publicacion_eventos;
    let automaticIds;
    for (let run = 0; run < 2; run++) {
      const result = await reconcileMonthlyGoals(jobPool, period);
      assert.equal(result.periodo, period); assert.ok(Array.isArray(result.pendientes));
      const current = await read(isolatedKey);
      assert.deepEqual(current.piezas.map(piece => piece.tarea_id), ids);
      assert.deepEqual(current.responsables_por_formato.video.map(person => person.id), [91004]);
      assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [ids[0]]),
        [{ usuario_id: 91004, tipo: 'responsable' }]);
      const after = await snapshot();
      assert.deepEqual(after.publicaciones, publications); assert.deepEqual(after.historias, stories);
      assert.deepEqual(after.editorial_publicacion_eventos, evidence);
      assert.equal(after.tareas.filter(task => task.cliente_id === basic.id).length, 1);
      assert.equal(after.cliente_objetivo_piezas.filter(piece => piece.objetivo_id === ack.objetivo_id).length, 1);
      const generated = await read(automaticKey);
      assert.equal(generated.preparado, true); assert.equal(generated.piezas.length, 1);
      if (run === 0) automaticIds = generated.piezas.map(piece => piece.tarea_id);
      assert.deepEqual(generated.piezas.map(piece => piece.tarea_id), automaticIds);
      assert.equal(after.tareas.filter(task => task.cliente_id === automatic.id).length, 1);
      assert.equal(after.cliente_objetivo_piezas.filter(piece => piece.objetivo_id === generated.id).length, 1);
    }
  });

  await t.test('selected responsible row wait precedes the global goal mutex; preparation completes after both barriers release', async () => {
    const basic = await createBasic('QA108 selected-user lock order');
    await configure(basic, 1);
    const isolatedKey = `cliente-${basic.id}`, payload = bodyFor(await read(isolatedKey));
    const holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const before = await snapshot();
      pending = (async () => {
        const response = await fetch(new URL('/api/cliente-objetivos/preparar', f.base), { method: 'POST',
          signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload) });
        return { status: response.status, body: await response.json() };
      })();
      void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await observer.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))
          AND query ILIKE '%FROM usuarios%' AND query ILIKE '%ANY(%' AND query ILIKE '%FOR SHARE%'`, [pid]);
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'HTTP preparation must actually be blocked on the selected responsible FOR SHARE');
      await observer.query('BEGIN');
      const { rows: [lock] } = await observer.query("SELECT pg_try_advisory_xact_lock(hashtext('vinculo-objetivo-mensual')) AS acquired");
      assert.equal(lock.acquired, true, 'Preparation must not hold the global goal mutex while awaiting selected users');
      assert.deepEqual(await snapshot(), before, 'No preparation DML may occur while the selected user is blocked');
      // Release the probe mutex BEFORE the responsible row: do not manufacture a cycle.
      await observer.query('COMMIT');
      await holder.query('COMMIT');
      const ack = ok(await pending); assert.equal(ack.creadas, 1); assert.equal(ack.vinculadas, 0);
      const saved = await read(isolatedKey); assert.equal(saved.piezas.length, 1);
      const task = ok(await api(`/tareas/${saved.piezas[0].tarea_id}?workspace=render_os`, employee));
      assert.equal(task.id, saved.piezas[0].tarea_id);
      assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [task.id]),
        [{ usuario_id: 91003, tipo: 'responsable' }]);
    } finally {
      await observer.query('ROLLBACK').catch(() => {});
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });

  for (const loss of [
    { id: 991082, name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { id: 991083, name: 'role demotion', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 401 },
  ]) await t.test(`${loss.name} committed while actor row is held denies after actual HTTP lock wait`, async () => {
    const id = loss.id, name = `qa108_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA108 isolated authority','community',password_hash,true,1 FROM usuarios WHERE id=91004`, [id, name]);
    const token = await login(name), basic = await createBasic(`QA108 authority client ${id}`);
    await configure(basic, 1);
    const payload = bodyFor(await read(`cliente-${basic.id}`));
    const holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [id]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = (async () => {
        const response = await fetch(new URL('/api/cliente-objetivos/preparar', f.base), { method: 'POST',
          signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        return { status: response.status, body: await response.json() };
      })();
      void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await observer.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AND query ILIKE '%usuarios%'`, [pid]);
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Actual principal HTTP must wait on the held actor row, not a timed assumption');
      await holder.query(loss.sql, [id]); await holder.query('COMMIT');
      const before = await snapshot(); ok(await pending, loss.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });
});
