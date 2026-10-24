import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';

test('comment notification recipients use assignment IDs, never homonyms or leader aliases', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55866 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), e => e.code === 'ENOENT'); t.diagnostic(`QA218 cleanup ENOENT ${f.root}`); });
  const [identity] = await f.query("SELECT current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory");
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55866, url: 'postgresql://render2_fixture@127.0.0.1:55866/render2_local_test', identity });
  // Deliberately ambiguous display names, plus an active legacy alias witness.
  // Only fixture users are changed; no existing account or credential is read.
  await f.query("UPDATE usuarios SET nombre='Agustín' WHERE id IN (91001,91002,91003,91004)");
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 91005,'lider','Cuenta legado','admin',password_hash,true,1 FROM usuarios WHERE id=91001`);
  const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } });
  assert.equal(login.status, 200); const token = login.body.token;
  const api = (path, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const createTask = async () => {
    const r = await api('/tareas', 'POST', { titulo: 'QA218 recipient identity', workspace: 'render_os', tipo_tarea: 'edicion', asignado_a_id: 91003, colaborador_ids: [91004, 91001] });
    assert.equal(r.status, 201); return r.body.id;
  };
  const notices = id => f.query(`SELECT destinatario,destinatario_clave,detalles,motivo FROM mia_private_task_notifications
    WHERE tarea_id=$1 AND motivo IN ('comentario','bloqueada') ORDER BY id`, [id]);
  async function observed(id, count) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const rows = await notices(id);
      if (rows.length >= count) { assert.equal(rows.length, count); return rows; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Expected local comment notification was not enqueued');
  }
  async function remains(id, expected) {
    const until = Date.now() + 300;
    do {
      assert.deepEqual(await notices(id), expected);
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < until);
    assert.deepEqual(await notices(id), expected);
  }
  async function post(id, contenido, requestId = randomUUID(), autor = 'Agustín') {
    const r = await api(`/tareas/${id}/comentarios?workspace=render_os`, 'POST', { autor, contenido, request_id: requestId });
    assert.ok([200, 201].includes(r.status));
    assert.deepEqual(Object.keys(r.body).sort(), ['id','tarea_id','autor','contenido','created_at','creation_request_id'].sort(), 'Internal recipient context never enters HTTP DTO');
    return { response: r, requestId };
  }
  const task = await createTask();
  await t.test('homonyms and Agustín alias still reach two exact assignees, excluding actor ID', async () => {
    const sent = await post(task, 'QA218 first shared comment'); assert.equal(sent.response.status, 201);
    const rows = await observed(task, 2);
    assert.deepEqual(rows.map(r => r.detalles.destinatario_usuario_id).sort(), [91003, 91004]);
    assert.ok(rows.every(r => r.detalles.actor_usuario_id === 91001 && r.detalles.actor === 'Agustín'));
    assert.ok(rows.every(r => r.destinatario_clave !== 'lider' && r.destinatario_clave !== 'qa_franco'));
    const recovered = await api(`/tareas/${task}/comentarios/solicitudes/${sent.requestId}?workspace=render_os`);
    assert.equal(recovered.status, 200); assert.deepEqual(recovered.body, sent.response.body);
    const replay = await post(task, 'QA218 first shared comment', sent.requestId);
    assert.equal(replay.response.status, 200); assert.deepEqual(replay.response.body, sent.response.body);
    await remains(task, rows);
  });
  await t.test('rename follows the same ID and free admin author cannot impersonate notification actor', async () => {
    await f.query("UPDATE usuarios SET nombre='Luciano renombrado' WHERE id=91003");
    await post(task, 'QA218 second comment', undefined, 'Nombre libre del comentario');
    const rows = (await observed(task, 4)).slice(2);
    assert.deepEqual(rows.map(r => r.detalles.destinatario_usuario_id).sort(), [91003, 91004]);
    assert.equal(rows.find(r => r.detalles.destinatario_usuario_id === 91003).destinatario, 'Luciano renombrado');
    assert.ok(rows.every(r => r.detalles.actor_usuario_id === 91001 && r.detalles.actor === 'Agustín'));
  });
  await t.test('inactive assignee is not selected and activity creates no comment notification', async () => {
    await f.query('UPDATE usuarios SET activo=false WHERE id=91004');
    await post(task, 'QA218 third comment');
    const rows = await observed(task, 5);
    assert.equal(rows.at(-1).detalles.destinatario_usuario_id, 91003);
    await post(task, '[Actividad] QA218 no notification');
    await remains(task, rows);
  });
  await t.test('unmapped task never falls back to legacy display labels', async () => {
    await f.query('UPDATE usuarios SET activo=true WHERE id=91004');
    const id = await createTask();
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1', [id]);
    await post(id, 'QA218 no mapped recipients');
    await remains(id, []);
    const [{ count }] = await f.query('SELECT count(*)::int AS count FROM tarea_comentarios WHERE tarea_id=$1', [id]);
    assert.equal(count, 1);
  });
  const all = await f.query("SELECT detalles FROM mia_private_task_notifications WHERE motivo IN ('comentario','bloqueada') ORDER BY id");
  assert.equal(all.length, 5);
  assert.ok(all.every(row => row.detalles.actor_usuario_id === 91001 && [91003,91004].includes(row.detalles.destinatario_usuario_id)));
});
