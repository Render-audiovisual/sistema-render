import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loadReportSnapshot } from '../src/report-snapshot.js';

// Physical database + principal HTTP. Query wrappers below pause real leased
// clients; they neither supply rows nor replace authorization/annotation logic.
test('QA117 report HTTP and real PostgreSQL snapshot annotations', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55764 });
  let pool;
  t.after(async () => {
    await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA117 cleanup ENOENT: ${f.root}; PostgreSQL port55764`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55764/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55764, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa117-own-report' });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async name => ok(await api('/login', null, 'POST', { usuario: name, password: fixturePassword })).token;
  const admin = await login('qa_franco');
  const roles = ['diseno', 'edicion', 'produccion', 'community', 'programacion', 'qa_unknown'];
  const actors = [];
  for (const [index, role] of roles.entries()) {
    const id = 991170 + index;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA117 same display name',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa117_${index}`, role]);
    actors.push({ id, role, token: await login(`qa117_${index}`) });
  }
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA117 report client',true) RETURNING id");
  const marker = 'QA117_PRIVATE_FINANCIAL_BAG';
  const pieceId = 997217;
  for (const table of ['historias', 'publicaciones']) {
    await f.query(`INSERT INTO ${table}(id,cliente_id,${table === 'publicaciones' ? 'tipo,' : ''}estado,fecha_programada,metadata)
      VALUES($1,$2,${table === 'publicaciones' ? "'carrusel'," : ''}'lista','2026-10-20',$3::jsonb)`,
    [pieceId, client.id, JSON.stringify({ financial: { marker, importe: 817293.46 } })]);
    const domain = table === 'historias' ? 'historia' : 'publicacion';
    const current = ok(await api(`/editorial-publicacion/${domain}/${pieceId}`, admin));
    const [clock] = await f.query(`SELECT to_char((statement_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS past`);
    ok(await api(`/editorial-publicacion/${domain}/${pieceId}/confirmar`, admin, 'POST', {
      request_id: randomUUID(), expected_revision: current.piece.revision, occurred_at: clock.past,
    }), 201);
  }
  const tasks = [];
  for (const workspace of ['historical', 'render_os']) {
    const [task] = await f.query(`INSERT INTO tareas(titulo,cliente_id,historia_id,publicacion_id,asignado_a,estado,tipo_tarea,fecha_vencimiento,propiedades_extra)
      VALUES($1,$2,$3,$4,'QA117 same display name','pendiente','edicion','2026-10-20',$5::jsonb) RETURNING id`,
    [`QA117 ${workspace}`, client.id, workspace === 'historical' ? pieceId : null,
      workspace === 'render_os' ? pieceId : null,
      JSON.stringify({ ...(workspace === 'render_os' ? { workspace } : {}), financial: { marker, importe: 817293.46 } })]);
    for (const actor of actors.filter(actor => actor.role !== 'qa_unknown'))
      await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'colaborador')", [task.id, actor.id]);
    tasks.push(task.id);
  }
  const [nameOnly] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea)
    VALUES('QA117 name-only must not grant','QA117 same display name','pendiente','edicion') RETURNING id`);
  // Synthetic SQL registry rows exercise the existing shared production DTO,
  // including private working text that must never survive that projection.
  const visitId = randomUUID(), videoId = randomUUID(), photoId = randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,observaciones,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'2026-10-20','QA117 shared production',$3,91001,91001)`, [visitId, client.id, marker]);
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,observaciones,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA117 shared video',$3,$3,91001,91001)`, [videoId, visitId, marker]);
  await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,observaciones,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA117 shared photo',$3,91001,91001)`, [photoId, visitId, marker]);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      rows[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return rows;
  };
  const query = { mes_configuracion: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' };
  const report = async (token, search = new URLSearchParams(query).toString()) => {
    const response = await fetch(new URL(`/api/reportes/datos?${search}`, f.base), {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };

  await t.test('HTTP real evidence, linked domain identities and ID memberships; reads leave every table unchanged', async () => {
    const before = await snapshot();
    const response = await report(admin), data = ok(response);
    assert.equal(response.cache, 'no-store');
    for (const key of ['historias', 'publicaciones']) {
      const piece = data[key].find(row => row.id === pieceId);
      assert.equal(piece.publicacion_evidencia.classification, 'confirmada_manualmente');
      assert.ok(piece.publicacion_evidencia.confirmation.id);
    }
    for (const actor of actors.filter(actor => actor.role !== 'qa_unknown')) {
      const result = await report(actor.token), body = ok(result);
      assert.equal(result.cache, 'no-store');
      assert.ok(body.tareas.some(row => row.id === tasks[0]));
      assert.equal(body.tareas.some(row => row.id === nameOnly.id), false);
      assert.equal(body.tareasRenderOs.some(row => row.id === tasks[1]), actor.role !== 'community');
      assert.equal(JSON.stringify(body).includes(marker), false);
      assert.equal(JSON.stringify(body).includes('817293.46'), false);
      assert.deepEqual(body.usuarios.map(row => row.id), [actor.id]);
      assert.ok(body.historias.some(row => row.id === pieceId));
      assert.ok(body.publicaciones.some(row => row.id === pieceId));
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('verified unknown role receives only own user and closed shared production; anonymous and malformed queries reject without writes', async () => {
    const before = await snapshot();
    const denied = ok(await report(null), 401);
    assert.equal(Object.hasOwn(denied, 'tareas'), false);
    const unknown = actors.at(-1), response = await report(unknown.token), body = ok(response);
    assert.equal(response.cache, 'no-store');
    for (const key of ['tareas', 'tareasRenderOs', 'historias', 'publicaciones', 'clientes', 'entregasEdicion'])
      assert.deepEqual(body[key], [], key);
    assert.deepEqual(body.resumenRenderOsPorDia, {});
    assert.deepEqual(body.usuarios, [{ id: unknown.id, usuario: 'qa117_5', nombre: 'QA117 same display name', rol: 'qa_unknown' }]);
    assert.deepEqual(Object.keys(body.producciones).sort(), ['desde', 'hasta', 'visitas']);
    assert.equal(body.producciones.desde, query.desde); assert.equal(body.producciones.hasta, query.hasta);
    assert.deepEqual(body.producciones.visitas, [{ id: visitId, tarea_origen_id: null, cliente_id: client.id,
      cliente_nombre: 'QA117 report client', fecha: '2026-10-20', titulo: 'QA117 shared production', participante_ids: [],
      videos: [{ id: videoId, titulo: 'QA117 shared video', estado: 'planificado', tarea_edicion_id: null,
        tarea_estado: null, editor_actual_id: null, fecha_entrega_actual: null }],
      fotos: [{ id: photoId, tipo: 'QA117 shared photo', estado: 'realizada' }] }]);
    for (const privateValue of [marker, '817293.46', 'QA117 historical', 'QA117 render_os', 'QA117 name-only must not grant'])
      assert.equal(JSON.stringify(body).includes(privateValue), false);
    for (const search of ['mes_configuracion=0000-10', 'mes_configuracion=2026-1', 'mes_configuracion=2026-10%0A',
      'mes_configuracion=2026-10&mes_configuracion=2026-10', 'mes_configuracion[]=2026-10', 'unknown=1',
      'desde=2026-10-01', 'hasta=2026-10-31', 'desde=2026-02-30&hasta=2026-03-01',
      'desde=2026-10-02&hasta=2026-10-01', 'desde=2025-01-01&hasta=2026-10-01',
      'desde=2026-10-01&desde=2026-10-01&hasta=2026-10-31']) ok(await report(admin, search), 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('one real leased RR read-only client keeps task, assignments and evidence old-consistent during an external commit', async () => {
    let reached, release;
    const ready = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let paused = false;
    const wrappedPool = { connect: async () => {
      const db = await pool.connect();
      return { release: error => db.release(error), query: async (...args) => {
        const sql = typeof args[0] === 'string' ? args[0] : args[0].text;
        // Pause AFTER base task rows were observed, BEFORE queued annotation reads.
        const result = await db.query(...args);
        if (!paused && /FROM tareas t LEFT JOIN clientes/.test(sql)) {
          paused = true;
          const settings = (await db.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
          assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
          reached(); await gate;
        }
        return result;
      } };
    } };
    const pending = loadReportSnapshot(wrappedPool, { id: 91001, session_version: 1, rol: 'admin' }, query);
    try {
      await Promise.race([ready, pending.then(() => { throw Error('Barrier was not reached'); })]);
      const external = await pool.connect();
      try {
        await external.query('BEGIN');
        await external.query("UPDATE tareas SET estado='en_progreso' WHERE id=ANY($1::int[])", [tasks]);
        await external.query('DELETE FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[])', [tasks]);
        for (const id of tasks) await external.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91002,'responsable')", [id]);
        // Root tuple change invalidates current proof via the real 064 trigger.
        await external.query("UPDATE historias SET estado='lista',fecha_publicación_real=NULL WHERE id=$1", [pieceId]);
        await external.query('COMMIT');
      } catch (error) { await external.query('ROLLBACK'); throw error; }
      finally { external.release(); }
    } finally { release(); }
    const old = await pending;
    const oldTasks = [...old.tareas, ...old.tareasRenderOs].filter(row => tasks.includes(row.id));
    assert.equal(oldTasks.length, 2);
    for (const row of oldTasks) {
      assert.equal(row.estado, 'pendiente'); assert.ok(row.colaborador_ids.includes(actors[0].id));
      assert.notEqual(row.asignado_a_id, 91002);
    }
    assert.equal(old.historias.find(row => row.id === pieceId).publicacion_evidencia.classification, 'confirmada_manualmente');
    const fresh = ok(await report(admin));
    for (const id of tasks) {
      const row = [...fresh.tareas, ...fresh.tareasRenderOs].find(row => row.id === id);
      assert.equal(row.estado, 'en_progreso'); assert.equal(row.asignado_a_id, 91002); assert.deepEqual(row.colaborador_ids, []);
    }
    assert.equal(fresh.historias.find(row => row.id === pieceId).publicacion_evidencia.classification, 'no_publicada');
    assert.equal(fresh.publicaciones.find(row => row.id === pieceId).publicacion_evidencia.classification, 'confirmada_manualmente');
  });

  await t.test('current epoch/inactive/unsupported role before real lease deny; captured identity cannot be mutated while waiting', async () => {
    const actor = actors[0];
    for (const [change, status] of [["session_version=2", 401], ["activo=false", 401], ["rol='qa_unknown'", 401], ["rol='edicion'", 401]]) {
      await f.query("UPDATE usuarios SET activo=true,rol='diseno',session_version=1 WHERE id=$1", [actor.id]);
      let acquired, resume;
      const ready = new Promise(resolve => { acquired = resolve; });
      const gate = new Promise(resolve => { resume = resolve; });
      const observed = { id: actor.id, session_version: 1, rol: 'diseno' };
      const pending = loadReportSnapshot({ connect: async () => { acquired(); await gate; return pool.connect(); } }, observed, query);
      const checked = assert.rejects(pending, error => error.status === status);
      await ready;
      await f.query(`UPDATE usuarios SET ${change} WHERE id=$1`, [actor.id]);
      observed.id = 91001; observed.session_version = 2; observed.rol = 'admin';
      const before = await snapshot(); resume(); await checked;
      assert.deepEqual(await snapshot(), before);
    }
    await f.query("UPDATE usuarios SET activo=true,rol='diseno',session_version=1 WHERE id=$1", [actor.id]);
  });
});
