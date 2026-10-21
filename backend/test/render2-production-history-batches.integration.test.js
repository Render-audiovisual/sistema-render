import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('historical production batches preserve independent live editing evidence in a mixed visit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55732 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55732,
    url: 'postgresql://render2_fixture@127.0.0.1:55732/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status,
    `Unexpected principal HTTP status${typeof response.body?.error === 'string' ? ': ' + response.body.error.slice(0, 350) : ''}`); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES ('QA102 mixed batch client',true,1,0) RETURNING id");
  const privateMarker = 'QA102_PRIVATE_HISTORY_FINANCE';
  let serial = 0;
  const source = async () => (await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,
    cliente_id,fecha_vencimiento,propiedades_extra) VALUES ($1,'QA102 source','en_revision','produccion','visita',
    $2,'2026-10-25',$3::jsonb) RETURNING id`, [`QA102 historical source ${++serial}`, client.id,
    JSON.stringify({ workspace: 'render_os', produccion_registros: [{ id: 'original', cantidad: 4 }],
      produccion_videos_previstos: 4, private_finance: { marker: privateMarker } })]))[0];
  const child = async (origin, owner = 91003) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      fecha_vencimiento,material_referencia,propiedades_extra) VALUES ($1,'QA102 historical editor','pendiente',
      'edicion','video',$2,'2026-10-29','https://example.invalid/qa102-original',$3::jsonb) RETURNING id`,
    [`QA102 original editing ${++serial}`, client.id, JSON.stringify({ workspace: 'render_os', origen_visita_id: String(origin.id),
      original_content: { preserve: true }, private_finance: { marker: privateMarker } })]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    return row;
  };
  const tables = ['tareas', 'tarea_asignaciones', 'tarea_comentarios', 'task_editing_deliveries', 'task_editing_reviews',
    'publicaciones', 'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'editorial_publicacion_versiones', 'editorial_publicacion_eventos', 'produccion_visitas', 'produccion_videos',
    'produccion_fotos', 'produccion_visita_participantes', 'produccion_reconciliaciones', 'produccion_reconciliacion_videos',
    'produccion_edicion_adopciones', 'produccion_revision_lotes', 'produccion_revision_lote_videos',
    'produccion_revision_lote_hijos', 'produccion_lote_edicion_mapeos'];
  const snapshots = async () => {
    const result = {};
    for (const table of tables) result[table] = await f.query(`SELECT * FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const task = async id => ok(await api(`/tareas/${id}?workspace=render_os`, admin));
  const patch = async (id, state, extra = {}, token = admin) => ok(await api(`/tareas/${id}?workspace=render_os`, token, 'PATCH', {
    estado: state, expected_revision: (await task(id)).revision, ...extra,
  }));
  const deliver = async (id, token, label) => ok(await api(`/tareas-edicion/${id}/entregas`, token, 'POST', {
    request_id: randomUUID(), expected_revision: (await task(id)).revision,
    url: `https://example.invalid/qa102-${label}`, notes: `QA102 ${label}`,
  }), 201).delivery_id;
  const history = async (row, token, label) => {
    await patch(row.id, 'en_progreso', {}, token);
    const first = await deliver(row.id, token, `${label}-v1`);
    await patch(row.id, 'aprobada', { expected_entrega_id: first });
    const second = await deliver(row.id, token, `${label}-v2`);
    ok(await api(`/tareas-edicion/${row.id}/correcciones`, admin, 'POST', { request_id: randomUUID(),
      expected_revision: (await task(row.id)).revision, expected_entrega_id: second, notes: `QA102 correction ${label}` }), 201);
    return { first, second };
  };
  const context = async id => {
    const result = ok(await api(`/producciones/reconciliaciones/lotes/origen/${id}`, admin));
    assert.equal(result.version, 2); assert.match(result.context_hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes(privateMarker), false); return result;
  };
  const video = (title, taskId = null) => ({ local_key: randomUUID(), disposition: taskId ? 'adopt_original' : 'manual_independent',
    task_id: taskId, new_video: { titulo: title, guion: 'Explicit manual script', estado: 'grabado',
      material_url: 'https://example.invalid/qa102-video', observaciones: '' } });
  const bodyFor = (observed, videos) => ({ version: 2, request_id: randomUUID(), source_task_id: observed.source.id,
    expected_source_revision: observed.source.revision, visit_id: observed.visit?.id ?? null,
    expected_visit_revision: observed.visit?.revision ?? null, expected_context_hash: observed.context_hash,
    ...(!observed.visit ? { visit_fields: { titulo: 'QA102 explicitly created historical visit', participante_ids: [91003], drive_url: '', observaciones: '' } } : {}),
    videos, child_dispositions: observed.legacy_tasks.map(row => {
      const selected = videos.find(item => item.task_id === row.id);
      return { task_id: row.id, expected_revision: row.revision, disposition: selected ? 'mapped' : 'preserve_unmapped',
        video_key: selected ? selected.existing_video_id ?? selected.local_key : null,
        reason: selected ? 'Reviewed: all versions belong to this one video' : 'Preserve original work without inferring an individual video' };
    }), acknowledgement: 'correspondencias_revisadas_manualmente' });
  const post = (body, token = admin) => api('/producciones/reconciliaciones', token, 'POST', body);
  const ack = (response, created) => {
    const result = ok(response, created ? 201 : 200);
    assert.deepEqual(Object.keys(result).sort(), ['created', 'reconciliation_id', 'video_ids', 'visita_id']);
    assert.equal(result.created, created); assert.ok(Array.isArray(result.video_ids)); return result;
  };
  const visit = async id => ok(await api(`/producciones/${id}`, admin)).visita;
  const handoff = async (visitId, videoId, editorId = 91003) => api(`/producciones/${visitId}/videos/${videoId}/enviar-edicion`, admin, 'POST', {
    expected_revision: (await visit(visitId)).revision, editor_id: editorId, fecha_entrega: '2026-10-29',
  });
  const origin = await source(), first = await child(origin), second = await child(origin, 91002), unmatched = await child(origin);
  const firstArtifacts = await history(first, employee, 'first'), secondArtifacts = await history(second, secondAdmin, 'second');
  // Existing mixed history is raw SQL fixture setup, not an application writer
  // that bypasses reconciliation. 078 must be applied before these rows exist.
  const oldVisitId = randomUUID(), oldVideoId = randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,$3,'2026-10-25','QA102 preexisting mixed visit',91001,91001)`, [oldVisitId, origin.id, client.id]);
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,material_url,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,'Existing unreviewed video','Preserve existing mixed script','grabado','https://example.invalid/unreviewed-material',91001,91001)`, [oldVideoId, oldVisitId]);
  let result, initialBody, independentId;

  await t.test('two independent original task histories are mapped without original DML; mixed video and unmatched child survive', async () => {
    const observed = await context(origin.id), before = await snapshots();
    initialBody = bodyFor(observed, [video('First manually identified', first.id), video('Second manually identified', second.id), video('Independent manual item')]);
    result = ack(await post(initialBody), true); assert.equal(result.visita_id, oldVisitId); independentId = result.video_ids[2];
    const after = await snapshots();
    const changed = new Set(['produccion_visitas', 'produccion_videos', 'produccion_revision_lotes',
      'produccion_revision_lote_videos', 'produccion_revision_lote_hijos', 'produccion_lote_edicion_mapeos']);
    for (const name of tables.filter(name => !changed.has(name))) assert.deepEqual(after[name], before[name], name);
    assert.deepEqual(after.produccion_videos.find(row => row.id === oldVideoId), before.produccion_videos.find(row => row.id === oldVideoId));
    assert.equal(after.produccion_lote_edicion_mapeos.length, before.produccion_lote_edicion_mapeos.length + 2);
    const current = await visit(oldVisitId);
    assert.equal(current.videos.find(row => row.id === result.video_ids[0]).tarea_edicion_id, first.id);
    assert.equal(current.videos.find(row => row.id === result.video_ids[1]).tarea_edicion_id, second.id);
    assert.equal(current.videos.find(row => row.id === independentId).tarea_edicion_id, null);
    assert.deepEqual(after.tareas.find(row => row.id === unmatched.id), before.tareas.find(row => row.id === unmatched.id));
    for (const row of [first, second]) {
      assert.equal(after.task_editing_deliveries.filter(item => item.task_id === row.id).length, 2);
      assert.deepEqual(after.task_editing_reviews.filter(item => item.task_id === row.id).map(item => item.action).sort(), ['aprobada', 'correcciones']);
    }
  });

  await t.test('replay is exact/read-only; collision and unreviewed mixed video cannot gain provenance', async () => {
    const before = await snapshots();
    assert.deepEqual(ack(await post(initialBody), false), { ...result, created: false });
    ok(await post({ ...initialBody, videos: initialBody.videos.map((row, index) => index ? row : { ...row, new_video: { ...row.new_video, titulo: 'Changed intent' } }) }), 409);
    ok(await handoff(oldVisitId, oldVideoId), 409);
    assert.deepEqual(await snapshots(), before);
  });

  await t.test('v2-only reviewed visit rejects date/client changes without rewriting source or history', async () => {
    const [otherClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA102 forbidden reviewed transfer',true) RETURNING id");
    for (const change of [{ fecha: '2026-11-09' }, { cliente_id: otherClient.id }]) {
      const current = await visit(oldVisitId), before = await snapshots();
      ok(await api(`/producciones/${oldVisitId}`, admin, 'PATCH', { ...change, expected_revision: current.revision }), 409);
      assert.deepEqual(await snapshots(), before);
    }
  });

  await t.test('rereview keeps immutable original mapping; competing batches share one observed context', async () => {
    const observed = await context(origin.id);
    const existing = result.video_ids.map((id, index) => ({ existing_video_id: id,
      disposition: index < 2 ? 'adopt_original' : 'manual_independent', task_id: index === 0 ? first.id : index === 1 ? second.id : null }));
    const body = bodyFor(observed, existing), before = await snapshots();
    const responses = await Promise.all([post(body), post({ ...body, request_id: randomUUID() })]);
    assert.deepEqual(responses.map(row => row.status).sort(), [201, 409]);
    const after = await snapshots();
    for (const name of ['tareas', 'tarea_asignaciones', 'task_editing_deliveries', 'task_editing_reviews', 'produccion_lote_edicion_mapeos']) assert.deepEqual(after[name], before[name], name);
    const changed = bodyFor(await context(origin.id), [{ existing_video_id: result.video_ids[0], disposition: 'adopt_original', task_id: second.id }]);
    const stable = await snapshots(); ok(await post(changed), 409); assert.deepEqual(await snapshots(), stable);
  });

  await t.test('new unrelated child does not revoke selected videos; handoff uses original IDs and live workflow stays on them', async () => {
    await child(origin); // Added after review, deliberately not disposed by an old batch.
    const before = await snapshots();
    for (const [index, row] of [first, second].entries()) {
      const sent = ok(await handoff(oldVisitId, result.video_ids[index], index ? 91002 : 91003));
      assert.equal(sent.created, false); assert.equal(sent.task.id, row.id);
    }
    assert.deepEqual(await snapshots(), before);
    const sent = ok(await handoff(oldVisitId, independentId), 201);
    assert.equal(sent.created, true); assert.notEqual(sent.task.id, first.id); assert.notEqual(sent.task.id, second.id);
    const after = await snapshots(); assert.equal(after.tareas.length, before.tareas.length + 1);
    assert.deepEqual(after.tareas.filter(row => row.id !== sent.task.id), before.tareas);
    for (const name of ['task_editing_deliveries', 'task_editing_reviews', 'publicaciones', 'editorial_publicacion_eventos']) assert.deepEqual(after[name], before[name]);
    for (const [row, token, original] of [[first, employee, firstArtifacts], [second, secondAdmin, secondArtifacts]]) {
      const next = await deliver(row.id, token, `post-mapping-${row.id}`);
      await patch(row.id, 'aprobada', { expected_entrega_id: next }); await patch(row.id, 'finalizada');
      const historyDto = ok(await api(`/tareas-edicion/${row.id}/revisiones`, token));
      assert.equal(historyDto.latest_delivery.id, next);
      const deliveries = ok(await api(`/tareas-edicion/${row.id}/entregas`, token));
      assert.ok(deliveries.deliveries.some(item => item.id === original.first));
      assert.ok(deliveries.deliveries.some(item => item.id === original.second));
      assert.equal((await task(row.id)).estado, 'finalizada');
    }
  });

  await t.test('reviewed independent video can enter canonical editorial path without copying original approvals', async () => {
    const observed = await context(origin.id), newItem = video('Independent editorial selection');
    const reviewed = ack(await post(bodyFor(observed, [newItem])), true), id = reviewed.video_ids[0];
    // Preparation legitimately reuses prior completed work before creating
    // pending slots. Set an explicit larger quota through the real admin API
    // so this fixture also has genuinely pending, unbound candidate work.
    const clients = ok(await api('/clientes?periodo=2026-10', admin));
    const agreement = clients.find(row => row.id === client.id); assert.ok(agreement);
    ok(await api(`/clientes/${client.id}`, admin, 'PATCH', { cuota_reels: 20, expected_revision: agreement.agreement_revision }));
    ok(await api('/cliente-objetivos/preparar', admin, 'POST', { periodo: '2026-10', clave: `cliente-${client.id}`,
      responsables: [91003], responsables_por_formato: { video: [91003], carrusel: [91003] } }));
    const candidates = ok(await api(`/producciones/${oldVisitId}/videos/${id}/vinculo?periodo=2026-10`, admin));
    assert.ok(candidates.casilleros.length); const slot = candidates.casilleros[0];
    const linked = ok(await api(`/producciones/${oldVisitId}/videos/${id}/vincular-objetivo`, admin, 'POST', {
      expected_revision: (await visit(oldVisitId)).revision, tarea_id: slot.tarea_id, expected_tarea_revision: slot.tarea_revision,
      objetivo_pieza_id: slot.objetivo_pieza_id, expected_objetivo_updated_at: slot.objetivo_updated_at, fecha_programada: '2026-10-30',
    }), 201);
    assert.equal(linked.tarea_id, slot.tarea_id);
    const sent = ok(await handoff(oldVisitId, id), 201); assert.equal(sent.task.id, slot.tarea_id);
    assert.deepEqual(await f.query('SELECT id FROM task_editing_deliveries WHERE task_id=$1', [slot.tarea_id]), []);
    assert.deepEqual(await f.query('SELECT id FROM task_editing_reviews WHERE task_id=$1', [slot.tarea_id]), []);
    assert.equal((await task(slot.tarea_id)).estado, 'pendiente');
    assert.deepEqual(await f.query('SELECT id FROM editorial_publicacion_eventos WHERE publicacion_id=$1', [linked.publicacion_id]), []);
  });

  await t.test('reviewed video associates an existing publication and continues on its exact canonical task only', async () => {
    const reviewed = ack(await post(bodyFor(await context(origin.id), [video('Existing publication entry')])), true);
    const id = reviewed.video_ids[0];
    const publication = ok(await api('/piezas', admin, 'POST', { tipo: 'video', cliente_id: client.id,
      responsable_id: 91003, fecha_programada: '2026-10-30', estado: 'pendiente', idea: 'QA102 existing publication', copy: 'Canonical editorial copy' }), 201);
    const canonicalRows = await f.query('SELECT id FROM tareas WHERE publicacion_id=$1 ORDER BY id', [publication.id]);
    assert.equal(canonicalRows.length, 1); const canonicalId = canonicalRows[0].id;
    const candidates = ok(await api(`/producciones/${oldVisitId}/videos/${id}/vinculo?periodo=2026-10`, admin));
    const selected = candidates.publicaciones.find(row => row.publicacion_id === publication.id && row.tarea_id === canonicalId);
    assert.ok(selected, 'Existing-publication choice must identify exactly its canonical task');
    const body = { expected_revision: (await visit(oldVisitId)).revision, tarea_id: canonicalId,
      expected_tarea_revision: selected.tarea_revision, publicacion_id: publication.id,
      expected_publicacion_updated_at: selected.publicacion_updated_at };
    const before = await snapshots();
    const linked = ok(await api(`/producciones/${oldVisitId}/videos/${id}/vincular-pieza`, admin, 'POST', body));
    assert.equal(linked.tarea_id, canonicalId); assert.equal(linked.publicacion_id, publication.id);
    const sent = ok(await handoff(oldVisitId, id), 201); assert.equal(sent.task.id, canonicalId);
    const after = await snapshots(); assert.equal(after.tareas.length, before.tareas.length);
    for (const name of ['task_editing_deliveries', 'task_editing_reviews', 'editorial_publicacion_eventos']) assert.deepEqual(after[name], before[name]);
    const stable = await snapshots();
    const repeated = ok(await handoff(oldVisitId, id)); assert.equal(repeated.created, false); assert.equal(repeated.task.id, canonicalId);
    assert.deepEqual(await snapshots(), stable);
    const current = await task(canonicalId); assert.equal(current.publicacion_id, publication.id); assert.equal(current.estado, 'pendiente');
  });

  await t.test('staged publication on original task is a candidate, not operational proof before exact association', async () => {
    const freshSource = await source(), originalTask = await child(freshSource);
    const reviewed = ack(await post(bodyFor(await context(freshSource.id), [video('Staged original editorial mapping', originalTask.id)])), true);
    const id = reviewed.video_ids[0];
    // Explicit SQL fixture models a staged publication/task tuple, not an
    // authorized application mutation or evidence of an actual publication.
    const [publication] = await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
      VALUES ($1,'video','pendiente','2026-10-30','QA102 staged publication','Original canonical copy') RETURNING id`, [client.id]);
    await f.query('UPDATE tareas SET publicacion_id=$2 WHERE id=$1', [originalTask.id, publication.id]);
    const before = await snapshots();
    const candidates = ok(await api(`/producciones/${reviewed.visita_id}/videos/${id}/vinculo?periodo=2026-10`, admin));
    const selected = candidates.publicaciones.find(row => row.publicacion_id === publication.id && row.tarea_id === originalTask.id);
    assert.ok(selected, 'Discovery may expose only the exact prospective canonical tuple');
    assert.deepEqual(await snapshots(), before, 'Discovery remains read-only');
    ok(await handoff(reviewed.visita_id, id), 409);
    assert.deepEqual(await snapshots(), before, 'A staged tuple must not gain operational authorization');
    const body = { expected_revision: (await visit(reviewed.visita_id)).revision, tarea_id: originalTask.id,
      expected_tarea_revision: selected.tarea_revision, publicacion_id: publication.id,
      expected_publicacion_updated_at: selected.publicacion_updated_at };
    const linked = ok(await api(`/producciones/${reviewed.visita_id}/videos/${id}/vincular-pieza`, admin, 'POST', body));
    assert.equal(linked.tarea_id, originalTask.id);
    const sent = ok(await handoff(reviewed.visita_id, id)); assert.equal(sent.created, false); assert.equal(sent.task.id, originalTask.id);
    const after = await snapshots();
    assert.deepEqual(after.tareas, before.tareas);
    assert.deepEqual(after.task_editing_deliveries, before.task_editing_deliveries);
    assert.deepEqual(after.task_editing_reviews, before.task_editing_reviews);
    assert.deepEqual(after.editorial_publicacion_eventos, before.editorial_publicacion_eventos);
  });

  await t.test('source history changed after candidate selection rejects association and rolls back the entire prospective tuple', async () => {
    const freshSource = await source();
    const reviewed = ack(await post(bodyFor(await context(freshSource.id), [video('Historical proof rollback item')])), true);
    const id = reviewed.video_ids[0];
    const publication = ok(await api('/piezas', admin, 'POST', { tipo: 'video', cliente_id: client.id,
      responsable_id: 91003, fecha_programada: '2026-10-30', estado: 'pendiente', idea: 'QA102 stale history publication', copy: 'Keep original copy' }), 201);
    const candidates = ok(await api(`/producciones/${reviewed.visita_id}/videos/${id}/vinculo?periodo=2026-10`, admin));
    const selected = candidates.publicaciones.find(row => row.publicacion_id === publication.id); assert.ok(selected);
    const body = { expected_revision: (await visit(reviewed.visita_id)).revision, tarea_id: selected.tarea_id,
      expected_tarea_revision: selected.tarea_revision, publicacion_id: publication.id,
      expected_publicacion_updated_at: selected.publicacion_updated_at };
    await f.query(`UPDATE tareas SET propiedades_extra=propiedades_extra ||
      '{"produccion_confirmada_at":"2026-10-26T12:00:00Z"}'::jsonb WHERE id=$1`, [freshSource.id]);
    const before = await snapshots();
    ok(await api(`/producciones/${reviewed.visita_id}/videos/${id}/vincular-pieza`, admin, 'POST', body), 409);
    assert.deepEqual(await snapshots(), before, 'Invalidated review cannot leave task/publication/video/visit/audit writes');
    const current = await visit(reviewed.visita_id), item = current.videos.find(row => row.id === id);
    assert.equal(item.publicacion_id, null); assert.equal(item.tarea_entrega_id, null); assert.equal(item.tarea_edicion_id, null);
  });

  await t.test('late batch INSERT failure rolls back new visit/videos/receipt and retry remains safe for an unnormalized source', async () => {
    const fresh = await source(), body = bodyFor(await context(fresh.id), [video('Rollback explicit item')]);
    const before = await snapshots();
    await f.query(`CREATE FUNCTION qa102_batch_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA102 synthetic batch provenance failure'; END $$`);
    try {
      await f.query('CREATE TRIGGER qa102_batch_fault BEFORE INSERT ON produccion_revision_lote_videos FOR EACH ROW EXECUTE FUNCTION qa102_batch_fault()');
      try { ok(await post(body), 500); assert.deepEqual(await snapshots(), before); }
      finally { await f.query('DROP TRIGGER qa102_batch_fault ON produccion_revision_lote_videos'); }
    } finally { await f.query('DROP FUNCTION qa102_batch_fault()'); }
    const created = ack(await post(body), true); assert.notEqual(created.visita_id, oldVisitId);
    const stable = await snapshots(); ack(await post(body), false); assert.deepEqual(await snapshots(), stable);
    ok(await api(`/producciones/reconciliaciones/lotes/origen/${fresh.id}`, employee), 403);
    ok(await post({ ...body, request_id: randomUUID() }, employee), 403);
    assert.deepEqual(await snapshots(), stable);
  });
});
