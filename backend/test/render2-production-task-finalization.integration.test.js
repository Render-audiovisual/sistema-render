import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('canonical production origin task closes explicitly from individual evidence while legacy readiness remains separate', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const port = 55932, f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Owned production task-finalization fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  // Copy only a known generated fixture credential; never inspect a real user.
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 91005,'qa_production_closer','QA315 Producer','produccion',password_hash,true,1 FROM usuarios WHERE id=91003`);
  const tokens = new Map();
  for (const [id, usuario] of [[91001, 'qa_franco'], [91004, 'qa_designer'], [91005, 'qa_production_closer']]) {
    const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(login.status, 200); assert.equal(login.body.usuario.id, id);
    assert.equal(typeof login.body.token, 'string'); tokens.set(id, login.body.token);
  }
  const api = (route, { actor = 91005, method = 'GET', body } = {}) => request(f.base, '/api' + route, {
    token: tokens.get(actor), method, body,
  });
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA315 finalization evidence',true) RETURNING id");
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
  const raw = async id => (await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [id]))[0].row;
  const finish = (id, revision, actor = 91005) => api(`/tareas/${id}?workspace=render_os`, {
    actor, method: 'PATCH', body: { estado: 'finalizada', expected_revision: revision },
  });
  let serial = 0;
  async function canonical({ planned = 3, states = [] } = {}) {
    const body = { request_id: randomUUID(), workspace: 'render_os', titulo: `QA315 Visita ${++serial}`,
      asignado_a_id: 91005, colaborador_ids: [], cliente_id: client.id, tipo_tarea: 'produccion',
      subtipo: 'visita', fecha_vencimiento: '2026-10-29', ...(planned === null ? {} : { produccion_videos_previstos: planned }) };
    const result = await api('/tareas', { method: 'POST', body });
    assert.equal(result.status, 201); assert.equal(result.body.version, 1);
    const task = result.body.task;
    assert.equal(task.asignado_a_id, 91005); assert.equal(task.revision, 1);
    let visit = (await f.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1', [task.id]))[0];
    assert.ok(visit); assert.equal(visit.revision, 1);
    for (const [index, estado] of states.entries()) {
      const added = await api(`/producciones/${visit.id}/videos`, { method: 'POST', body: {
        expected_revision: visit.revision, titulo: `QA315 video ${index + 1}`, estado, guion: '',
      } });
      assert.equal(added.status, 201); visit = added.body.visita;
    }
    return { task, visit };
  }
  async function assertClosedOnlyTask(id, before, result) {
    assert.equal(result.status, 200); assert.equal(result.body.id, id); assert.equal(result.body.estado, 'finalizada');
    assert.equal(result.body.revision, before.revision + 1);
    const after = await raw(id);
    assert.equal(after.estado, 'finalizada'); assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.propiedades_extra.produccion_registros, before.propiedades_extra.produccion_registros);
    for (const key of ['produccion_confirmada_at', 'produccion_confirmada_por', 'produccion_confirmada_por_id',
      'produccion_finalizada_at', 'produccion_registros'])
      assert.deepEqual(after.propiedades_extra[key], before.propiedades_extra[key], `Closing must not invent ${key}`);
    for (const field of Object.keys(before).filter(key => !['estado', 'revision', 'updated_at', 'propiedades_extra'].includes(key)))
      assert.deepEqual(after[field], before[field], `Unrelated task field ${field} must survive closing`);
  }

  await t.test('three recorded canonical videos permit assigned production role to close with no invented business', async () => {
    const { task, visit } = await canonical({ states: ['grabado', 'grabado', 'grabado'] });
    const beforeTask = await raw(task.id);
    const before = await snapshot(['tareas', 'mia_private_task_notifications']);
    const otherTasks = await f.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE id<>$1", [task.id]);
    await assertClosedOnlyTask(task.id, beforeTask, await finish(task.id, beforeTask.revision));
    assert.deepEqual(await snapshot(['tareas', 'mia_private_task_notifications']), before,
      'Closing cannot create editing/publications, alter media/visits, assignments or receipts');
    assert.deepEqual(await f.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE id<>$1", [task.id]), otherTasks);
    assert.equal((await f.query('SELECT revision FROM produccion_visitas WHERE id=$1', [visit.id]))[0].revision, visit.revision);
    assert.deepEqual((await raw(task.id)).propiedades_extra.produccion_registros, []);
    // Existing state notification enqueue is not a provider-delivery assertion.
  });

  for (const [name, states] of [['empty', []], ['planned', ['grabado', 'grabado', 'planificado']],
    ['pending', ['grabado', 'grabado', 'pendiente']], ['repeat', ['grabado', 'grabado', 'repetir']],
    ['deficit', ['grabado', 'grabado']]]) {
    await t.test(`${name} canonical evidence rejects400 with complete rollback including task revision`, async () => {
      const { task } = await canonical({ states });
      const before = await snapshot(), result = await finish(task.id, task.revision);
      assert.equal(result.status, 400); assert.deepEqual(Object.keys(result.body), ['error']);
      assert.deepEqual(await snapshot(), before);
    });
  }

  await t.test('photos never substitute for videos or satisfy planned count', async () => {
    const { task, visit } = await canonical();
    const photo = await api(`/producciones/${visit.id}/fotos`, { method: 'POST', body: {
      expected_revision: visit.revision, tipo: 'QA315 photo only', estado: 'realizada',
    } });
    assert.equal(photo.status, 201);
    const before = await snapshot(); assert.equal((await finish(task.id, task.revision)).status, 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('stale task CAS and nonmember authority cannot close even complete canonical evidence', async () => {
    const { task } = await canonical({ states: ['grabado', 'grabado', 'grabado'] });
    const [changed] = await f.query("UPDATE tareas SET aclaraciones='QA315 concurrent note' WHERE id=$1 RETURNING revision", [task.id]);
    const before = await snapshot();
    assert.equal((await finish(task.id, task.revision)).status, 409);
    const denied = await finish(task.id, changed.revision, 91004);
    assert.ok([403, 404].includes(denied.status));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('without a planned quantity at least one recorded video is still required', async () => {
    const empty = await canonical({ planned: null }), before = await snapshot();
    assert.equal((await finish(empty.task.id, empty.task.revision)).status, 400);
    assert.deepEqual(await snapshot(), before);
    const ready = await canonical({ planned: null, states: ['grabado'] });
    const original = await raw(ready.task.id);
    await assertClosedOnlyTask(ready.task.id, original, await finish(ready.task.id, original.revision));
  });

  await t.test('genuine unbound historical visits preserve aggregate completeness rather than requiring canonical media', async () => {
    const seed = async complete => {
      const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
        VALUES($1,'QA315 Producer',$2,'pendiente','produccion','visita','2026-10-29',$3::jsonb) RETURNING id,revision`,
      [`QA315 Visita histórica ${complete ? 'completa' : 'incompleta'}`, client.id, JSON.stringify({ workspace: 'render_os',
        produccion_videos_previstos: 3, produccion_registros: complete ? [{ id: randomUUID(), cantidad: 3, fecha: '2026-10-29', usuario_id: 91005 }] : [] })]);
      await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91005,'responsable')", [row.id]);
      assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [row.id]), []);
      return row;
    };
    const incomplete = await seed(false), beforeDenied = await snapshot();
    assert.equal((await finish(incomplete.id, incomplete.revision)).status, 400);
    assert.deepEqual(await snapshot(), beforeDenied);
    const reclassified = await api(`/tareas/${incomplete.id}?workspace=render_os`, {
      actor: 91001, method: 'PATCH', body: { expected_revision: incomplete.revision,
        estado: 'finalizada', titulo: 'QA315 coordinación general', subtipo: null },
    });
    assert.equal(reclassified.status, 400, 'Renaming an incomplete original visit cannot erase its closing precondition');
    assert.deepEqual(await snapshot(), beforeDenied, 'Rejected reclassification must roll back title, subtype, state and revision');
    const complete = await seed(true), original = await raw(complete.id);
    const before = await snapshot(['tareas', 'mia_private_task_notifications']);
    await assertClosedOnlyTask(complete.id, original, await finish(complete.id, complete.revision));
    assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [complete.id]), []);
    assert.deepEqual(await snapshot(['tareas', 'mia_private_task_notifications']), before);
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
  });

  await t.test('lowering planned quantity in the same closing PATCH cannot complete insufficient legacy evidence', async () => {
    const [historical] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
      VALUES('QA315 Visita histórica con déficit','QA315 Producer',$1,'en_progreso','produccion','visita','2026-10-29',$2::jsonb)
      RETURNING id,revision`, [client.id, JSON.stringify({ workspace: 'render_os',
      produccion_videos_previstos: 3, produccion_registros: [{ id: randomUUID(), cantidad: 1, fecha: '2026-10-29', usuario_id: 91005 }] })]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91005,'responsable')", [historical.id]);
    assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [historical.id]), []);
    const before = await snapshot();
    const result = await api(`/tareas/${historical.id}?workspace=render_os`, {
      actor: 91001, method: 'PATCH', body: { expected_revision: historical.revision,
        estado: 'finalizada', propiedades_extra: { produccion_videos_previstos: 1 } },
    });
    assert.equal(result.status, 400, 'Closing must retain the observed planned3 precondition, not the proposed planned1');
    assert.deepEqual(await snapshot(), before, 'Rejected closing must preserve planned quantity, record and task revision');
  });
});
