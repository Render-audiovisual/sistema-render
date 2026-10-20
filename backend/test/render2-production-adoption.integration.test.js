import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Author-only until Main declares implementation ready. Even discovery never
// starts services; explicit opt-in provisions only this generated local fixture.
test('manual production adoption HTTP: immutable existing editing task, atomic disposition and safe per-video continuation', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55667 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-adoption fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55667,
    url: 'postgresql://render2_fixture@127.0.0.1:55667/render2_local_test', identity });
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Adoption client',true) RETURNING id");
  const [otherClient] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Adoption other client',true) RETURNING id");
  const secret = 'QA_PRODUCTION_ADOPTION_PRIVATE_55667';
  let serial = 0;
  const pair = async ({ editor = 91003 } = {}) => {
    const [source] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      fecha_vencimiento,propiedades_extra) VALUES ($1,'Luciano QA','en_revision','produccion','visita',$2,'2026-10-25',$3::jsonb)
      RETURNING id,revision`, [`QA visita adoption source ${++serial}`, client.id, JSON.stringify({ workspace: 'render_os',
      produccion_registros: [{ id: 'historical-aggregate', cantidad: 4, fecha: '2026-10-20' }],
      produccion_videos_previstos: 4, future_finance: { importe: 817239.46, secret } })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [source.id]);
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      fecha_vencimiento,material_referencia,aclaraciones,propiedades_extra)
      VALUES ($1,'Legacy editorial label','pendiente','edicion','video',$2,'2026-10-28',
        'https://example.invalid/existing-material','Preserve existing editing instructions',$3::jsonb) RETURNING id,revision`,
    [`QA one-video existing task ${serial}`, client.id, JSON.stringify({ workspace: 'render_os', origen_visita_id: String(source.id),
      original_notes: { preserved: true }, future_finance: { secret } })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, editor]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91004,'colaborador')", [task.id]);
    return { source, task, editor };
  };
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(body.token); return body.token;
  };
  const admin = await login('qa_franco'), employee = await login('qa_luciano');
  const relations = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  const adoptionTables = relations.filter(name => /adop/i.test(name));
  const snapshot = async () => {
    const result = {};
    for (const table of relations) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      result[table] = await fixture.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const bodyFor = context => ({ request_id: randomUUID(), source_task_id: context.source.id,
    expected_source_revision: context.source.revision, acknowledgement: 'videos_identificados_manualmente',
    titulo: 'QA explicitly reconciled inventory', participante_ids: [91003], drive_url: 'https://example.invalid/reviewed-material',
    videos: [{ titulo: 'QA manually identified A', estado: 'grabado' }, { titulo: 'QA manually identified B', estado: 'grabado' }],
    existing_editing: { task_id: context.task.id, expected_revision: context.task.revision,
      video_ordinal: 1, acknowledgement: 'esta_tarea_edita_un_solo_video' } });
  const reconcile = (body, token = admin) => api('/producciones/reconciliaciones', { token, method: 'POST', body });
  const readVisit = async id => expect(await api(`/producciones/${id}`, { token: admin })).visita;
  const handoff = async (result, videoId) => {
    const visit = await readVisit(result.visita_id);
    return api(`/producciones/${result.visita_id}/videos/${videoId}/enviar-edicion`, { token: admin, method: 'POST',
      body: { expected_revision: visit.revision, editor_id: 91003, fecha_entrega: '2026-10-29' } });
  };
  const preservedBusiness = (before, after) => {
    for (const table of ['tareas', 'tarea_asignaciones', 'tarea_comentarios', 'task_editing_deliveries', 'task_editing_reviews',
      'historias', 'publicaciones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'editorial_publicacion_eventos'])
      assert.deepEqual(after[table], before[table], `${table} must not be created, relinked or rewritten by adoption`);
  };
  const response = (body, created) => {
    assert.deepEqual(Object.keys(body).sort(), ['reconciliation_id', 'visita_id', 'video_ids', 'created'].sort());
    for (const id of [body.reconciliation_id, body.visita_id, ...body.video_ids]) assert.match(id, /^[a-f0-9-]{36}$/i);
    assert.equal(body.video_ids.length, 2); assert.equal(body.created, created);
    assert.ok(!JSON.stringify(body).includes(secret));
  };
  await t.test('single reviewed child is adopted without task/assignment/evidence mutation; exact replay is stable', async () => {
    const context = await pair(), body = bodyFor(context), before = await snapshot();
    const result = expect(await reconcile(body), 201); response(result, true);
    const after = await snapshot(); preservedBusiness(before, after);
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 1);
    assert.equal(after.produccion_videos.length, before.produccion_videos.length + 2);
    assert.equal(after.produccion_reconciliaciones.length, before.produccion_reconciliaciones.length + 1);
    assert.ok(adoptionTables.length > 0, 'Migration 070 installs a durable adoption relation');
    assert.equal(adoptionTables.reduce((sum, name) => sum + after[name].length - before[name].length, 0), 1);
    const visit = await readVisit(result.visita_id), adopted = visit.videos.find(v => v.id === result.video_ids[0]);
    assert.equal(adopted.tarea_edicion_id, context.task.id); assert.equal(adopted.editor_id, context.editor);
    assert.equal(adopted.fecha_entrega, '2026-10-28');
    assert.equal(visit.videos.find(v => v.id === result.video_ids[1]).tarea_edicion_id, null);
    const stable = await snapshot();
    assert.deepEqual(expect(await reconcile(body)), { ...result, created: false });
    assert.deepEqual(await snapshot(), stable);
    expect(await reconcile({ ...body, existing_editing: { ...body.existing_editing, video_ordinal: 2 } }), 409);
    expect(await reconcile({ ...body, request_id: randomUUID() }), 409);
    assert.deepEqual(await snapshot(), stable);
  });
  await t.test('normal handoff creates only the other reviewed video task; extra video, changed history and new legacy child stay denied', async () => {
    const context = await pair(), result = expect(await reconcile(bodyFor(context)), 201);
    const before = await snapshot();
    const sent = expect(await handoff(result, result.video_ids[1]), 201);
    assert.equal(sent.created, true); assert.notEqual(sent.task.id, context.task.id);
    assert.equal(sent.task.asignado_a_id, 91003);
    assert.equal(sent.task.fecha_vencimiento.slice(0, 10), '2026-10-29');
    assert.equal(sent.task.propiedades_extra.origen_produccion_video_id, result.video_ids[1]);
    const after = await snapshot(); assert.equal(after.tareas.length, before.tareas.length + 1);
    assert.deepEqual(after.tareas.filter(r => r.id !== sent.task.id), before.tareas);
    for (const table of ['task_editing_deliveries', 'task_editing_reviews', 'tarea_comentarios', 'historias', 'publicaciones'])
      assert.deepEqual(after[table], before[table]);
    const visit = await readVisit(result.visita_id);
    const extra = expect(await api(`/producciones/${result.visita_id}/videos`, { token: admin, method: 'POST', body: {
      expected_revision: visit.revision, titulo: 'QA unreviewed extra', estado: 'grabado',
    } }), 201);
    const unreviewed = extra.visita.videos.find(v => !result.video_ids.includes(v.id)); assert.ok(unreviewed);
    let stable = await snapshot(); expect(await handoff(result, unreviewed.id), 409); assert.deepEqual(await snapshot(), stable);
    const changed = await pair(), changedResult = expect(await reconcile(bodyFor(changed)), 201);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"produccion_confirmada_at":"2026-10-21T12:00:00Z"}'::jsonb WHERE id=$1`, [changed.source.id]);
    stable = await snapshot(); expect(await handoff(changedResult, changedResult.video_ids[1]), 409); assert.deepEqual(await snapshot(), stable);
    const later = await pair(), laterResult = expect(await reconcile(bodyFor(later)), 201);
    await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES ('QA unexpected second legacy child','Luciano QA','pendiente','edicion',$1::jsonb)`, [JSON.stringify({ origen_visita_id: String(later.source.id) })]);
    stable = await snapshot(); expect(await handoff(laterResult, laterResult.video_ids[1]), 409); assert.deepEqual(await snapshot(), stable);
  });
  await t.test('HTTP child PATCH holding its row lock wins before concurrent reviewed-video handoff', async () => {
    const context = await pair(), result = expect(await reconcile(bodyFor(context)), 201);
    // This connection is exclusively the identity-checked generated fixture, never configured DATABASE_URL.
    const barrier = new pg.Client({ connectionString: 'postgresql://render2_fixture@127.0.0.1:55667/render2_local_test' });
    await barrier.connect();
    const key = 55667071;
    let patchPromise, handoffPromise;
    const waitFor = async predicate => {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.fail('Expected PostgreSQL lock barrier was not observed');
    };
    try {
      await barrier.query('SELECT pg_advisory_lock($1)', [key]);
      await fixture.query(`CREATE FUNCTION qa_adoption_patch_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id=${context.task.id} AND NEW.propiedades_extra->>'archivada_render_os'='true' THEN
          PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
      await fixture.query(`CREATE TRIGGER qa_adoption_patch_barrier BEFORE UPDATE ON tareas
        FOR EACH ROW EXECUTE FUNCTION qa_adoption_patch_barrier()`);
      patchPromise = api(`/tareas/${context.task.id}?workspace=render_os`, { token: admin, method: 'PATCH',
        body: { expected_revision: context.task.revision, propiedades_extra: { workspace: 'render_os',
          origen_visita_id: String(context.source.id), archivada_render_os: true } } });
      let patchPid;
      await waitFor(async () => {
        const rows = await barrier.query(`SELECT pid FROM pg_locks WHERE locktype='advisory'
          AND objid=$1 AND NOT granted`, [key]);
        patchPid = rows.rows[0]?.pid; return Boolean(patchPid);
      });
      const before = await snapshot();
      handoffPromise = handoff(result, result.video_ids[1]);
      await waitFor(async () => (await barrier.query(`SELECT 1 FROM pg_stat_activity
        WHERE $1::int=ANY(pg_blocking_pids(pid))`, [patchPid])).rowCount > 0);
      await barrier.query('SELECT pg_advisory_unlock($1)', [key]);
      expect(await patchPromise);
      expect(await handoffPromise, 409);
      const after = await snapshot();
      assert.equal(after.tareas.length, before.tareas.length, 'Rejected handoff must not create an editing task');
      assert.deepEqual(after.tarea_asignaciones, before.tarea_asignaciones);
      assert.deepEqual(after.produccion_videos, before.produccion_videos);
      assert.deepEqual(after.produccion_visitas, before.produccion_visitas);
      assert.equal(after.tareas.find(row => row.id === context.task.id).propiedades_extra.archivada_render_os, true);
    } finally {
      await barrier.query('SELECT pg_advisory_unlock($1)', [key]);
      await Promise.allSettled([patchPromise, handoffPromise].filter(Boolean));
      await fixture.query('DROP TRIGGER IF EXISTS qa_adoption_patch_barrier ON tareas');
      await fixture.query('DROP FUNCTION IF EXISTS qa_adoption_patch_barrier()');
      await barrier.end();
    }
  });
  await t.test('observed child revision detects intervening client/owner/date/state changes; ineligible current rows reject without writes', async () => {
    const mutations = [
      c => fixture.query('UPDATE tareas SET cliente_id=$1 WHERE id=$2', [otherClient.id, c.task.id]),
      c => fixture.query("UPDATE tareas SET fecha_vencimiento='2026-11-01' WHERE id=$1", [c.task.id]),
      c => fixture.query("UPDATE tareas SET estado='finalizada' WHERE id=$1", [c.task.id]),
      c => fixture.query("UPDATE tareas SET titulo='QA observed revision changed' WHERE id=$1", [c.task.id]),
      async c => {
        await fixture.query("UPDATE tarea_asignaciones SET usuario_id=91002 WHERE tarea_id=$1 AND tipo='responsable'", [c.task.id]);
        await fixture.query("UPDATE tareas SET prioridad='alta' WHERE id=$1", [c.task.id]);
      },
    ];
    for (const mutate of mutations) {
      const context = await pair(), body = bodyFor(context); await mutate(context);
      const before = await snapshot(); expect(await reconcile(body), 409); assert.deepEqual(await snapshot(), before);
    }
    const badRows = [
      async c => { await fixture.query('UPDATE tareas SET cliente_id=$1 WHERE id=$2', [otherClient.id, c.task.id]); },
      async c => { await fixture.query('UPDATE tareas SET fecha_vencimiento=NULL WHERE id=$1', [c.task.id]); },
      async c => { await fixture.query("UPDATE tareas SET tipo_tarea='diseno' WHERE id=$1", [c.task.id]); },
      async c => { await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"archivada_render_os":true}'::jsonb WHERE id=$1`, [c.task.id]); },
      async c => { await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra-'workspace' WHERE id=$1`, [c.task.id]); },
      async c => { await fixture.query("DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND tipo='responsable'", [c.task.id]); },
      async c => { await fixture.query("UPDATE tarea_asignaciones SET usuario_id=91004 WHERE tarea_id=$1 AND tipo='responsable'", [c.task.id]); },
    ];
    for (const mutate of badRows) {
      const context = await pair();
      // Avoid colliding with its existing collaborator when testing wrong owner.
      await fixture.query("DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND tipo='colaborador'", [context.task.id]);
      await mutate(context);
      const [observed] = await fixture.query('SELECT revision FROM tareas WHERE id=$1', [context.task.id]); context.task.revision = observed.revision;
      const before = await snapshot(); expect(await reconcile(bodyFor(context)), 409); assert.deepEqual(await snapshot(), before);
    }
    const inactiveOwner = await pair({ editor: 91002 });
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try { const before = await snapshot(); expect(await reconcile(bodyFor(inactiveOwner)), 409); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
  });
  await t.test('explicit same-video ACK preserves historical publicada and live delivery/approval/correction history', async () => {
    const historical = await pair();
    await fixture.query("UPDATE tareas SET estado='publicada' WHERE id=$1", [historical.task.id]);
    const live = await pair();
    const current = async () => (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [live.task.id]))[0].revision;
    expect(await api(`/tareas/${live.task.id}?workspace=render_os`, { token: admin, method: 'PATCH',
      body: { expected_revision: await current(), estado: 'en_progreso' } }));
    const deliver = async () => expect(await api(`/tareas-edicion/${live.task.id}/entregas`, {
      token: employee, method: 'POST', body: { request_id: randomUUID(), expected_revision: await current(),
        url: 'https://example.invalid/same-video-version', notes: 'QA same video version' },
    }), 201).delivery_id;
    const first = await deliver();
    expect(await api(`/tareas/${live.task.id}?workspace=render_os`, { token: admin, method: 'PATCH',
      body: { expected_revision: await current(), estado: 'aprobada', expected_entrega_id: first } }));
    const second = await deliver();
    expect(await api(`/tareas-edicion/${live.task.id}/correcciones`, { token: admin, method: 'POST',
      body: { request_id: randomUUID(), expected_revision: await current(), expected_entrega_id: second,
        notes: 'QA corrections to the same explicitly identified video' } }), 201);
    for (const context of [historical, live]) {
      context.task.revision = (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [context.task.id]))[0].revision;
      const before = await snapshot();
      if (context === live) {
        assert.equal(before.task_editing_deliveries.filter(row => row.task_id === live.task.id).length, 2);
        assert.deepEqual(before.task_editing_reviews.filter(row => row.task_id === live.task.id).map(row => row.action).sort(),
          ['aprobada', 'correcciones']);
      }
      const result = expect(await reconcile(bodyFor(context)), 201);
      const after = await snapshot();
      // Only registry inventory, provenance and adoption receipt may be added. All original live history is exact.
      for (const table of relations.filter(name => !['produccion_visitas', 'produccion_videos', 'produccion_visita_participantes',
        'produccion_reconciliaciones', 'produccion_reconciliacion_videos', ...adoptionTables].includes(name)))
        assert.deepEqual(after[table], before[table], `${table}: adoption preserves all original versions and business state`);
      const visit = await readVisit(result.visita_id);
      assert.equal(visit.videos.find(row => row.id === result.video_ids[0]).tarea_edicion_id, context.task.id);
      assert.equal(visit.videos.find(row => row.id === result.video_ids[0]).estado, 'grabado', 'Work history invents no video publication');
    }
  });
  await t.test('editorial piece/objective/registry links, multiple children and already-used task cannot be adopted', async () => {
    for (const domain of ['historia', 'publicacion']) {
      const context = await pair(), table = domain === 'historia' ? 'historias' : 'publicaciones';
      const [piece] = await fixture.query(`INSERT INTO ${table}(cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada)
        VALUES ($1,${domain === 'publicacion' ? "'video'," : ''}'lista','2026-10-25') RETURNING id`, [client.id]);
      await fixture.query(`UPDATE tareas SET ${domain === 'historia' ? 'historia_id' : 'publicacion_id'}=$1 WHERE id=$2`, [piece.id, context.task.id]);
      context.task.revision = (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [context.task.id]))[0].revision;
      const before = await snapshot(); expect(await reconcile(bodyFor(context)), 409); assert.deepEqual(await snapshot(), before);
    }
    let before;
    const objective = await pair();
    const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
      VALUES ($1,'2026-10-01',$2,'QA linked existing objective',1,0,'QA fixture') RETURNING id`,
    [`qa-adoption-objective-${objective.source.id}`, client.id]);
    await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,titulo)
      VALUES ($1,'video',1,$2,'QA existing objective slot')`, [goal.id, objective.task.id]);
    before = await snapshot(); expect(await reconcile(bodyFor(objective)), 409); assert.deepEqual(await snapshot(), before);
    const registryLinked = await pair();
    const visitId = randomUUID();
    await fixture.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'2026-10-25','QA already linked other registry',91001,91001)`, [visitId, client.id]);
    await fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'QA existing registry video','grabado',$3,91003,'2026-10-28',91001,91001)`,
    [randomUUID(), visitId, registryLinked.task.id]);
    before = await snapshot(); expect(await reconcile(bodyFor(registryLinked)), 409); assert.deepEqual(await snapshot(), before);
    const multiple = await pair();
    await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES ('QA second child without workspace','Luciano QA','pendiente','edicion',$1::jsonb)`, [JSON.stringify({ origen_visita_id: String(multiple.source.id) })]);
    before = await snapshot(); expect(await reconcile(bodyFor(multiple)), 409); assert.deepEqual(await snapshot(), before);
    const used = await pair(), result = expect(await reconcile(bodyFor(used)), 201), other = await pair();
    // Fixture-only move of the origin label cannot make one editing task usable twice.
    await fixture.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1', [other.task.id]);
    await fixture.query('DELETE FROM tareas WHERE id=$1', [other.task.id]);
    await fixture.query(`UPDATE tareas SET propiedades_extra=jsonb_set(propiedades_extra,'{origen_visita_id}',to_jsonb($1::text)) WHERE id=$2`, [String(other.source.id), used.task.id]);
    other.task = { id: used.task.id, revision: (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [used.task.id]))[0].revision };
    before = await snapshot(); expect(await reconcile(bodyFor(other)), 409); assert.deepEqual(await snapshot(), before);
    assert.ok(result.visita_id);
  });
  await t.test('070 write failure rolls back visit/videos/069 receipt/adoption and permits exact safe retry', async () => {
    assert.equal(adoptionTables.length, 1, 'Known 070 adoption write relation is present');
    const table = adoptionTables[0]; assert.match(table, /^[a-z_][a-z0-9_]*$/);
    const context = await pair(), body = bodyFor(context);
    await fixture.query(`CREATE FUNCTION qa_adoption_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA deliberate adoption failure'; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_adoption_insert_failure BEFORE INSERT ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION qa_adoption_insert_failure()`);
      try { const before = await snapshot(); expect(await reconcile(body), 500); assert.deepEqual(await snapshot(), before); }
      finally { await fixture.query(`DROP TRIGGER qa_adoption_insert_failure ON "${table}"`); }
    } finally { await fixture.query('DROP FUNCTION qa_adoption_insert_failure()'); }
    response(expect(await reconcile(body), 201), true);
  });
  await t.test('optional object remains strict and replay never bypasses current DB role/activity/session', async () => {
    const context = await pair(), valid = bodyFor(context), before = await snapshot();
    for (const existing_editing of [null, [], {}, { ...valid.existing_editing, unknown: true },
      { ...valid.existing_editing, task_id: '1' }, { ...valid.existing_editing, expected_revision: 0 },
      { ...valid.existing_editing, video_ordinal: 0 }, { ...valid.existing_editing, video_ordinal: 3 },
      { ...valid.existing_editing, acknowledgement: 'automatico' }]) {
      expect(await reconcile({ ...valid, existing_editing }), 400);
      assert.deepEqual(await snapshot(), before);
    }
    const unrecorded = { ...valid, videos: [{ titulo: 'Not recorded', estado: 'planificado' }, valid.videos[1]] };
    expect(await reconcile(unrecorded), 400); assert.deepEqual(await snapshot(), before);
    expect(await api('/producciones/reconciliaciones', { method: 'POST', body: valid }), 401);
    expect(await reconcile(valid, employee), 403); assert.deepEqual(await snapshot(), before);
    const actor = await login('qa_agustin'), created = expect(await reconcile(valid, actor), 201); response(created, true);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
    try { const stable = await snapshot(); expect(await reconcile(valid, actor), 403); assert.deepEqual(await snapshot(), stable); }
    finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    const revoked = await login('qa_agustin'); await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    let stable = await snapshot(); expect(await reconcile(valid, revoked), 401); assert.deepEqual(await snapshot(), stable);
    const inactiveToken = await login('qa_agustin'); await fixture.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try { stable = await snapshot(); expect(await reconcile(valid, inactiveToken), 401); assert.deepEqual(await snapshot(), stable); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
    assert.deepEqual(expect(await reconcile(valid, await login('qa_agustin'))), { ...created, created: false });
  });
});
