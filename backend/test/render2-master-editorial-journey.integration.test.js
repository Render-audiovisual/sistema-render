import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('master C: HTTP agreement, quota, production, exact review and independent actual publication', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55756 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Master C disposable fixture removed: ${f.root}; port55756`);
  });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
  };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  let owner = await login('qa_franco'), editor = await login('qa_luciano');
  const period = '2026-10', scheduled = '2026-10-29', visitDate = '2026-10-20';
  const client = ok(await api('/clientes', owner, 'POST', { nombre: 'QA113 master editorial HTTP journey' }), 201);
  const catalog = ok(await api(`/clientes?periodo=${period}`, owner));
  const observedClient = catalog.find(row => row.id === client.id); assert.ok(observedClient);
  ok(await api(`/clientes/${client.id}/configuraciones`, owner, 'POST', {
    nombre: observedClient.nombre, rubro: 'Servicios', vigente_desde: period,
    cuota_reels: 1, cuota_carruseles: 0, dias_historias: [1], dias_reels: [2], dias_carruseles: [3],
    disenador_responsable: 'Augusto', abono_mensual: 12345.67, expected_revision: observedClient.agreement_revision,
  }));
  const goal = async (token = owner) => {
    const data = ok(await api(`/cliente-objetivos?periodo=${period}`, token));
    const row = data.clientes.find(item => item.clave === `cliente-${client.id}`); assert.ok(row); return row;
  };
  const preparation = row => ({ periodo: period, clave: row.clave, responsables: [91003],
    responsables_por_formato: { video: [91003], carrusel: [91003] }, expected_preparation_revision: row.preparacion_revision });
  const unprepared = await goal(); assert.equal(unprepared.preparado, false); assert.deepEqual(unprepared.piezas, []);
  const prepared = ok(await api('/cliente-objetivos/preparar', owner, 'POST', preparation(unprepared)));
  assert.equal(prepared.creadas, 1);
  const initialGoal = await goal(); assert.equal(initialGoal.piezas.length, 1);
  const slot = initialGoal.piezas[0], taskId = slot.tarea_id;
  assert.equal(slot.en_cuota, true); assert.ok(Number.isSafeInteger(taskId));
  const task = async (token = editor) => ok(await api(`/tareas/${taskId}?workspace=render_os`, token));
  let current = await task(); assert.equal(current.asignado_a_id, 91003);
  ok(await api(`/cliente-objetivos/piezas/${slot.id}/contenido`, editor, 'PATCH', {
    expected_revision: current.revision, expected_updated_at: current.updated_at,
    titulo: 'QA113 canonical planned video', copy: 'QA113 intentional editorial copy',
  }));
  let visit = ok(await api('/producciones', owner, 'POST', {
    cliente_id: client.id, fecha: visitDate, titulo: 'QA113 actual filming visit', participante_ids: [91003],
  }), 201).visita;
  visit = ok(await api(`/producciones/${visit.id}/videos`, owner, 'POST', {
    expected_revision: visit.revision, titulo: 'QA113 recorded video', guion: 'Filming script is not editorial copy',
    estado: 'grabado', material_url: 'https://example.invalid/qa113-original-material',
  }), 201).visita;
  assert.equal(visit.videos.length, 1);
  const visitId = visit.id, videoId = visit.videos[0].id;
  const videoPath = `/producciones/${visitId}/videos/${videoId}`;
  const readVisit = async (token = owner) => ok(await api(`/producciones/${visitId}`, token)).visita;
  const candidates = ok(await api(`${videoPath}/vinculo?periodo=${period}`, owner));
  const candidate = candidates.casilleros.find(row => row.objetivo_pieza_id === slot.id); assert.ok(candidate);
  assert.equal(candidate.tarea_id, taskId);
  // Scheduling is explicit in this supported association operation, not inferred
  // from task completion. No operational entities or connections are SQL-seeded.
  const association = { expected_revision: visit.revision, tarea_id: taskId,
    expected_tarea_revision: candidate.tarea_revision, objetivo_pieza_id: slot.id,
    expected_objetivo_updated_at: candidate.objetivo_updated_at, fecha_programada: scheduled };
  const linked = ok(await api(`${videoPath}/vincular-objetivo`, owner, 'POST', association), 201);
  const pieceId = linked.publicacion_id;
  assert.equal(linked.tarea_id, taskId); assert.equal(linked.objetivo_pieza_id, slot.id); assert.equal(linked.created, true);
  const repeated = ok(await api(`${videoPath}/vincular-objetivo`, owner, 'POST', association));
  assert.equal(repeated.publicacion_id, pieceId); assert.equal(repeated.tarea_id, taskId); assert.equal(repeated.created, false);
  const handed = ok(await api(`${videoPath}/enviar-edicion`, owner, 'POST', {
    expected_revision: (await readVisit()).revision, editor_id: 91003, fecha_entrega: '2026-10-25',
  }), 201);
  // This flag describes the new handoff; identity/count assertions below prove
  // it adopted the already prepared canonical task rather than duplicating it.
  assert.equal(handed.created, true); assert.equal(handed.task.id, taskId);
  const publicationPath = `/editorial-publicacion/publicacion/${pieceId}`;
  const publication = async (token = owner) => ok(await api(publicationPath, token));
  const assertUnpublished = async () => {
    const data = await publication(); assert.equal(data.piece.fecha_programada, scheduled);
    assert.equal(data.piece.fecha_publicacion_real, null); assert.equal(data.current_confirmation, null);
    assert.equal(data.classification, 'no_publicada'); return data;
  };
  await assertUnpublished();
  const patchState = async (estado, token, extra = {}) => ok(await api(`/tareas/${taskId}?workspace=render_os`, token, 'PATCH', {
    expected_revision: (await task(token)).revision, estado, ...extra,
  }));
  await patchState('en_progreso', editor);
  const deliver = async version => {
    const result = ok(await api(`/tareas-edicion/${taskId}/entregas`, editor, 'POST', {
      request_id: randomUUID(), expected_revision: (await task()).revision,
      url: `https://example.invalid/qa113-edit-v${version}`, notes: `Actual version ${version}`,
    }), 201);
    const artifact = result.deliveries.find(row => row.id === result.delivery_id); assert.ok(artifact);
    assert.equal(artifact.task_id, taskId); assert.equal(artifact.actor_id, 91003); return result.delivery_id;
  };
  const first = await deliver(1);
  ok(await api(`/tareas-edicion/${taskId}/correcciones`, owner, 'POST', {
    request_id: randomUUID(), expected_revision: (await task()).revision,
    expected_entrega_id: first, notes: 'QA113 correct only the ending of the first artifact',
  }), 201);
  const second = await deliver(2); assert.notEqual(first, second);
  ok(await api(`/tareas/${taskId}?workspace=render_os`, owner, 'PATCH', {
    expected_revision: (await task()).revision, estado: 'aprobada', expected_entrega_id: first,
  }), 409);
  await patchState('aprobada', owner, { expected_entrega_id: second });
  await assertUnpublished();
  await patchState('finalizada', owner);
  const beforeConfirmation = await assertUnpublished();
  // Only read the real fixture clock; no fabricated publication evidence.
  const [{ instant }] = await f.query("SELECT to_char((clock_timestamp() - interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS instant");
  const intent = { request_id: randomUUID(), expected_revision: beforeConfirmation.piece.revision, occurred_at: instant };
  const confirmed = ok(await api(`${publicationPath}/confirmar`, owner, 'POST', intent), 201);
  assert.equal(confirmed.classification, 'confirmada_manualmente'); assert.equal(confirmed.current_confirmation.source, 'manual');
  assert.equal(confirmed.current_confirmation.actor_id, 91001); assert.equal(confirmed.piece.estado, 'publicada');
  assert.equal(confirmed.piece.fecha_programada, scheduled); assert.equal(confirmed.piece.fecha_publicacion_real, instant);
  assert.notEqual(instant.slice(0, 10), scheduled);
  assert.equal(ok(await api(`${publicationPath}/confirmar`, owner, 'POST', intent)).replayed, true);
  owner = await login('qa_franco'); editor = await login('qa_luciano');
  for (const token of [owner, editor]) {
    const persistedGoal = await goal(token); assert.equal(persistedGoal.piezas.length, 1);
    assert.equal(persistedGoal.piezas[0].id, slot.id); assert.equal(persistedGoal.piezas[0].tarea_id, taskId);
    assert.equal(persistedGoal.piezas[0].publicacion_id, pieceId); assert.equal(persistedGoal.piezas[0].en_cuota, true);
    const savedTask = await task(token); assert.equal(savedTask.estado, 'finalizada'); assert.equal(savedTask.publicacion_id, pieceId);
    const savedVideo = (await readVisit(token)).videos.find(row => row.id === videoId); assert.ok(savedVideo);
    assert.equal(savedVideo.tarea_edicion_id, taskId); assert.equal(savedVideo.publicacion_id, pieceId);
    const persisted = await publication(token); assert.deepEqual(persisted.piece, confirmed.piece);
    assert.deepEqual(persisted.current_confirmation, confirmed.current_confirmation);
    const history = ok(await api(`/tareas-edicion/${taskId}/revisiones`, token));
    assert.deepEqual(history.decisions.map(row => [row.action, row.delivery_id]), [['correcciones', first], ['aprobada', second]]);
  }
  const refreshed = ok(await api('/cliente-objetivos/preparar', owner, 'POST', preparation(await goal())));
  assert.equal(refreshed.creadas, 0); assert.equal((await goal()).piezas.length, 1);
  const [counts] = await f.query(`SELECT
    (SELECT count(*)::int FROM tareas WHERE cliente_id=$1) tasks,
    (SELECT count(*)::int FROM publicaciones WHERE cliente_id=$1) publications,
    (SELECT count(*)::int FROM editorial_publicacion_eventos WHERE dominio='publicacion' AND pieza_id=$2) events`, [client.id, pieceId]);
  assert.deepEqual(counts, { tasks: 1, publications: 1, events: 1 });
  const [storedPiece] = await f.query('SELECT copy FROM publicaciones WHERE id=$1 AND cliente_id=$2', [pieceId, client.id]);
  assert.equal(storedPiece.copy, 'QA113 intentional editorial copy');
});
