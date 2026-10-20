import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('principal production writes revalidate and hold current actor authority through commit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55713 });
  let pool;
  t.after(async () => {
    try { if (pool) await pool.end(); }
    finally { await fixture.cleanup(); }
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55713/render2_local_test';
  const guard = { root: fixture.root, cwd: fixture.root, port: 55713, url };
  assertFixtureIdentity(guard);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
  assertFixtureIdentity({ ...guard, identity: (await pool.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`)).rows[0] });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Expected fixture HTTP status'); return response.body;
  };
  const login = async usuario => checked(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  const admin = await login('qa_franco');
  const api = async (route, body, token = admin, method = 'POST') => {
    const response = await fetch(new URL(`/api${route}`, fixture.base), {
      method, signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const [client] = (await pool.query("INSERT INTO clientes(nombre) VALUES ('QA92 production authority') RETURNING id")).rows;
  const visitBody = title => ({ cliente_id: client.id, fecha: '2026-10-20', titulo: title, participante_ids: [91003] });
  let visit = checked(await api('/producciones', visitBody('QA92 authority visit')), 201).visita;
  visit = checked(await api(`/producciones/${visit.id}/videos`, { expected_revision: visit.revision,
    titulo: 'QA92 authority video', estado: 'grabado', material_url: 'https://example.invalid/qa92-material' }), 201).visita;
  visit = checked(await api(`/producciones/${visit.id}/fotos`, { expected_revision: visit.revision, tipo: 'QA92 photos' }), 201).visita;
  const videoId = visit.videos[0].id, photoId = visit.fotos[0].id;
  const readVisit = async () => checked(await api(`/producciones/${visit.id}`, undefined, admin, 'GET')).visita;
  const [goal] = (await pool.query(`INSERT INTO cliente_objetivos_mensuales
    (clave,periodo,cliente_id,cuentas,nombre,reels,carruseles,preparado_por)
    VALUES ('qa92-authority','2026-10-01',$1,jsonb_build_array(jsonb_build_object('id',$1::int)),
      'QA92 authority goal',2,0,'fixture') RETURNING id`, [client.id])).rows;
  const targets = [];
  for (const hasPiece of [true, false]) {
    const piece = hasPiece ? (await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada)
      VALUES ($1,'video','pendiente','2026-10-29') RETURNING *`, [client.id])).rows[0] : null;
    const task = (await pool.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,estado,fecha_vencimiento,propiedades_extra)
      VALUES ('QA92 canonical delivery','Luciano QA',$1,$2,'edicion','video','pendiente','2026-10-25',
      '{"workspace":"render_os","periodo_objetivo":"2026-10"}') RETURNING *`, [client.id, piece?.id ?? null])).rows[0];
    await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [task.id]);
    const slot = (await pool.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo)
      VALUES ($1,'video',$2,$3,$4,'QA92 canonical slot') RETURNING *`, [goal.id, targets.length + 1, task.id, piece?.id ?? null])).rows[0];
    targets.push({ piece, task, slot });
  }
  let sequence = 129000;
  const actor = async (role = 'admin') => {
    const id = ++sequence, usuario = `qa92_actor_${id}`;
    await pool.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA92 independent actor',$3,password_hash,TRUE,1 FROM usuarios WHERE id=91004`, [id, usuario, role]);
    return { id, token: await login(usuario) };
  };
  const tables = ['produccion_visitas', 'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos',
    'produccion_reconciliaciones', 'produccion_edicion_adopciones', 'tareas', 'tarea_asignaciones', 'publicaciones', 'historias',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
    return result;
  };
  // Fresh autocommit observations: only actual blocker/lock evidence establishes
  // ordering. Elapsed time is solely a bounded failure condition, never success.
  const observe = async (sql, values) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const result = await pool.query(sql, values);
      if (result.rows.length) return result.rows[0];
    }
    assert.fail('Expected PostgreSQL lock dependency was not observed');
  };
  const actorWait = lockerPid => observe(`SELECT a.pid FROM pg_stat_activity a
    WHERE a.pid<>pg_backend_pid() AND a.state='active' AND a.wait_event_type='Lock'
      AND a.query ~* 'FROM[[:space:]]+usuarios' AND a.query ~* 'FOR[[:space:]]+SHARE'
      AND $1::int=ANY(pg_blocking_pids(a.pid))
      AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted)`, [lockerPid]);
  const operations = [
    { name: 'create visit', route: '/producciones', body: () => visitBody('QA92 denied create'), created: 201 },
    { name: 'PATCH visit', route: `/producciones/${visit.id}`, method: 'PATCH', body: () => ({ titulo: 'QA92 denied rename' }) },
    { name: 'add video', route: `/producciones/${visit.id}/videos`, body: () => ({ titulo: 'QA92 denied video' }) },
    { name: 'PATCH video', route: `/producciones/${visit.id}/videos/${videoId}`, method: 'PATCH', body: () => ({ observaciones: 'QA92 denied video edit' }) },
    { name: 'add photo', route: `/producciones/${visit.id}/fotos`, body: () => ({ tipo: 'QA92 denied photo' }) },
    { name: 'PATCH photo', route: `/producciones/${visit.id}/fotos/${photoId}`, method: 'PATCH', body: () => ({ observaciones: 'QA92 denied photo edit' }) },
    { name: 'handoff', adminOnly: true, route: `/producciones/${visit.id}/videos/${videoId}/enviar-edicion`, body: () => ({ editor_id: 91003, fecha_entrega: '2026-10-29' }) },
    ...targets.map((target, index) => ({ name: index ? 'link objective' : 'link piece', adminOnly: true,
      route: `/producciones/${visit.id}/videos/${videoId}/${index ? 'vincular-objetivo' : 'vincular-pieza'}`,
      body: () => ({ tarea_id: target.task.id, expected_tarea_revision: target.task.revision,
        objetivo_pieza_id: target.slot.id, expected_objetivo_updated_at: target.slot.updated_at,
        ...(index ? { fecha_programada: '2026-10-29' } : { publicacion_id: target.piece.id, expected_publicacion_updated_at: target.piece.updated_at }) }),
    })),
  ];
  for (const operation of operations) for (const mutation of ['inactive', 'epoch', ...(operation.adminOnly ? ['role'] : [])]) {
    await t.test(`${operation.name}: ${mutation} after ordinary middleware denies without business writes`, async () => {
      const user = await actor();
      const current = await readVisit();
      const body = { ...operation.body(), ...(operation.name === 'create visit' ? {} : { expected_revision: current.revision }) };
      const before = await snapshot();
      const locker = await pool.connect();
      let pending;
      try {
        await locker.query('BEGIN');
        await locker.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
        await locker.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [user.id]);
        const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = api(operation.route, body, user.token, operation.method || 'POST').then(value => ({ value }), error => ({ error }));
        // Ordinary auth can read the old committed row; reaching blocked FOR SHARE
        // proves this is the transactional revalidation, not a pre-request revoke.
        await actorWait(pid);
        if (mutation === 'inactive') await locker.query('UPDATE usuarios SET activo=FALSE WHERE id=$1', [user.id]);
        if (mutation === 'epoch') await locker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [user.id]);
        if (mutation === 'role') await locker.query("UPDATE usuarios SET rol='diseno' WHERE id=$1", [user.id]);
        await locker.query('COMMIT');
        const result = await pending;
        if (result.error) throw result.error;
        assert.equal(result.value.status, mutation === 'role' ? 403 : 401, JSON.stringify(result.value.body));
        assert.deepEqual(await snapshot(), before);
        if (mutation === 'role') assert.equal((await pool.query('SELECT session_version FROM usuarios WHERE id=$1', [user.id])).rows[0].session_version, 1);
      } finally {
        try { await locker.query('ROLLBACK'); }
        finally { if (pending) await pending; locker.release(); }
      }
    });
  }
  await t.test('employee can register a visit but cannot hand off a video', async () => {
    const employee = await actor('diseno');
    checked(await api('/producciones', visitBody('QA92 genuine employee visit'), employee.token), 201);
    const before = await snapshot(), current = await readVisit();
    const handoff = operations.find(operation => operation.name === 'handoff');
    assert.equal((await api(handoff.route, { ...handoff.body(), expected_revision: current.revision }, employee.token)).status, 403);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('handoff holds actor share while waiting visit; revocation waits for write commit', async () => {
    const user = await actor(), current = await readVisit();
    const holder = await pool.connect(), revoker = await pool.connect();
    let pending, revocation;
    const beforeTasks = (await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n;
    try {
      await holder.query('BEGIN');
      await holder.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      await holder.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR UPDATE', [visit.id]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const handoff = operations.find(operation => operation.name === 'handoff');
      pending = api(handoff.route, { ...handoff.body(), expected_revision: current.revision }, user.token).then(value => ({ value }), error => ({ error }));
      const writer = await observe(`SELECT a.pid FROM pg_stat_activity a WHERE a.state='active'
        AND a.wait_event_type='Lock' AND a.query ILIKE '%produccion_visitas%' AND a.query ILIKE '%FOR UPDATE%'
        AND $1::int=ANY(pg_blocking_pids(a.pid))`, [holderPid]);
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      revocation = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1 RETURNING session_version', [user.id])
        .then(value => ({ value }), error => ({ error }));
      await observe(`SELECT pid FROM pg_stat_activity WHERE pid=$1 AND state='active' AND wait_event_type='Lock'
        AND $2::int=ANY(pg_blocking_pids(pid))
        AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=$1 AND NOT l.granted)`, [revokerPid, writer.pid]);
      await holder.query('COMMIT');
      const write = await pending;
      if (write.error) throw write.error;
      const committed = checked(write.value, 201);
      assert.equal(committed.created, true);
      assert.equal(committed.task.asignado_a_id, 91003);
      const revoked = await revocation;
      if (revoked.error) throw revoked.error;
      assert.equal(revoked.value.rows[0].session_version, 2);
      const rows = (await pool.query('SELECT tarea_edicion_id FROM produccion_videos WHERE id=$1', [videoId])).rows;
      assert.ok(rows[0].tarea_edicion_id);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n, beforeTasks + 1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003 AND tipo=\'responsable\'', [rows[0].tarea_edicion_id])).rows[0].n, 1);
      const after = await snapshot();
      assert.equal((await api(handoff.route, { ...handoff.body(), expected_revision: (await readVisit()).revision }, user.token)).status, 401);
      assert.deepEqual(await snapshot(), after, 'revoked retry cannot duplicate tasks or mutate registry');
    } finally {
      try { await holder.query('ROLLBACK'); }
      finally {
        try { if (pending) await pending; if (revocation) await revocation; }
        finally { revoker.release(); holder.release(); }
      }
    }
  });
});
