import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';

const PORT = 55843;
const PRODUCER = 91005;
const invariantTables = [
  'tarea_asignaciones', 'produccion_videos', 'produccion_fotos', 'produccion_visita_participantes',
  'publicaciones', 'historias', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos',
  'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
  'task_editing_deliveries', 'task_editing_reviews',
];
const without = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));

test('production source reschedule: current producer moves visit/origin only, keeping two editing identities and history intact', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: PORT });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production reschedule fixture stopped and removed: ${f.root}`);
  });
  const [identity] = await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: PORT,
    url: `postgresql://render2_fixture@127.0.0.1:${PORT}/render2_local_test`, identity });
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,'qa_reschedule_producer','QA Reschedule Producer','produccion',password_hash,true,1
    FROM usuarios WHERE id=91004`, [PRODUCER]);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA183 source reschedule client',true) RETURNING id");
  const [dates] = await f.query(`SELECT to_char(current_date,'YYYY-MM-DD') today,
    to_char(current_date,'YYYY-MM') old_month,
    to_char(date_trunc('month',current_date)+interval '1 month','YYYY-MM') new_month`);
  const newDate = `${dates.new_month}-03`;
  const ok = (result, status = 200) => {
    assert.equal(result.status, status, `Unexpected HTTP status ${result.status}`);
    return result.body;
  };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const login = async usuario => {
    const result = ok(await api('/login', undefined, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const owner = await login('qa_franco');
  const producer = await login('qa_reschedule_producer');
  const baseline = {};
  for (const table of invariantTables) baseline[table] = await f.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`);

  // Only setup accounts/client use SQL. All operational entities use real HTTP.
  const source = ok(await api('/tareas', owner, 'POST', {
    titulo: 'QA183 source reschedule visit', workspace: 'render_os', cliente_id: client.id,
    tipo_tarea: 'produccion', subtipo: 'visita', fecha_vencimiento: dates.today,
    asignado_a_id: PRODUCER, colaborador_ids: [], produccion_videos_previstos: 2,
  }), 201);
  assert.ok(Number.isSafeInteger(source.id) && source.id > 0);
  const registered = await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [source.id]);
  assert.equal(registered.length, 1);
  const visitId = registered[0].id;
  const readVisit = async (token = owner) => ok(await api(`/producciones/${visitId}`, token)).visita;
  let visit = await readVisit();
  assert.equal(visit.tarea_origen_id, source.id); assert.equal(visit.fecha, dates.today);
  assert.deepEqual(visit.videos, []); assert.deepEqual(visit.fotos, []);
  visit = ok(await api(`/producciones/${visitId}`, owner, 'PATCH', {
    expected_revision: visit.revision, drive_url: 'https://example.invalid/qa183-material',
  })).visita;
  for (let n = 1; n <= 2; n++) {
    visit = ok(await api(`/producciones/${visitId}/videos`, owner, 'POST', {
      expected_revision: visit.revision, titulo: `QA183 video ${n}`, guion: `QA183 original script ${n}`,
      estado: 'grabado', observaciones: `QA183 video observation ${n}`,
    }), 201).visita;
  }
  visit = ok(await api(`/producciones/${visitId}/fotos`, owner, 'POST', {
    expected_revision: visit.revision, tipo: 'QA183 product photos', estado: 'realizada',
    drive_url: 'https://example.invalid/qa183-photos', observaciones: 'QA183 original lighting observation',
  }), 201).visita;
  assert.equal(visit.videos.length, 2); assert.equal(visit.fotos.length, 1);
  const videos = [...visit.videos].sort((a, b) => a.titulo.localeCompare(b.titulo));
  const attempts = [];
  for (let n = 0; n < videos.length; n++) {
    visit = await readVisit();
    const body = { expected_revision: visit.revision, editor_id: n === 0 ? 91003 : 91001,
      fecha_entrega: `${dates.new_month}-${n === 0 ? '06' : '07'}` };
    const saved = ok(await api(`/producciones/${visitId}/videos/${videos[n].id}/enviar-edicion`, owner, 'POST', body), 201);
    assert.ok(Number.isSafeInteger(saved.task.id));
    attempts.push({ videoId: videos[n].id, taskId: saved.task.id, body });
    const [assigned] = await f.query("SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1 AND tipo='responsable'", [saved.task.id]);
    assert.equal(assigned.usuario_id, body.editor_id);
  }
  assert.equal(new Set(attempts.map(a => a.taskId)).size, 2);
  assert.ok(!attempts.some(a => a.taskId === source.id));
  visit = await readVisit();
  for (const attempt of attempts) {
    const video = visit.videos.find(v => v.id === attempt.videoId);
    assert.equal(video.tarea_edicion_id, attempt.taskId);
    assert.equal(video.editor_id, attempt.body.editor_id);
    assert.equal(video.fecha_entrega, attempt.body.fecha_entrega);
  }
  const snapshot = async () => {
    const result = {};
    for (const table of invariantTables) result[table] = await f.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    result.otherTasks = await f.query('SELECT to_jsonb(t) row FROM tareas t WHERE id<>$1 ORDER BY to_jsonb(t)::text', [source.id]);
    result.otherVisits = await f.query('SELECT to_jsonb(v) row FROM produccion_visitas v WHERE id<>$1 ORDER BY to_jsonb(v)::text', [visitId]);
    return result;
  };
  const sourceRow = async () => (await f.query('SELECT to_jsonb(t) row FROM tareas t WHERE id=$1', [source.id]))[0].row;
  const visitRow = async () => (await f.query('SELECT to_jsonb(v) row FROM produccion_visitas v WHERE id=$1', [visitId]))[0].row;
  const fullObservation = async () => ({ stable: await snapshot(), source: await sourceRow(), visit: await visitRow() });
  const before = await fullObservation();
  assert.equal(before.stable.otherTasks.length, 2, 'Exactly two editing tasks, not duplicate handoffs');
  for (const table of ['publicaciones', 'historias', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'task_editing_deliveries', 'task_editing_reviews']) {
    assert.deepEqual(before.stable[table], baseline[table], `Setup must not invent ${table}`);
  }

  await t.test('producer PATCH changes only visit date/audit and source due date/revision, preserving all other rows', async () => {
    const result = ok(await api(`/producciones/${visitId}`, producer, 'PATCH', {
      expected_revision: visit.revision, fecha: newDate,
    }));
    assert.equal(result.visita.id, visitId); assert.equal(result.visita.fecha, newDate);
    assert.equal(result.visita.tarea_origen_id, source.id); assert.equal(result.visita.revision, visit.revision + 1);
    const after = await fullObservation();
    assert.deepEqual(after.stable, before.stable);
    assert.equal(after.source.fecha_vencimiento, newDate);
    assert.equal(after.source.revision, before.source.revision + 1);
    assert.deepEqual(without(after.source, ['fecha_vencimiento', 'revision', 'updated_at']), without(before.source, ['fecha_vencimiento', 'revision', 'updated_at']));
    assert.equal(after.visit.revision, before.visit.revision + 1); assert.equal(after.visit.fecha, newDate);
    assert.equal(after.visit.actualizado_por_id, PRODUCER);
    assert.deepEqual(without(after.visit, ['fecha', 'revision', 'updated_at', 'actualizado_por_id']), without(before.visit, ['fecha', 'revision', 'updated_at', 'actualizado_por_id']));
  });
  await t.test('old visit CAS conflicts with no domain, assignment or evidence changes', async () => {
    const saved = await fullObservation();
    assert.equal((await api(`/producciones/${visitId}`, producer, 'PATCH', {
      expected_revision: visit.revision, fecha: dates.today,
    })).status, 409);
    assert.deepEqual(await fullObservation(), saved);
  });
  await t.test('fresh producer login lists the same visit only in the new month and re-reads original editing IDs', async () => {
    const fresh = await login('qa_reschedule_producer');
    for (const [month, present] of [[dates.old_month, false], [dates.new_month, true]]) {
      const listed = ok(await api(`/producciones?mes=${month}`, fresh));
      assert.equal(listed.visitas.some(v => v.id === visitId), present);
    }
    const current = await readVisit(fresh); assert.equal(current.fecha, newDate);
    assert.deepEqual(current.videos.map(v => v.id).sort(), videos.map(v => v.id).sort());
    assert.deepEqual(current.videos.map(v => v.tarea_edicion_id).sort((a,b) => a-b), attempts.map(a => a.taskId).sort((a,b) => a-b));
    assert.deepEqual(await snapshot(), before.stable);
  });
  await t.test('owner replays original handoff bodies, including old visit observations, returning same tasks with no DML', async () => {
    const saved = await fullObservation();
    for (const attempt of attempts) {
      const replay = ok(await api(`/producciones/${visitId}/videos/${attempt.videoId}/enviar-edicion`, owner, 'POST', attempt.body));
      assert.equal(replay.task.id, attempt.taskId);
      assert.equal(replay.task.fecha_vencimiento, attempt.body.fecha_entrega);
      assert.equal(replay.visita.fecha, newDate);
    }
    assert.deepEqual(await fullObservation(), saved);
  });
});
