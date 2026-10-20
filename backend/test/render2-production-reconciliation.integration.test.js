import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Actual principal HTTP and physical fresh PostgreSQL only on explicit opt-in.
// No configured DB, alternate mutation endpoint, source edits or migration edits.
test('manual production reconciliation HTTP: atomic explicit videos, durable replay and provenance-only handoff', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55664 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own reconciliation fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55664,
    url: 'postgresql://render2_fixture@127.0.0.1:55664/render2_local_test', identity });
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Reconciliation active',true) RETURNING id");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Reconciliation inactive',false) RETURNING id");
  const secret = 'QA_RECONCILIATION_PRIVATE_55664';
  await fixture.query("UPDATE usuarios SET nombre='Franco' WHERE id=91004");
  let sequence = 0;
  const source = async ({ child = false, clientId = client.id, due = '2026-10-25',
    type = 'produccion', subtype = 'visita', props = {} } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      fecha_vencimiento,material_referencia,aclaraciones,propiedades_extra)
      VALUES ($1,'Luciano QA','en_revision',$2,$3,$4,$5,'https://example.invalid/legacy-material',$6,$7::jsonb) RETURNING id,revision`,
    [`QA historical source ${++sequence}`, type, subtype, clientId, due, secret, JSON.stringify({ workspace: 'render_os',
      produccion_registros: [{ id: 'legacy-aggregate', cantidad: 4, fecha: '2026-10-20', original_note: 'preserve raw aggregate' }],
      produccion_videos_previstos: 4, future_finance: { importe: 872193.41, secret }, ...props })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [row.id]);
    if (child) await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,cliente_id,tarea_padre_id,propiedades_extra)
      VALUES ('QA historical aggregate child','Luciano QA','publicada','edicion',$1,$2,$3::jsonb)`,
    [clientId, row.id, JSON.stringify({ origen_visita_id: String(row.id), history_marker: 'No workspace flag needed' })]);
    return row;
  };
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const result = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(result.token); return result.token;
  };
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin');
  const employee = await login('qa_luciano'), namedFranco = await login('qa_designer');
  // Inspect real tables rather than guessing migration 069's receipt/provenance
  // table names. Preserve actual row fields and deterministic ordering even for
  // tables without an id column. Never alter constraints or existing schemas.
  const relations = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of relations) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      result[table] = await fixture.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const intent = (row, overrides = {}) => ({ request_id: randomUUID(), source_task_id: row.id,
    expected_source_revision: row.revision, acknowledgement: 'videos_identificados_manualmente', titulo: 'QA explicit reconciled visit',
    participante_ids: [91003], drive_url: 'https://example.invalid/reconciled', observaciones: 'Reviewed manually; not aggregate inference',
    videos: [{ titulo: 'QA manually identified video A', guion: 'Script A', estado: 'grabado',
      material_url: 'https://example.invalid/video-a', observaciones: 'Explicit A' },
    { titulo: 'QA manually identified video B', guion: '', estado: 'grabado', material_url: '', observaciones: '' }], ...overrides });
  const reconcile = (body, token = admin) => api('/producciones/reconciliaciones', { token, method: 'POST', body });
  const uuid = value => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const response = (body, created, videoCount) => {
    assert.deepEqual(Object.keys(body).sort(), ['reconciliation_id', 'visita_id', 'video_ids', 'created'].sort());
    assert.equal(body.created, created); uuid(body.reconciliation_id); uuid(body.visita_id);
    assert.equal(body.video_ids.length, videoCount); body.video_ids.forEach(uuid);
    assert.equal(new Set(body.video_ids).size, videoCount);
    assert.ok(!JSON.stringify(body).includes(secret));
  };
  const readVisit = async id => expect(await api(`/producciones/${id}`, { token: admin })).visita;
  const handoff = async (result, videoId, extra = {}) => {
    const visit = await readVisit(result.visita_id);
    return api(`/producciones/${result.visita_id}/videos/${videoId}/enviar-edicion`, {
      token: admin, method: 'POST', body: { expected_revision: visit.revision, editor_id: 91003, fecha_entrega: '2026-10-28', ...extra },
    });
  };

  await t.test('explicit identities create one visit and exactly submitted videos without rewriting any source/business history', async () => {
    const row = await source(), body = intent(row), before = await snapshot();
    const result = expect(await reconcile(body), 201); response(result, true, 2);
    const after = await snapshot();
    for (const table of ['tareas', 'tarea_asignaciones', 'historias', 'publicaciones', 'cliente_objetivos_mensuales',
      'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      assert.deepEqual(after[table], before[table], `${table}: reconciliation is not task/publication/quota mutation`);
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 1);
    assert.equal(after.produccion_videos.length, before.produccion_videos.length + 2);
    const visit = await readVisit(result.visita_id);
    assert.equal(visit.tarea_origen_id, row.id); assert.equal(visit.cliente_id, client.id); assert.equal(visit.fecha, '2026-10-25');
    assert.deepEqual(new Set(visit.videos.map(v => v.id)), new Set(result.video_ids));
    for (const submitted of body.videos) {
      const video = visit.videos.find(v => v.titulo === submitted.titulo); assert.ok(video);
      for (const key of ['titulo', 'guion', 'estado', 'material_url', 'observaciones']) assert.equal(video[key], submitted[key]);
      assert.equal(video.tarea_edicion_id, null);
    }
    const newRows = relations.flatMap(table => after[table].filter(r => !before[table].some(old => JSON.stringify(old) === JSON.stringify(r)))
      .map(value => ({ table, value })));
    assert.ok(newRows.some(({ table, value }) => !['produccion_visitas', 'produccion_videos', 'produccion_visita_participantes'].includes(table)
      && Object.values(value).includes(result.reconciliation_id)), 'A durable receipt exists outside the visit/video rows');
    assert.ok(newRows.some(({ value }) => Object.entries(value).some(([key, value]) => /hash/i.test(key)
      && typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value))), 'Persist a source-history digest, not an invented publication proof');
    const replayBefore = await snapshot();
    const repeated = expect(await reconcile(body)); response(repeated, false, 2);
    assert.deepEqual(repeated, { ...result, created: false }); assert.deepEqual(await snapshot(), replayBefore);
    expect(await reconcile({ ...body, titulo: 'Changed same-request payload' }), 409);
    expect(await reconcile({ ...body, request_id: randomUUID() }), 409);
    expect(await reconcile(body, secondAdmin), 409);
    assert.deepEqual(await snapshot(), replayBefore);
  });
  await t.test('reviewed source client and historical visit date cannot be transferred by ordinary visit edits', async () => {
    const row=await source(), created=expect(await reconcile(intent(row)),201);
    const visit=await readVisit(created.visita_id);
    const [other]=await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA reconciliation other context',true) RETURNING id");
    for(const change of [{cliente_id:other.id},{fecha:'2026-11-07'}]) {
      const before=await snapshot();
      expect(await api(`/producciones/${created.visita_id}`,{token:admin,method:'PATCH',body:{expected_revision:visit.revision,...change}}),409);
      assert.deepEqual(await snapshot(),before,'Rejected dimension transfer preserves source/visit/history/provenance');
    }
  });
  await t.test('defaults are explicit empty values and concurrent identical request commits only once', async () => {
    const row = await source();
    const body = { request_id: randomUUID(), source_task_id: row.id, expected_source_revision: row.revision,
      acknowledgement: 'videos_identificados_manualmente', titulo: 'QA defaulted reconciliation',
      videos: [{ titulo: 'QA defaulted video', estado: 'planificado' }] };
    const before = await snapshot();
    const outcomes = await Promise.all([reconcile(body), reconcile(body)]);
    assert.deepEqual(outcomes.map(r => r.status).sort((a, b) => a - b), [200, 201]);
    const created = outcomes.find(r => r.status === 201).body, replay = outcomes.find(r => r.status === 200).body;
    response(created, true, 1); assert.deepEqual(replay, { ...created, created: false });
    const visit = await readVisit(created.visita_id);
    assert.equal(visit.drive_url, ''); assert.equal(visit.observaciones, '');
    assert.deepEqual(visit.participante_ids, []);
    for (const key of ['guion', 'material_url', 'observaciones']) assert.equal(visit.videos[0][key], '');
    const after = await snapshot();
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 1);
    assert.equal(after.produccion_videos.length, before.produccion_videos.length + 1);
    assert.deepEqual(after.tareas, before.tareas);
  });
  await t.test('legacy editing child is manual-mapping-only and invalid/stale/unavailable sources do not write', async () => {
    const childSource = await source({ child: true });
    const childBefore = await snapshot(), childResult = await reconcile(intent(childSource));
    expect(childResult, 409);
    assert.ok(JSON.stringify(childResult.body).includes('manual_mapping_required'), 'Conflict identifies unresolved aggregate child mapping');
    assert.deepEqual(await snapshot(), childBefore);
    const stale = await source();
    await fixture.query("UPDATE tareas SET prioridad='alta' WHERE id=$1", [stale.id]);
    let before = await snapshot(); expect(await reconcile(intent(stale)), 409); assert.deepEqual(await snapshot(), before);
    for (const [row, status] of [[await source({ clientId: inactive.id }), 409], [await source({ due: null }), 409],
      [await source({ type: 'edicion', subtype: 'video' }), 404], [await source({ props: { archivada_render_os: true } }), 404]]) {
      before = await snapshot();
      expect(await reconcile(intent(row)), status);
      assert.deepEqual(await snapshot(), before);
    }
    before = await snapshot(); expect(await reconcile(intent({ id: 2147483647, revision: 1 })), 404); assert.deepEqual(await snapshot(), before);
  });
  await t.test('closed payload, UUID/revision/acknowledgement, video cardinality/types and URLs reject before writes', async () => {
    const row = await source(), valid = intent(row), before = await snapshot();
    const invalid = [null, [], {}, { ...valid, extra: true }, { ...valid, request_id: 'invalid' },
      { ...valid, source_task_id: String(row.id) }, { ...valid, expected_source_revision: 0 },
      { ...valid, expected_source_revision: '1' }, { ...valid, acknowledgement: 'yes' },
      { ...valid, titulo: '' }, { ...valid, titulo: 'x'.repeat(251) }, { ...valid, participante_ids: ['91003'] },
      { ...valid, drive_url: 'javascript:alert(1)' }, { ...valid, observaciones: 'x'.repeat(20001) },
      { ...valid, videos: [] }, { ...valid, videos: Array.from({ length: 51 }, () => valid.videos[0]) },
      ...[{ titulo: '' }, { titulo: 'QA', estado: 'publicada' }, { titulo: 'QA', estado: 'grabado', unknown: true },
        { titulo: 'QA', estado: 'grabado', guion: {} }, { titulo: 'QA', estado: 'grabado', material_url: 'file:///secret' }]
        .map(video => ({ ...valid, videos: [video] }))];
    for (const body of invalid) { expect(await reconcile(body), 400); assert.deepEqual(await snapshot(), before); }
  });
  await t.test('late SQL failure rolls back visit, first video, receipt and provenance; same request can then succeed', async () => {
    const row = await source(), body = intent(row);
    body.videos[1].titulo = 'QA reconciliation injected failure';
    await fixture.query(`CREATE FUNCTION qa_reconciliation_video_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.titulo='QA reconciliation injected failure' THEN
        RAISE EXCEPTION 'QA deliberate late video failure'; END IF; RETURN NEW; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_reconciliation_video_failure BEFORE INSERT ON produccion_videos
        FOR EACH ROW EXECUTE FUNCTION qa_reconciliation_video_failure()`);
      try {
        const before = await snapshot();
        const failed = await reconcile(body); expect(failed, 500);
        assert.ok(!JSON.stringify(failed.body).includes(secret));
        assert.deepEqual(await snapshot(), before, 'Late failure cannot leave partial registry/receipt/provenance or consume request');
      } finally { await fixture.query('DROP TRIGGER qa_reconciliation_video_failure ON produccion_videos'); }
    } finally { await fixture.query('DROP FUNCTION qa_reconciliation_video_failure()'); }
    response(expect(await reconcile(body), 201), true, 2);
  });
  await t.test('only receipt-reviewed videos with unchanged source history can create their own explicit editing tasks', async () => {
    const row = await source(), result = expect(await reconcile(intent(row)), 201);
    const before = await snapshot();
    for (const videoId of result.video_ids) {
      const sent = expect(await handoff(result, videoId), 201);
      assert.equal(sent.task.asignado_a_id, 91003); assert.equal(sent.task.fecha_vencimiento.slice(0, 10), '2026-10-28');
      assert.equal(sent.task.propiedades_extra.origen_produccion_video_id, videoId);
      assert.equal(sent.task.propiedades_extra.origen_visita_id, undefined);
    }
    const after = await snapshot();
    assert.equal(after.tareas.length, before.tareas.length + 2);
    assert.deepEqual(after.tareas.filter(task => !result.video_ids.includes(task.propiedades_extra?.origen_produccion_video_id)), before.tareas);
    assert.deepEqual(after.publicaciones, before.publicaciones); assert.deepEqual(after.cliente_objetivo_piezas, before.cliente_objetivo_piezas);
    const visit = await readVisit(result.visita_id);
    const extra = expect(await api(`/producciones/${result.visita_id}/videos`, { token: admin, method: 'POST', body: {
      expected_revision: visit.revision, titulo: 'QA unreviewed extra video', estado: 'grabado',
    } }), 201);
    const extraVideo = extra.visita.videos.find(v => !result.video_ids.includes(v.id)); assert.ok(extraVideo);
    const stable = await snapshot(); expect(await handoff(result, extraVideo.id), 409); assert.deepEqual(await snapshot(), stable);
    const changed = await source(), changedResult = expect(await reconcile(intent(changed)), 201);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"produccion_confirmada_at":"2026-10-21T12:00:00Z"}'::jsonb WHERE id=$1`, [changed.id]);
    const changedBefore = await snapshot(); expect(await handoff(changedResult, changedResult.video_ids[0]), 409);
    assert.deepEqual(await snapshot(), changedBefore);
    const child = await source(), childResult = expect(await reconcile(intent(child)), 201);
    await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES ('QA later historical child','Luciano QA','pendiente','edicion',$1::jsonb)`, [JSON.stringify({ origen_visita_id: String(child.id) })]);
    const childBefore = await snapshot(); expect(await handoff(childResult, childResult.video_ids[0]), 409);
    assert.deepEqual(await snapshot(), childBefore);
  });
  await t.test('real existing normalized source cannot reconcile, and replay rechecks DB role/activity/session', async () => {
    const fresh = expect(await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA visita fresh normalized', tipo_tarea: 'produccion', subtipo: 'visita', workspace: 'render_os',
      asignado_a_id: 91003, cliente_id: client.id, fecha_vencimiento: '2026-10-25',
    } }), 201);
    let before = await snapshot(); expect(await reconcile(intent(fresh)), 409); assert.deepEqual(await snapshot(), before);
    const row = await source(), body = intent(row), created = expect(await reconcile(body, secondAdmin), 201);
    response(created, true, 2);
    before = await snapshot();
    expect(await api('/producciones/reconciliaciones', { method: 'POST', body }), 401);
    for (const token of [employee, namedFranco]) expect(await reconcile(body, token), 403);
    assert.deepEqual(await snapshot(), before);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
    try { before = await snapshot(); expect(await reconcile(body, secondAdmin), 403); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    const revoked = await login('qa_agustin');
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    before = await snapshot(); expect(await reconcile(body, revoked), 401); assert.deepEqual(await snapshot(), before);
    const inactiveToken = await login('qa_agustin'); await fixture.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try { before = await snapshot(); expect(await reconcile(body, inactiveToken), 401); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
    assert.deepEqual(expect(await reconcile(body, await login('qa_agustin'))), { ...created, created: false });
  });
});
