import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const one = (rows, predicate) => {
  const matches = rows.filter(predicate);
  assert.equal(matches.length, 1, 'Expected exactly one canonical identity');
  return matches[0];
};
const checked = (response, status = 200) => {
  assert.equal(response.status, status, 'Unexpected principal HTTP status (response body intentionally omitted)');
  return response.body;
};
const noFinance = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /abono|importe|salario|sueldo|financial|finance|password|token|agreement_revision/i);
    noFinance(child);
  }
  assert.ok(!JSON.stringify(value).includes('817293.46'), 'Synthetic agreement amount must not enter an operational DTO');
};

// A single physical journey, not independently seeded feature demonstrations.
// SQL is restricted to fixture identity/clock and persisted verification; every
// client, agreement, slot, task, video, association and evidence uses real HTTP.
test('cookie: one agreement → three goal tasks → one three-video visit → exact reviews → explicit publication', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const f = await startLocalHarness({ port: 55816, browserSessions: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Unified three-video fixture removed: ${f.root}; port55816`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55816,
    url: 'postgresql://render2_fixture@127.0.0.1:55816/render2_local_test', identity });
  const actors = [
    { id: 91001, usuario: 'qa_franco' },
    { id: 91002, usuario: 'qa_agustin' },
    { id: 91003, usuario: 'qa_luciano' },
  ];
  const login = actor => loginProductionCookieSession(f.base, actor.usuario, fixturePassword);
  for (const actor of actors) {
    actor.session = await login(actor);
    assert.equal(actor.session.user.id, actor.id);
  }
  assert.equal(new Set(actors.map(actor => actor.session.context)).size, 3);
  const api = (path, actor = actors[0], method = 'GET', body) => productionCookieRequest(f.base, `/api${path}`,
    { session: actor.session, method, body });
  const read = async (path, actor) => {
    const value = checked(await api(path, actor)); noFinance(value); return value;
  };
  const [clock] = await f.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today`);
  const period = clock.today.slice(0, 7), start = `${period}-01`;
  assert.ok(period >= '2026-10', 'Goal journey requires a supported real fixture clock');
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  // All seven operational dates are distinct and differ from actual publication.
  const dates = Array.from({ length: 28 }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`)
    .filter(date => date !== clock.today);
  const visitDate = dates[0];
  const client = checked(await api('/clientes', actors[0], 'POST', { nombre: 'QA158 unified three-video client' }), 201);
  const agreementPath = `/clientes/${client.id}/acuerdo-mensual/iniciar`;
  const eligible = checked(await api(agreementPath));
  assert.equal(eligible.eligible, true);
  const agreement = checked(await api(agreementPath, actors[0], 'POST', {
    vigente_desde: period, expected_revision: eligible.agreement_revision, rubro: 'Servicios QA158',
    cuota_reels: 3, cuota_carruseles: 0, abono_mensual: '817293.46',
    dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4], disenador_responsable: 'Augusto',
  }));
  assert.equal(agreement.cliente.id, client.id);
  assert.equal(agreement.cliente.cuota_reels, 3);
  assert.equal(agreement.cliente.cuota_carruseles, 0);
  assert.equal(agreement.cliente.abono_mensual, '817293.46');
  const goal = async actor => one((await read(`/cliente-objetivos?periodo=${period}`, actor)).clientes,
    row => row.clave === `cliente-${client.id}`);
  const prepareBody = row => ({ periodo: period, clave: row.clave, responsables: [91003],
    responsables_por_formato: { video: [91003], carrusel: [91003] }, expected_preparation_revision: row.preparacion_revision });
  const initial = await goal();
  assert.equal(initial.preparado, false); assert.deepEqual(initial.piezas, []);
  assert.equal(checked(await api('/cliente-objetivos/preparar', actors[0], 'POST', prepareBody(initial))).creadas, 3);
  const prepared = await goal();
  assert.equal(prepared.piezas.length, 3);
  const records = [...prepared.piezas].sort((a, b) => a.numero - b.numero).map((slot, index) => ({
    slot, taskId: slot.tarea_id, actor: actors[index], reviewer: actors[index === 0 ? 1 : 0],
    due: dates[1 + index], scheduled: dates[4 + index], title: `QA158 planned video ${index + 1}`,
    copy: `QA158 editorial copy ${index + 1}`, artifacts: [],
  }));
  assert.deepEqual(records.map(record => record.slot.numero), [1, 2, 3]);
  assert.equal(new Set(records.map(record => record.taskId)).size, 3);
  const task = record => read(`/tareas/${record.taskId}?workspace=render_os`, record.actor);
  const businessTables = ['clientes', 'cliente_configuraciones', 'cliente_abonos',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'cliente_objetivo_responsables', 'cliente_objetivo_vinculos',
    'tareas', 'tarea_asignaciones', 'tarea_comentarios', 'produccion_visitas', 'produccion_videos',
    'produccion_fotos', 'produccion_visita_participantes', 'production_create_receipts',
    'task_editing_deliveries', 'task_editing_reviews', 'publicaciones', 'historias',
    'editorial_publicacion_eventos', 'editorial_publicacion_versiones'];
  const snapshot = async () => {
    const value = {};
    for (const table of businessTables) value[table] = createHash('sha256').update(JSON.stringify(
      await f.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`))).digest('hex');
    return value;
  };
  const unchangedReplay = async (path, actor, body) => {
    const before = await snapshot();
    const result = checked(await api(path, actor, 'POST', body));
    assert.deepEqual(await snapshot(), before, 'Exact replay must not mutate domain, agreement or evidence rows');
    return result;
  };
  const assertCounts = async () => {
    assert.deepEqual((await f.query('SELECT id FROM tareas WHERE cliente_id=$1 ORDER BY id', [client.id])).map(row => row.id),
      records.map(record => record.taskId).sort((a, b) => a - b), 'Three prepared tasks, never six');
    assert.deepEqual((await f.query(`SELECT p.id FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o
      ON o.id=p.objetivo_id WHERE o.cliente_id=$1 ORDER BY p.id`, [client.id])).map(row => row.id),
    records.map(record => record.slot.id).sort((a, b) => a - b));
  };
  await assertCounts();
  for (const record of records) {
    assert.equal(record.slot.en_cuota, true);
    let observed = await task(record);
    checked(await api(`/cliente-objetivos/piezas/${record.slot.id}/contenido`, actors[0], 'PATCH', {
      expected_revision: observed.revision, expected_updated_at: observed.updated_at, titulo: record.title, copy: record.copy,
    }));
    // Explicit ID-only assignment before handoff; no stale original collaborator
    // remains to make every owner's personal Home count all three tasks.
    observed = await task(record);
    checked(await api(`/tareas/${record.taskId}?workspace=render_os`, actors[0], 'PATCH', {
      expected_revision: observed.revision, expected_updated_at: observed.updated_at,
      asignado_a_id: record.actor.id, colaborador_ids: [],
    }));
  }
  const visitIntent = { request_id: randomUUID(), cliente_id: client.id, fecha: visitDate,
    titulo: 'QA158 one visit, three canonical videos', participante_ids: actors.map(actor => actor.id) };
  const createdVisit = checked(await api('/producciones', actors[0], 'POST', visitIntent), 201);
  // Visit creation signals receipt reuse by HTTP201/200, not a replayed DTO flag.
  assert.deepEqual(Object.keys(createdVisit), ['visita']);
  const visitId = createdVisit.visita.id; assert.match(visitId, uuid);
  const visit = async actor => (await read(`/producciones/${visitId}`, actor)).visita;
  assert.equal(createdVisit.visita.tarea_origen_id, null, 'No fabricated historical production source');
  for (const record of records) {
    const before = await visit(), ids = new Set(before.videos.map(video => video.id));
    const saved = checked(await api(`/producciones/${visitId}/videos`, actors[0], 'POST', {
      expected_revision: before.revision, titulo: record.title, guion: `QA158 independent script ${record.slot.numero}`,
      estado: 'planificado', material_url: `https://example.invalid/qa158/material-${record.slot.numero}`,
    }), 201).visita;
    record.videoId = one(saved.videos, video => !ids.has(video.id)).id; assert.match(record.videoId, uuid);
    record.videoPath = `/producciones/${visitId}/videos/${record.videoId}`;
    checked(await api(record.videoPath, actors[0], 'PATCH', { expected_revision: saved.revision, estado: 'grabado' }));
  }
  const replayVisit = await unchangedReplay('/producciones', actors[0], visitIntent);
  assert.equal(replayVisit.visita.id, visitId); assert.equal(replayVisit.visita.videos.length, 3);
  for (const record of records) {
    const candidates = await read(`${record.videoPath}/vinculo?periodo=${period}`);
    const candidate = one(candidates.casilleros, row => row.objetivo_pieza_id === record.slot.id);
    assert.equal(candidate.tarea_id, record.taskId);
    record.association = { expected_revision: (await visit()).revision, tarea_id: record.taskId,
      expected_tarea_revision: candidate.tarea_revision, objetivo_pieza_id: record.slot.id,
      expected_objetivo_updated_at: candidate.objetivo_updated_at, fecha_programada: record.scheduled };
    const linked = checked(await api(`${record.videoPath}/vincular-objetivo`, actors[0], 'POST', record.association), 201);
    assert.equal(linked.tarea_id, record.taskId); assert.equal(linked.objetivo_pieza_id, record.slot.id); assert.equal(linked.created, true);
    record.pieceId = linked.publicacion_id;
    const repeat = await unchangedReplay(`${record.videoPath}/vincular-objetivo`, actors[0], record.association);
    assert.equal(repeat.created, false); assert.equal(repeat.publicacion_id, record.pieceId);
    assert.equal(repeat.tarea_id, record.taskId);
    record.handoff = { expected_revision: (await visit()).revision, editor_id: record.actor.id, fecha_entrega: record.due };
    const handed = checked(await api(`${record.videoPath}/enviar-edicion`, actors[0], 'POST', record.handoff), 201);
    assert.equal(handed.created, true); assert.equal(handed.task.id, record.taskId);
    assert.equal(handed.task.asignado_a_id, record.actor.id); assert.deepEqual(handed.task.colaborador_ids, []);
    await assertCounts();
  }
  assert.equal(new Set(records.map(record => record.pieceId)).size, 3);
  const publicationPath = record => `/editorial-publicacion/publicacion/${record.pieceId}`;
  const unpublished = async () => {
    for (const record of records) {
      const result = await read(publicationPath(record));
      assert.equal(result.piece.fecha_programada, record.scheduled);
      assert.equal(result.piece.fecha_publicacion_real, null); assert.equal(result.current_confirmation, null);
      assert.equal(result.classification, 'no_publicada');
    }
    assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos'), [{ n: 0 }]);
  };
  await unpublished();
  for (const record of records) {
    const patch = async (estado, actor = record.actor, extra = {}) => checked(await api(
      `/tareas/${record.taskId}?workspace=render_os`, actor, 'PATCH', {
        expected_revision: (await task(record)).revision, estado, ...extra,
      }));
    await patch('en_progreso');
    if (record.actor.id !== 91003) {
      const beforeDenied = await snapshot();
      checked(await api(`/tareas-edicion/${record.taskId}/entregas`, actors[2], 'POST', {
        request_id: randomUUID(), expected_revision: (await task(record)).revision,
        url: 'https://example.invalid/qa158/unassigned', notes: 'Another editor cannot deliver this video',
      }), 403);
      assert.deepEqual(await snapshot(), beforeDenied);
    }
    const deliver = async version => {
      const body = { request_id: randomUUID(), expected_revision: (await task(record)).revision,
        url: `https://example.invalid/qa158/${record.videoId}/v${version}`, notes: `QA158 exact version ${version}` };
      const path = `/tareas-edicion/${record.taskId}/entregas`;
      const saved = checked(await api(path, record.actor, 'POST', body), 201);
      assert.equal(saved.replayed, false); assert.match(saved.delivery_id, uuid);
      const artifact = one(saved.deliveries, row => row.id === saved.delivery_id);
      assert.equal(artifact.task_id, record.taskId); assert.equal(artifact.actor_id, record.actor.id);
      assert.equal(artifact.url, body.url); assert.equal(artifact.notes, body.notes);
      assert.equal(artifact.task_revision, body.expected_revision + 1);
      record.artifacts.push({ artifact, body });
      const replay = await unchangedReplay(path, record.actor, body);
      assert.equal(replay.replayed, true); assert.equal(replay.delivery_id, artifact.id);
      return artifact.id;
    };
    const first = await deliver(1);
    record.correction = { request_id: randomUUID(), expected_revision: (await task(record)).revision,
      expected_entrega_id: first, notes: `QA158 correct ending of video ${record.videoId}, v1 only` };
    const correctionPath = `/tareas-edicion/${record.taskId}/correcciones`;
    const corrected = checked(await api(correctionPath, record.reviewer, 'POST', record.correction), 201);
    const decision = one(corrected.decisions, row => row.id === corrected.decision_id);
    assert.match(decision.id, uuid); assert.equal(decision.task_id, record.taskId);
    assert.equal(decision.actor_id, record.reviewer.id); assert.equal(decision.delivery_id, first);
    assert.equal(decision.action, 'correcciones'); assert.equal(decision.notes, record.correction.notes);
    assert.equal(decision.task_revision, record.correction.expected_revision + 1);
    const repeated = await unchangedReplay(correctionPath, record.reviewer, record.correction);
    assert.equal(repeated.replayed, true); assert.equal(repeated.decision_id, decision.id);
    const second = await deliver(2); assert.notEqual(first, second);
    const beforeStale = await snapshot();
    checked(await api(`/tareas/${record.taskId}?workspace=render_os`, record.reviewer, 'PATCH', {
      expected_revision: (await task(record)).revision, estado: 'aprobada', expected_entrega_id: first,
    }), 409);
    assert.deepEqual(await snapshot(), beforeStale);
    await patch('aprobada', record.reviewer, { expected_entrega_id: second });
    const approved = await task(record);
    assert.equal(approved.propiedades_extra.revision_aprobada, true);
    assert.equal(approved.propiedades_extra.revision_aprobada_entrega_id, second);
    const history = await read(`/tareas-edicion/${record.taskId}/revisiones`, record.actor);
    const approval = one(history.decisions, row => row.action === 'aprobada');
    assert.equal(approval.delivery_id, second); assert.equal(approval.actor_id, record.reviewer.id);
    assert.equal(history.total, 2); assert.equal(history.truncated, false);
    record.decisions = history.decisions;
    await patch('finalizada', record.reviewer);
    assert.equal((await task(record)).estado, 'finalizada');
    await unpublished();
  }
  const assertGoal = async actor => {
    const current = await goal(actor); assert.equal(current.piezas.length, 3);
    for (const record of records) {
      const slot = one(current.piezas, row => row.id === record.slot.id);
      assert.equal(slot.tarea_id, record.taskId); assert.equal(slot.publicacion_id, record.pieceId);
      assert.equal(slot.en_cuota, true); assert.equal(slot.estado, 'finalizada'); assert.ok(slot.completada_at);
    }
    return current;
  };
  await assertGoal(); await assertCounts();
  assert.equal(checked(await api('/cliente-objetivos/preparar', actors[0], 'POST', prepareBody(await goal()))).creadas, 0);
  await assertCounts(); await unpublished();
  const prePublicationCalendar = await read(`/calendario?${new URLSearchParams({
    desde: start, hasta: next, scope: 'team', cliente_id: String(client.id),
  })}`);
  assert.equal(prePublicationCalendar.events.filter(event => event.kind === 'publicacion').length, 0,
    'Finishing the three tasks must not create actual calendar publication events');
  for (const record of records) assert.equal(one(prePublicationCalendar.events,
    event => event.key === `programacion:publicacion:${record.pieceId}`).date, record.scheduled);
  const [occurred] = await f.query(`SELECT to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS instant,
    to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS day`);
  assert.equal(occurred.day, clock.today, 'Do not silently cross a date boundary during this journey');
  for (const record of records) {
    const observation = await read(publicationPath(record));
    record.confirmation = { request_id: randomUUID(), expected_revision: observation.piece.revision, occurred_at: occurred.instant };
    const saved = checked(await api(`${publicationPath(record)}/confirmar`, actors[0], 'POST', record.confirmation), 201);
    assert.equal(saved.classification, 'confirmada_manualmente'); assert.equal(saved.piece.estado, 'publicada');
    assert.equal(saved.piece.fecha_programada, record.scheduled); assert.equal(saved.piece.fecha_publicacion_real, occurred.instant);
    assert.equal(saved.current_confirmation.actor_id, actors[0].id); assert.equal(saved.current_confirmation.source, 'manual');
    record.evidence = saved.current_confirmation;
    const replay = await unchangedReplay(`${publicationPath(record)}/confirmar`, actors[0], record.confirmation);
    assert.equal(replay.replayed, true); assert.deepEqual(replay.current_confirmation, record.evidence);
  }
  // Fresh independent cookies, not cached controller objects or former bearer DTOs.
  for (const actor of actors) {
    const old = actor.session; actor.session = await login(actor);
    assert.equal(actor.session.user.id, actor.id); assert.notEqual(actor.session.context, old.context);
  }
  const beforeReads = await snapshot();
  for (const actor of actors) {
    await assertGoal(actor);
    const home = await read('/inicio', actor);
    assert.equal(home.user.id, actor.id); assert.equal(home.monthly_progress.period, period);
    assert.equal(home.monthly_progress.total, 1); assert.equal(home.monthly_progress.completed, 1);
    assert.equal(home.summary.open, 0); assert.deepEqual(home.tasks, []);
    const ownRecord = one(records, record => record.actor.id === actor.id);
    assert.ok(home.activity.some(row => row.task_id === ownRecord.taskId));
    assert.ok(!home.activity.some(row => records.some(record => record.actor.id !== actor.id && row.task_id === record.taskId)));
    const report = checked(await api(`/reportes/datos?${new URLSearchParams({
      mes_configuracion: period, desde: start, hasta: next,
    })}`, actor));
    if (actor.id === 91003) noFinance(report);
    const reported = actor.id === 91003 ? [ownRecord] : records;
    assert.deepEqual(report.tareasRenderOs.map(row => row.id).sort((a, b) => a - b),
      reported.map(record => record.taskId).sort((a, b) => a - b));
    const reportedVisit = one(report.producciones.visitas, row => row.id === visitId);
    assert.equal(reportedVisit.fecha, visitDate); assert.equal(reportedVisit.videos.length, 3);
    for (const record of reported) {
      const reportedTask = one(report.tareasRenderOs, row => row.id === record.taskId);
      assert.equal(reportedTask.estado, 'finalizada'); assert.equal(reportedTask.publicacion_id, record.pieceId);
      assert.equal(reportedTask.fecha_vencimiento.slice(0, 10), record.due);
      // This legacy report key counts completed editing work, not actual posts.
      assert.deepEqual(report.resumenRenderOsPorDia[record.due].ediciones, { total: 1, publicadas: 1 });
      const reportedPiece = one(report.publicaciones, row => row.id === record.pieceId);
      assert.equal(reportedPiece.publicacion_evidencia.classification, 'confirmada_manualmente');
      assert.deepEqual(reportedPiece.publicacion_evidencia.confirmation, record.evidence);
    }
    for (const scope of ['team', 'mine']) {
      const calendar = await read(`/calendario?${new URLSearchParams({ desde: start, hasta: next, scope, cliente_id: String(client.id) })}`, actor);
      assert.equal(calendar.truncated, false);
      assert.equal(one(calendar.events, event => event.key === `visita:visita:${visitId}`).date, visitDate);
      const taskEvents = calendar.events.filter(event => event.kind === 'tarea');
      const expected = scope === 'team' ? records : [ownRecord];
      assert.deepEqual(taskEvents.map(event => event.source_id).sort((a, b) => a - b), expected.map(record => record.taskId).sort((a, b) => a - b));
      for (const record of expected) {
        const deadline = one(calendar.events, event => event.key === `tarea:tarea:${record.taskId}`);
        assert.equal(deadline.date, record.due); assert.equal(deadline.estado, 'finalizada');
        assert.deepEqual(deadline.responsable_ids, [record.actor.id]);
        assert.equal(one(calendar.events, event => event.key === `programacion:publicacion:${record.pieceId}`).date, record.scheduled);
        const actual = one(calendar.events, event => event.key === `publicacion:publicacion:${record.pieceId}`);
        assert.equal(actual.date, occurred.day); assert.equal(actual.evidence.classification, 'confirmada_manualmente');
        assert.deepEqual(actual.evidence.confirmation, record.evidence);
      }
    }
  }
  const persistedVisit = await visit();
  assert.equal(persistedVisit.fecha, visitDate); assert.equal(persistedVisit.videos.length, 3);
  assert.deepEqual([...persistedVisit.participante_ids].sort((a, b) => a - b), actors.map(actor => actor.id));
  for (const record of records) {
    const current = await task(record);
    assert.equal(current.estado, 'finalizada'); assert.equal(current.asignado_a_id, record.actor.id);
    assert.equal(current.publicacion_id, record.pieceId); assert.equal(current.fecha_vencimiento.slice(0, 10), record.due);
    assert.deepEqual(current.colaborador_ids, []);
    const video = one(persistedVisit.videos, row => row.id === record.videoId);
    assert.equal(video.tarea_entrega_id, record.taskId); assert.equal(video.tarea_edicion_id, record.taskId);
    assert.equal(video.publicacion_id, record.pieceId); assert.equal(video.editor_actual_id, record.actor.id);
    assert.equal(video.editor_handoff_id, record.actor.id); assert.equal(video.fecha_entrega_handoff, record.due);
    assert.equal(video.fecha_entrega_actual, record.due); assert.equal(video.estado, 'grabado');
    assert.equal(video.tarea_estado, 'finalizada');
    const deliveries = await read(`/tareas-edicion/${record.taskId}/entregas`, record.actor);
    assert.equal(deliveries.deliveries.length, 2);
    for (const entry of record.artifacts) assert.deepEqual(one(deliveries.deliveries, row => row.id === entry.artifact.id), entry.artifact);
    const history = await read(`/tareas-edicion/${record.taskId}/revisiones`, record.actor);
    assert.deepEqual(history.decisions, record.decisions); assert.equal(history.latest_delivery.id, record.artifacts[1].artifact.id);
    const editorial = await read(publicationPath(record));
    assert.deepEqual(editorial.current_confirmation, record.evidence);
  }
  assert.deepEqual(await snapshot(), beforeReads, 'Fresh operational reads perform no domain/financial/evidence DML');
  // Old immutable receipts after finalization/publication must return current state.
  for (const record of records) {
    const handed = await unchangedReplay(`${record.videoPath}/enviar-edicion`, actors[0], record.handoff);
    assert.equal(handed.created, false); assert.equal(handed.task.id, record.taskId); assert.equal(handed.task.estado, 'finalizada');
    const delivered = await unchangedReplay(`/tareas-edicion/${record.taskId}/entregas`, record.actor, record.artifacts[0].body);
    assert.equal(delivered.replayed, true); assert.equal(delivered.task.estado, 'finalizada');
    const corrected = await unchangedReplay(`/tareas-edicion/${record.taskId}/correcciones`, record.reviewer, record.correction);
    assert.equal(corrected.replayed, true); assert.equal(corrected.task.estado, 'finalizada');
  }
  await assertCounts();
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM produccion_visitas WHERE cliente_id=$1', [client.id]), [{ n: 1 }]);
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM produccion_videos WHERE visita_id=$1', [visitId]), [{ n: 3 }]);
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM publicaciones WHERE cliente_id=$1', [client.id]), [{ n: 3 }]);
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM task_editing_deliveries WHERE task_id=ANY($1::int[])', [records.map(record => record.taskId)]), [{ n: 6 }]);
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM task_editing_reviews WHERE task_id=ANY($1::int[])', [records.map(record => record.taskId)]), [{ n: 6 }]);
  assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos'), [{ n: 3 }]);
});
