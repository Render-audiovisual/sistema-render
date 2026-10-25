import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness, assertFixtureIdentity, fixturePassword} from '../scripts/render2-local-test.js';
import {loginProductionCookieSession, productionCookieRequest} from './helpers/production-cookie-session.js';

// Independent cookie API context, not a native browser/provider. The membership
// race below requires an observed PostgreSQL edge, not dispatch timing.
// Business setup is explicitly historical: no canonical visit is removed.
test('Wilson web production confirmation rechecks retained identity and current task membership', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55968, f = await startLocalHarness({port, browserSessions: true});
  const connections = new Set();
  t.after(async () => {
    try {
      for (const db of connections) {
        try {await db.query('ROLLBACK');} catch {}
        try {await db.end();} catch {}
      }
    } finally {
      await f.cleanup();
      await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned Wilson cookie PG55968/API stopped and removed. No provider/native claim.');
    }
  });
  const identitySql = `SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`;
  const checkIdentity = identity => assertFixtureIdentity({root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity});
  checkIdentity((await f.query(identitySql))[0]);
  async function auxiliary() {
    const db = new pg.Client({host: '127.0.0.1', port, database: 'render2_local_test', user: 'render2_fixture',
      password: '', ssl: false, application_name: 'render2_qa379_wilson',
      statement_timeout: 20000, lock_timeout: 18000, connectionTimeoutMillis: 5000});
    await db.connect(); connections.add(db);
    checkIdentity((await db.query(identitySql)).rows[0]);
    db.pid = (await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    return db;
  }
  async function dispose(db) {
    if (!db) return;
    try {await db.query('ROLLBACK');} finally {await db.end(); connections.delete(db);}
  }
  const actorId = 91005;
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,'qa_wilson_production','QA379 Production','produccion',password_hash,true,1
    FROM usuarios WHERE id=91003`, [actorId]);
  const session = await loginProductionCookieSession(f.base, 'qa_wilson_production', fixturePassword);
  assert.equal(session.user.id, actorId);
  const api = (path, method = 'POST', body) => productionCookieRequest(f.base, `/api/wilson${path}`, {session, method, body});
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded = []) {
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      hashes[table] = (await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
    }
    return hashes;
  }
  let sequence = 0;
  async function prepared() {
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
      VALUES($1,'QA379 Production','produccion','en_progreso','2026-10-20',
        '{"workspace":"render_os","produccion_videos_previstos":4,"qa379":"keep"}'::jsonb)
      RETURNING id,revision`, [`QA379 Visita histórica ${++sequence}`]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [task.id, actorId]);
    assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [task.id]), []);
    const response = await api('/produccion/preparar', 'POST', {tarea_id: task.id, cantidad: 2, fecha: '2026-10-20'});
    assert.equal(response.status, 201, 'Prepare HTTP status only; credentials/headers omitted');
    const token = response.body.confirmation?.token;
    assert.equal(typeof token, 'string');
    assert.ok(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(token), 'Expected confirmation UUID');
    assert.equal(response.body.confirmation.task_id, task.id);
    return {...task, token};
  }
  async function pending(row) {
    const [action] = await f.query(`SELECT usuario_id,accion,tarea_id,confirmed_at,payload
      FROM wilson_acciones_pendientes WHERE token=$1`, [row.token]);
    assert.ok(action); assert.equal(action.usuario_id, actorId);
    assert.equal(action.accion, 'registrar_produccion'); assert.equal(action.tarea_id, row.id);
    return action;
  }
  for (const change of ['membership', 'workspace']) {
    await t.test(`${change} withdrawn after prepare returns404 and leaves token plus all public rows intact`, async () => {
      const row = await prepared();
      if (change === 'membership') await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [row.id, actorId]);
      else await f.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||'{"workspace":"historical"}'::jsonb WHERE id=$1`, [row.id]);
      const before = await snapshot();
      const response = await api(`/confirmaciones/${row.token}`, 'POST', {});
      assert.equal(response.status, 404);
      assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal((await pending(row)).confirmed_at, null);
      assert.deepEqual(await snapshot(), before);
    });
  }
  await t.test('assignment withdrawn under parent lock while real confirmation waits is rejected by fresh ACL', async () => {
    const row = await prepared();
    const before = await snapshot(['tarea_asignaciones']);
    const otherAssignments = async () => (await f.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
      ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash
      FROM tarea_asignaciones r WHERE tarea_id<>$1`, [row.id]))[0].hash;
    const others = await otherAssignments();
    assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [row.id]),
      [{tarea_id: row.id, usuario_id: actorId, tipo: 'responsable'}]);
    let blocker, monitor, request;
    try {
      blocker = await auxiliary(); monitor = await auxiliary();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [row.id]);
      let settled = false;
      request = api(`/confirmaciones/${row.token}`, 'POST', {});
      request.then(() => {settled = true;}, () => {settled = true;});
      const deadline = Date.now() + 3000;
      let writer = null;
      do {
        assert.equal(settled, false, 'Confirmation finished before required task-lock blocking edge');
        const {rows} = await monitor.query(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))
          AND pid<>ALL($2::int[]) AND state='active'
          AND query ~ '^SELECT \\* FROM tareas WHERE id=\\$1 FOR UPDATE[;[:space:]]*$'`,
        [blocker.pid, [...connections].map(db => db.pid)]);
        if (rows.length) {
          assert.equal(rows.length, 1, 'Exactly one principal HTTP task-lock waiter');
          writer = rows[0].pid; break;
        }
        // Poll pacing only: the PostgreSQL blocking edge is the race oracle.
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.ok(writer, 'Expected real confirmation blocked on the owned task row within three seconds');
      const removed = await blocker.query(`DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2
        RETURNING tarea_id,usuario_id,tipo`, [row.id, actorId]);
      assert.deepEqual(removed.rows, [{tarea_id: row.id, usuario_id: actorId, tipo: 'responsable'}]);
      await blocker.query('COMMIT');
      const response = await request;
      assert.equal(response.status, 404); assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal((await pending(row)).confirmed_at, null);
      assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [row.id]), []);
      assert.equal(await otherAssignments(), others);
      assert.deepEqual(await snapshot(['tarea_asignaciones']), before);
    } finally {
      // Release the parent before draining HTTP, including failed-edge paths.
      if (blocker) await blocker.query('ROLLBACK').catch(() => {});
      if (request) await Promise.allSettled([request]);
      try {await dispose(blocker);} finally {await dispose(monitor);}
    }
  });
  for (const resource of ['task', 'token']) {
  await t.test(`token expires by PostgreSQL wall clock while confirmation waits on ${resource}; transaction-start time cannot authorize it`, async () => {
    const row = await prepared();
    let blocker, monitor, request;
    try {
      blocker = await auxiliary(); monitor = await auxiliary();
      await blocker.query('BEGIN');
      if (resource === 'task') await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [row.id]);
      // This is a future deadline set BEFORE the real HTTP transaction starts,
      // not a retroactive expiry that NOW() could also reject.
      await monitor.query(`UPDATE wilson_acciones_pendientes
        SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token=$1`, [row.token]);
      // Set the deadline before retaining the token row: the monitor's UPDATE
      // must not wait on our own blocker. This lock does not change row data.
      if (resource === 'token') await blocker.query('SELECT token FROM wilson_acciones_pendientes WHERE token=$1 FOR UPDATE', [row.token]);
      const before = await snapshot();
      let settled = false;
      request = api(`/confirmaciones/${row.token}`, 'POST', {});
      request.then(() => {settled = true;}, () => {settled = true;});
      const deadline = Date.now() + 4000;
      let writer = null, expiredUnderLock = false;
      do {
        assert.equal(settled, false, 'Confirmation ended before the required expiry-under-lock observation');
        const {rows} = await monitor.query(`SELECT a.pid,
          a.xact_start<p.expires_at AS began_before_expiry,
          clock_timestamp()>p.expires_at AS expired
          FROM pg_stat_activity a CROSS JOIN wilson_acciones_pendientes p
          WHERE p.token=$1 AND a.datname=current_database()
          AND $2::int=ANY(pg_blocking_pids(a.pid)) AND a.pid<>ALL($3::int[])
          AND a.state='active'
          AND a.query ~ $4`,
        [row.token, blocker.pid, [...connections].map(db => db.pid), resource === 'task'
          ? '^SELECT \\* FROM tareas WHERE id=\\$1 FOR UPDATE[;[:space:]]*$'
          : '^SELECT \\* FROM wilson_acciones_pendientes WHERE token=\\$1 AND usuario_id=\\$2 AND confirmed_at IS NULL AND expires_at>clock_timestamp\\(\\) FOR UPDATE[;[:space:]]*$']);
        if (rows.length) {
          assert.equal(rows.length, 1, `Exactly one real HTTP confirmation waits on the owned ${resource}`);
          assert.equal(rows[0].began_before_expiry, true, 'Fixture deadline must follow HTTP transaction start');
          if (writer !== null) assert.equal(rows[0].pid, writer, 'Same HTTP transaction remains blocked');
          writer = rows[0].pid;
          if (rows[0].expired) {expiredUnderLock = true; break;}
        }
        // Only pacing: both expiry and lock ownership are proved by PostgreSQL.
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.ok(writer, `Real principal HTTP ${resource}-lock waiter was not observed`);
      assert.equal(expiredUnderLock, true, 'PostgreSQL clock must pass expiry while the same transaction is blocked');
      await blocker.query('COMMIT');
      const response = await request;
      assert.equal(response.status, 409); assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal((await pending(row)).confirmed_at, null);
      assert.deepEqual(await snapshot(), before);
    } finally {
      if (blocker) await blocker.query('ROLLBACK').catch(() => {});
      if (request) await Promise.allSettled([request]);
      try {await dispose(blocker);} finally {await dispose(monitor);}
    }
  });
  }
  await t.test('authorized confirmation writes exactly one record, audit and message; reuse409 is read-only', async () => {
    const row = await prepared();
    const changed = ['tareas', 'wilson_acciones_pendientes', 'integracion_auditoria', 'wilson_mensajes'];
    const before = await snapshot(changed);
    const counts = async () => (await f.query(`SELECT
      (SELECT count(*)::int FROM integracion_auditoria WHERE integracion='wilson' AND canal='web'
        AND accion='registrar_produccion' AND tarea_id=$1) audits,
      (SELECT count(*)::int FROM wilson_mensajes WHERE tipo='accion_confirmada' AND metadata->>'task_id'=$1::text) messages`, [row.id]))[0];
    assert.deepEqual(await counts(), {audits: 0, messages: 0});
    const [otherTasks] = await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
      ORDER BY id)::text,'[]')) hash FROM tareas r WHERE id<>$1`, [row.id]);
    const response = await api(`/confirmaciones/${row.token}`, 'POST', {});
    assert.equal(response.status, 200); assert.equal(response.body.task_id, row.id);
    const [stored] = await f.query('SELECT id,estado,revision,propiedades_extra FROM tareas WHERE id=$1', [row.id]);
    assert.equal(stored.id, row.id); assert.equal(stored.estado, 'en_progreso');
    assert.equal(stored.revision, row.revision + 1);
    assert.equal(stored.propiedades_extra.qa379, 'keep');
    const records = stored.propiedades_extra.produccion_registros;
    assert.equal(records.length, 1); assert.equal(records[0].cantidad, 2);
    assert.equal(records[0].fecha, '2026-10-20'); assert.equal(records[0].usuario, 'QA379 Production');
    assert.deepEqual(stored.propiedades_extra.wilson_ultimo_registro, records[0]);
    assert.notEqual((await pending(row)).confirmed_at, null);
    assert.deepEqual(await counts(), {audits: 1, messages: 1});
    const [audit] = await f.query(`SELECT actor_id,actor_nombre,detalles FROM integracion_auditoria
      WHERE integracion='wilson' AND canal='web' AND accion='registrar_produccion' AND tarea_id=$1`, [row.id]);
    assert.equal(audit.actor_id, String(actorId)); assert.equal(audit.actor_nombre, 'QA379 Production');
    assert.deepEqual(audit.detalles, records[0]);
    assert.equal((await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
      ORDER BY id)::text,'[]')) hash FROM tareas r WHERE id<>$1`, [row.id]))[0].hash, otherTasks.hash);
    assert.deepEqual(await snapshot(changed), before);
    const confirmed = await snapshot();
    assert.equal((await api(`/confirmaciones/${row.token}`, 'POST', {})).status, 409);
    assert.deepEqual(await snapshot(), confirmed);
  });
  await t.test('revoked cookie actor cannot consume a prepared token or change any domain rows', async () => {
    const row = await prepared();
    try {
      await f.query('UPDATE usuarios SET activo=false WHERE id=$1', [actorId]);
      const before = await snapshot();
      assert.equal((await api(`/confirmaciones/${row.token}`, 'POST', {})).status, 401);
      assert.equal((await pending(row)).confirmed_at, null);
      assert.deepEqual(await snapshot(), before);
    } finally {await f.query('UPDATE usuarios SET activo=true WHERE id=$1', [actorId]);}
  });

  // Explicit fixture pending intents, never inferred recipients or external
  // transport. The real confirmation route remains the only action executor.
  const admin = await loginProductionCookieSession(f.base, 'qa_franco', fixturePassword);
  assert.equal(admin.user.id, 91001);
  const messageApi = token => productionCookieRequest(f.base, `/api/wilson/confirmaciones/${token}`, {
    session: admin, method: 'POST', body: {},
  });
  async function pendingMessage(targetId = 91003) {
    const [clock] = await f.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') period`);
    await f.query(`INSERT INTO wilson_conversaciones(usuario_id,periodo) VALUES(91001,$1)
      ON CONFLICT(usuario_id,periodo) DO NOTHING`, [clock.period]);
    const [conversation] = await f.query('SELECT id FROM wilson_conversaciones WHERE usuario_id=91001 AND periodo=$1', [clock.period]);
    const token = randomUUID(), message = `QA383 internal message ${token}`;
    await f.query(`INSERT INTO wilson_acciones_pendientes(token,conversacion_id,usuario_id,accion,payload,expires_at)
      VALUES($1,$2,91001,'enviar_mensaje_empleado',$3::jsonb,clock_timestamp()+interval '5 minutes')`,
    [token, conversation.id, JSON.stringify({target_user_id: targetId, message})]);
    return {token, message, conversationId: conversation.id};
  }
  async function messageUnconsumed(token) {
    const [row] = await f.query('SELECT confirmed_at FROM wilson_acciones_pendientes WHERE token=$1', [token]);
    assert.ok(row); assert.equal(row.confirmed_at, null);
  }
  for (const target of ['inactive', 'missing']) {
    await t.test(`admin message to ${target} target returns404 with unconsumed token and all public tables intact`, async () => {
      const targetId = target === 'inactive' ? 91003 : 2147483001;
      assert.equal((await f.query('SELECT id FROM usuarios WHERE id=$1', [targetId])).length, target === 'inactive' ? 1 : 0);
      const intent = await pendingMessage(targetId);
      try {
        if (target === 'inactive') await f.query('UPDATE usuarios SET activo=false WHERE id=$1', [targetId]);
        const before = await snapshot();
        const response = await messageApi(intent.token);
        assert.equal(response.status, 404); assert.deepEqual(Object.keys(response.body), ['error']);
        await messageUnconsumed(intent.token); assert.deepEqual(await snapshot(), before);
      } finally {if (target === 'inactive') await f.query('UPDATE usuarios SET activo=true WHERE id=$1', [targetId]);}
    });
  }
  await t.test('target deactivation committed while real message confirmation waits on target SHARE returns404 without consuming intent', async () => {
    const intent = await pendingMessage();
    let blocker, monitor, request;
    const userHashSql = `SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
      ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM usuarios r`;
    try {
      blocker = await auxiliary(); monitor = await auxiliary();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      await blocker.query('UPDATE usuarios SET activo=false WHERE id=91003');
      const before = await snapshot();
      // Include exactly the fixture's deliberate uncommitted user change in
      // the expected post-commit image; every other table must remain intact.
      before.usuarios = (await blocker.query(userHashSql)).rows[0].hash;
      let settled = false;
      request = messageApi(intent.token);
      request.then(() => {settled = true;}, () => {settled = true;});
      const deadline = Date.now() + 3000;
      let writer = null;
      do {
        assert.equal(settled, false, 'Message confirmation ended before required target-user blocking edge');
        const {rows} = await monitor.query(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))
          AND pid<>ALL($2::int[]) AND state='active'
          AND query ~ '^SELECT id,nombre FROM usuarios WHERE id=\\$1 AND activo IS TRUE FOR SHARE[;[:space:]]*$'`,
        [blocker.pid, [...connections].map(db => db.pid)]);
        if (rows.length) {assert.equal(rows.length, 1); writer = rows[0].pid; break;}
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.ok(writer, 'Expected real HTTP target-user SHARE waiter');
      await blocker.query('COMMIT');
      const response = await request;
      assert.equal(response.status, 404); assert.deepEqual(Object.keys(response.body), ['error']);
      await messageUnconsumed(intent.token); assert.deepEqual(await snapshot(), before);
    } finally {
      if (blocker) await blocker.query('ROLLBACK').catch(() => {});
      if (request) await Promise.allSettled([request]);
      try {await dispose(blocker);} finally {
        try {await dispose(monitor);} finally {await f.query('UPDATE usuarios SET activo=true WHERE id=91003');}
      }
    }
  });
  await t.test('active renamed target is resolved only by ID; one claim adds two internal messages and one audit, never provider delivery', async () => {
    const [original] = await f.query('SELECT nombre FROM usuarios WHERE id=91003');
    const intent = await pendingMessage();
    try {
      await f.query("UPDATE usuarios SET nombre='QA383 Renamed Target' WHERE id=91003");
      const changed = ['wilson_acciones_pendientes', 'wilson_conversaciones', 'wilson_mensajes', 'integracion_auditoria'];
      const before = await snapshot(changed);
      const oldMessages = (await f.query('SELECT id FROM wilson_mensajes ORDER BY id')).map(row => row.id);
      const [oldCounts] = await f.query(`SELECT (SELECT count(*)::int FROM wilson_mensajes) messages,
        (SELECT count(*)::int FROM integracion_auditoria) audits`);
      const response = await messageApi(intent.token);
      assert.equal(response.status, 200); assert.equal(response.body.target_user_id, 91003);
      const messages = await f.query(`SELECT conversacion_id,contenido,tipo,metadata FROM wilson_mensajes
        WHERE NOT(id=ANY($1::bigint[])) ORDER BY id`, [oldMessages]);
      assert.equal(messages.length, 2);
      const leader = messages.find(row => row.tipo === 'mensaje_lider');
      const confirmed = messages.find(row => row.tipo === 'accion_confirmada');
      assert.ok(leader); assert.ok(confirmed); assert.equal(leader.contenido, intent.message);
      assert.equal(leader.metadata.ordered_by, 91001);
      assert.equal(confirmed.conversacion_id, intent.conversationId);
      assert.match(confirmed.contenido, /QA383 Renamed Target/);
      const [destination] = await f.query('SELECT usuario_id FROM wilson_conversaciones WHERE id=$1', [leader.conversacion_id]);
      assert.equal(destination.usuario_id, 91003);
      const audits = await f.query(`SELECT actor_id,actor_nombre,detalles FROM integracion_auditoria
        WHERE integracion='wilson' AND canal='web' AND accion='enviar_mensaje_empleado' AND detalles->>'message'=$1`, [intent.message]);
      assert.equal(audits.length, 1); assert.equal(audits[0].actor_id, '91001');
      assert.equal(audits[0].detalles.target_user_id, 91003);
      assert.equal(audits[0].detalles.target_name, 'QA383 Renamed Target');
      const [counts] = await f.query(`SELECT (SELECT count(*)::int FROM wilson_mensajes) messages,
        (SELECT count(*)::int FROM integracion_auditoria) audits`);
      assert.deepEqual(counts, {messages: oldCounts.messages + 2, audits: oldCounts.audits + 1});
      assert.notEqual((await f.query('SELECT confirmed_at FROM wilson_acciones_pendientes WHERE token=$1', [intent.token]))[0].confirmed_at, null);
      assert.deepEqual(await snapshot(changed), before);
      const confirmedSnapshot = await snapshot();
      assert.equal((await messageApi(intent.token)).status, 409);
      assert.deepEqual(await snapshot(), confirmedSnapshot);
    } finally {await f.query('UPDATE usuarios SET nombre=$1 WHERE id=91003', [original.nombre]);}
  });
});
