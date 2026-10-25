import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('empty canonical origin visit fences aggregate writers while individual video and unbound history remain usable', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55929, f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Owned empty-registry boundary fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const login = await request(f.base, '/api/login', { method: 'POST',
    body: { usuario: 'qa_franco', password: fixturePassword } });
  assert.equal(login.status, 200); assert.equal(login.body.usuario.id, 91001);
  assert.equal(typeof login.body.token, 'string');
  const api = (route, method = 'GET', body) => request(f.base, '/api' + route, { token: login.body.token, method, body });
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA312 canonical boundary',true) RETURNING id");
  const requestId = randomUUID();
  const created = await api('/tareas', 'POST', { request_id: requestId, workspace: 'render_os',
    titulo: 'QA312 Visita canónica vacía', asignado_a_id: 91001, colaborador_ids: [],
    cliente_id: client.id, tipo_tarea: 'produccion', fecha_vencimiento: '2026-10-29', produccion_videos_previstos: 3 });
  assert.equal(created.status, 201); assert.equal(created.body.version, 1);
  const task = created.body.task;
  assert.ok(Number.isSafeInteger(task?.id)); assert.equal(task.revision, 1);
  assert.deepEqual(created.body.operation, { request_id: requestId, task_id: task.id, replayed: false });
  const [visit] = await f.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1', [task.id]);
  assert.ok(visit); assert.equal(visit.revision, 1);
  assert.deepEqual(await f.query('SELECT id FROM produccion_videos WHERE visita_id=$1', [visit.id]), []);
  assert.deepEqual(await f.query('SELECT id FROM produccion_fotos WHERE visita_id=$1', [visit.id]), []);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded = []) {
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  const aggregate = `/tareas/${task.id}/produccion`;
  const expectedError = { error: 'Esta visita se registra por video en Producciones. Continuá allí para no duplicar el contenido.' };

  await t.test('reporting still says zero media, but every valid aggregate writer rejects409 with zero DML', async () => {
    const before = await snapshot();
    const context = await api(`/producciones/tareas/${task.id}`);
    assert.equal(context.status, 200); assert.equal(context.body.vinculo.id, visit.id);
    assert.equal(context.body.vinculo.tipo, 'origen');
    assert.equal(context.body.vinculo.videos_total, 0); assert.equal(context.body.vinculo.fotos_total, 0);
    assert.equal(context.body.vinculo.usa_registro_individual, false, 'Media flag is not a routing-authority flag');
    const cases = [
      ['/registros', 'POST', { expected_revision: 1, cantidad: 1, fecha: '2026-10-29' }],
      ['/registros', 'POST', { expected_revision: 1, cantidad: 3, fecha: '2026-10-29', finalizar: true }],
      [`/registros/${randomUUID()}`, 'PATCH', { expected_revision: 1, cantidad: 2 }],
      ['/confirmar', 'POST', { expected_revision: 1 }],
    ];
    for (const [suffix, method, body] of cases) {
      const result = await api(aggregate + suffix + '?workspace=render_os', method, body);
      assert.equal(result.status, 409, `${method} ${suffix} must reach canonical binding boundary`);
      assert.deepEqual(result.body, expectedError);
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('precondition validation still rejects malformed aggregate requests without writes', async () => {
    const before = await snapshot();
    for (const [suffix, method, body] of [
      ['/registros', 'POST', { cantidad: 1, fecha: '2026-10-29' }],
      ['/registros', 'POST', { expected_revision: 1, cantidad: -1, fecha: '2026-10-29' }],
      [`/registros/${randomUUID()}`, 'PATCH', { expected_revision: 1, cantidad: 0 }],
      ['/confirmar', 'POST', {}],
    ]) assert.equal((await api(aggregate + suffix + '?workspace=render_os', method, body)).status, 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('first individual video and aggregate write cannot create mixed progress under concurrent requests',async()=>{
    const created=await api('/tareas','POST',{request_id:randomUUID(),workspace:'render_os',titulo:'QA312 Visita concurrente',
      asignado_a_id:91001,colaborador_ids:[],cliente_id:client.id,tipo_tarea:'produccion',fecha_vencimiento:'2026-10-29'});
    assert.equal(created.status,201);
    const source=created.body.task;
    const [own]=await f.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1',[source.id]);
    const before=await snapshot(['produccion_videos','produccion_visitas']);
    const [individual,aggregate]=await Promise.all([
      api(`/producciones/${own.id}/videos`,'POST',{expected_revision:own.revision,titulo:'QA312 primero',guion:'',estado:'pendiente'}),
      api(`/tareas/${source.id}/produccion/registros?workspace=render_os`,'POST',{expected_revision:source.revision,cantidad:1,fecha:'2026-10-29'}),
    ]);
    assert.equal(individual.status,201);assert.equal(aggregate.status,409);assert.deepEqual(aggregate.body,expectedError);
    assert.equal((await f.query('SELECT id FROM produccion_videos WHERE visita_id=$1',[own.id])).length,1);
    assert.deepEqual(await snapshot(['produccion_videos','produccion_visitas']),before);
  });

  await t.test('individual video creation remains available without recording aggregate task progress', async () => {
    const before = await snapshot(['produccion_videos', 'produccion_visitas']);
    const [originalTask] = await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [task.id]);
    const result = await api(`/producciones/${visit.id}/videos`, 'POST', {
      expected_revision: 1, titulo: 'QA312 video individual', guion: '', estado: 'pendiente',
    });
    assert.equal(result.status, 201); assert.equal(result.body.visita.id, visit.id);
    assert.equal(result.body.visita.revision, 2); assert.equal(result.body.visita.videos.length, 1);
    assert.equal(result.body.visita.videos[0].titulo, 'QA312 video individual');
    assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [task.id]), [originalTask]);
    assert.deepEqual(await snapshot(['produccion_videos', 'produccion_visitas']), before);
    const rows = await f.query('SELECT id FROM produccion_videos WHERE visita_id=$1', [visit.id]);
    assert.equal(rows.length, 1);
  });

  await t.test('genuine historical task without origin binding retains aggregate recording and correction', async () => {
    const [historical] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,fecha_vencimiento,propiedades_extra)
      VALUES('QA312 Visita histórica sin vínculo','Franco QA',$1,'pendiente','produccion','2026-10-29',
        '{"workspace":"render_os","produccion_videos_previstos":3,"produccion_registros":[]}'::jsonb)
      RETURNING id,revision`, [client.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'responsable')", [historical.id]);
    const before = await snapshot(['tareas']);
    const otherTasks = await f.query('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,\'[]\')) AS hash FROM tareas t WHERE id<>$1', [historical.id]);
    const route = `/tareas/${historical.id}/produccion`;
    const registered = await api(route + '/registros?workspace=render_os', 'POST', {
      expected_revision: historical.revision, cantidad: 1, fecha: '2026-10-29',
    });
    assert.equal(registered.status, 201); assert.equal(registered.body.estado, 'en_progreso');
    assert.equal(registered.body.revision, historical.revision + 1);
    const records = registered.body.propiedades_extra.produccion_registros;
    assert.equal(records.length, 1); assert.equal(records[0].cantidad, 1); assert.equal(records[0].usuario_id, 91001);
    const corrected = await api(route + `/registros/${records[0].id}?workspace=render_os`, 'PATCH', {
      expected_revision: registered.body.revision, cantidad: 2,
    });
    assert.equal(corrected.status, 200); assert.equal(corrected.body.estado, 'en_progreso');
    assert.equal(corrected.body.revision, historical.revision + 2);
    assert.equal(corrected.body.propiedades_extra.produccion_registros.length, 1);
    assert.equal(corrected.body.propiedades_extra.produccion_registros[0].cantidad, 2);
    assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [historical.id]), []);
    assert.deepEqual(await snapshot(['tareas']), before);
    assert.deepEqual(await f.query('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,\'[]\')) AS hash FROM tareas t WHERE id<>$1', [historical.id]), otherTasks);
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
  });
});
