import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const marker = 'QA_EDITING_FINANCE_55615';
const approvalKeys = ['revision_aprobada', 'revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'finalizada_at', 'revision_aprobada_entrega_id'];
test('editing deliveries: explicit immutable versions on canonical principal production tasks', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55615, deferEditingDeliveriesMigration: true });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editing-deliveries fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const api = (path, token = admin, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco');
  for (const [id, role] of [[108001, 'edicion'], [108002, 'edicion'], [108003, 'diseno']]) await fixture.query(`INSERT INTO usuarios
    (id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA Editing Same Name',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_delivery_${id}`, role]);
  let editor = await login('qa_delivery_108001'); const homonym = await login('qa_delivery_108002'); const collaborator = await login('qa_delivery_108003');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA explicit editing deliveries') RETURNING id");
  const visit = checked(await api('/producciones', admin, 'POST', { cliente_id: client.id, fecha: '2026-10-15',
    titulo: 'QA three distinct videos', participante_ids: [108001, 108003] }), 201).visita;
  const readVisit = async () => checked(await api(`/producciones/${visit.id}`)).visita;
  const taskIds = [];
  for (let i = 0; i < 3; i++) {
    const created = checked(await api(`/producciones/${visit.id}/videos`, editor, 'POST', {
      expected_revision: (await readVisit()).revision, titulo: `QA versioned video ${i}`, guion: `QA original script ${i}`,
      estado: 'grabado', material_url: `https://example.invalid/raw-${i}`,
    }), 201).visita;
    const video = created.videos.find(video => video.titulo === `QA versioned video ${i}`);
    const handed = checked(await api(`/producciones/${visit.id}/videos/${video.id}/enviar-edicion`, admin, 'POST', {
      expected_revision: created.revision, editor_id: 108001, fecha_entrega: '2026-10-25',
    }), 201);
    assert.ok(Number.isSafeInteger(handed.task.id)); taskIds.push(handed.task.id);
  }
  assert.equal(new Set(taskIds).size, 3);
  const task = async id => (await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]))[0];
  const route = id => `/tareas-edicion/${id}/entregas`;
  const read = async (id, token = admin) => checked(await api(route(id), token));
  const input = async (id, extra = {}) => ({ request_id: randomUUID(), expected_revision: (await task(id)).revision,
    url: 'https://example.invalid/editing/version-1', notes: 'QA explicit edited artifact', ...extra });
  const submit = (id, body, token = editor) => api(route(id), token, 'POST', body);
  const patch = async (id, estado, token = admin) => {
    const detail = checked(await api(`/tareas/${id}?workspace=render_os`));
    const deliveries = estado === 'aprobada' ? (await read(id)).deliveries : [];
    const latest = [...deliveries].sort((a, b) => b.task_revision - a.task_revision || b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id))[0];
    return checked(await api(`/tareas/${id}?workspace=render_os`, token, 'PATCH', { estado, expected_revision: detail.revision,
      ...(latest ? { expected_entrega_id: latest.id } : {}) }));
  };
  const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy,metadata)
    VALUES ($1,'video','lista','2026-10-29','QA original editorial copy','{"qa_preserve":"yes"}') RETURNING id`, [client.id]);
  const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-editing-065','2026-10-01',$1,'QA editing work objective',3,0,'QA fixture') RETURNING id`, [client.id]);
  await fixture.query(`UPDATE tareas SET publicacion_id=$2,aclaraciones='QA original script',material_referencia='https://example.invalid/raw-original',
    propiedades_extra=propiedades_extra||$3::jsonb WHERE id=$1`, [taskIds[0], publication.id, JSON.stringify({
    guiones: 'QA separate script', copy_trabajo: 'QA original editorial copy', edicion_responsable_id: 108001,
    edicion_responsable: 'QA Editing Same Name', edicion_completada_at: '2026-10-01T12:00:00Z',
    private_finance: { amount: 827456.39, marker },
  })]);
  const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy)
    VALUES ($1,'video',1,$2,$3,'QA canonical editing objective','QA original editorial copy') RETURNING id`, [goal.id, taskIds[0], publication.id]);
  await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,108003,'colaborador')", [taskIds[0]]);
  const snapshot = async (deliveries = true) => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', ...(deliveries ? ['task_editing_deliveries'] : []), 'publicaciones', 'historias',
      'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'produccion_visitas', 'produccion_videos', 'produccion_fotos', 'produccion_visita_participantes',
      'editorial_publicacion_eventos', 'editorial_publicacion_versiones'])
      result[table] = await fixture.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const protectedState = async id => {
    const row = await task(id); const props = { ...row.propiedades_extra };
    for (const key of approvalKeys) delete props[key];
    return { title: row.titulo, client: row.cliente_id, deadline: row.fecha_vencimiento,
      raw: row.material_referencia, script: row.aclaraciones, props,
      bindings: await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [id]),
      videos: await fixture.query('SELECT * FROM produccion_videos WHERE visita_id=$1 ORDER BY id', [visit.id]),
      visit: await fixture.query('SELECT * FROM produccion_visitas WHERE id=$1', [visit.id]),
      editorial: await fixture.query('SELECT id,estado,"fecha_publicación_real",fecha_programada FROM publicaciones WHERE id=$1', [publication.id]),
    };
  };
  const validate = async (dto, id, writing = false) => {
    assert.deepEqual(Object.keys(dto).sort(), ['task', 'deliveries', 'can_deliver', ...(writing ? ['delivery_id', 'replayed'] : [])].sort());
    assert.deepEqual(Object.keys(dto.task).sort(), ['id', 'revision', 'estado'].sort()); assert.equal(dto.task.id, id);
    const current = await task(id); assert.equal(dto.task.revision, current.revision); assert.equal(dto.task.estado, current.estado);
    const rows = await fixture.query(`SELECT id,task_id,actor_id,task_revision,url,notes,recorded_at FROM task_editing_deliveries
      WHERE task_id=$1 ORDER BY recorded_at DESC,id DESC`, [id]);
    assert.deepEqual(dto.deliveries, rows.map(row => ({ ...row, recorded_at: new Date(row.recorded_at).toISOString() })));
    for (const row of dto.deliveries) assert.deepEqual(Object.keys(row).sort(), ['id', 'task_id', 'actor_id', 'task_revision', 'url', 'notes', 'recorded_at'].sort());
    assert.ok(!JSON.stringify(dto).includes(marker)); assert.ok(!JSON.stringify(dto).includes('827456.39'));
  };
  await t.test('065 preserves populated production/task/editorial/goal history and creates zero inferred deliveries', async () => {
    const migration = '065_task_editing_deliveries.sql';
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [migration]), []);
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.task_editing_deliveries') AS relation"), [{ relation: null }]);
    const before = await snapshot(false);
    await fixture.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(false), before, 'No historical task/raw/approval/lineage/editorial/goal rewrite');
    assert.deepEqual(await fixture.query('SELECT * FROM task_editing_deliveries'), []);
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [migration]);
  });
  await t.test('existing handed-off artifacts/states do not infer events; closed shared GET is read-only', async () => {
    assert.deepEqual(await fixture.query('SELECT * FROM task_editing_deliveries'), []);
    const before = await snapshot();
    for (const id of taskIds) for (const token of [admin, editor, homonym, collaborator]) {
      const dto = await read(id, token); await validate(dto, id); assert.deepEqual(dto.deliveries, []);
      assert.equal(dto.can_deliver, token === admin || token === editor || (id === taskIds[0] && token === collaborator));
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('strict IDs/query/body/url/notes/revision validation never mutates tasks or history', async () => {
    const id = taskIds[0], body = await input(id), before = await snapshot();
    for (const invalid of [{ ...body, actor_id: 91001 }, { ...body, source: 'drive' }, { ...body, expected_revision: 0 },
      { ...body, expected_revision: 1.5 }, { ...body, expected_revision: undefined }, { ...body, request_id: 'bad' },
      { ...body, notes: 'x'.repeat(4001) }, { ...body, notes: 'a\0b' }, { ...body, notes: undefined },
      ...['javascript:alert(1)', 'https://user:pass@example.invalid/a', 'https://example.invalid/a\nb', 'https://example.invalid/' + 'x'.repeat(2000)].map(url => ({ ...body, url }))])
      assert.equal((await submit(id, invalid)).status, 400, JSON.stringify(invalid));
    for (const invalid of ['0', '01', '-1', '2147483648', '1x']) assert.equal((await api(route(invalid))).status, 400);
    assert.equal((await api(`${route(id)}?workspace=render_os`)).status, 400);
    assert.equal((await submit(id, body, homonym)).status, 403); assert.equal((await request(fixture.base, `/api${route(id)}`)).status, 401);
    assert.deepEqual(await snapshot(), before);
  });
  let original;
  await t.test('delivery from approved clears all approval fields once, preserves raw/script/credit/lineage and syncs goal work state', async () => {
    const id = taskIds[0]; await patch(id, 'en_progreso', editor); await patch(id, 'en_revision', editor); await patch(id, 'aprobada');
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||'{"finalizada_at":"2026-10-01T12:00:00Z"}' WHERE id=$1`, [id]);
    const before = await protectedState(id), body = await input(id);
    const dto = checked(await submit(id, { ...body, url: `  ${body.url}  ` }, collaborator), 201); await validate(dto, id, true);
    assert.equal(dto.replayed, false); assert.equal(dto.task.estado, 'en_revision'); assert.equal(dto.task.revision, body.expected_revision + 1);
    const saved = await task(id); assert.equal(saved.propiedades_extra.revision_aprobada, false);
    for (const key of approvalKeys.slice(1)) assert.equal(saved.propiedades_extra[key] ?? null, null, key);
    assert.deepEqual(await protectedState(id), before);
    const [work] = await fixture.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1', [slot.id]);
    assert.equal(work.estado, 'en_revision'); assert.equal(work.completada_at, null);
    original = { id, body, token: collaborator, deliveryId: dto.delivery_id };
  });
  await t.test('residual approval in review is cleared without replacing unrelated metadata or editing credit', async () => {
    // INSERT represents an old residual row; UPDATE would correctly sanitize it
    // through058 before the delivery service could exercise this compatibility case.
    const [legacy] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
      VALUES ('QA residual review approval','QA Editing Same Name','edicion','en_revision',$1::jsonb) RETURNING id`, [JSON.stringify({
      workspace: 'render_os', edicion_responsable_id: 108001, qa_preserved: 'historical editing credit',
      revision_aprobada: true, revision_aprobada_por: 'QA old approval', revision_aprobada_por_id: 91001,
      revision_aprobada_at: '2026-10-01T12:00:00Z', finalizada_at: '2026-10-01T12:00:00Z',
    })]);
    const id = legacy.id;
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,108001,'responsable')", [id]);
    assert.equal((await task(id)).propiedades_extra.revision_aprobada, true);
    const protectedBefore = await protectedState(id), body = await input(id);
    checked(await submit(id, body), 201);
    const row = await task(id); assert.equal(row.propiedades_extra.revision_aprobada, false);
    for (const key of approvalKeys.slice(1)) assert.equal(row.propiedades_extra[key] ?? null, null);
    assert.deepEqual(await protectedState(id), protectedBefore);
  });
  await t.test('exact replay returns current state/history; changed URL/notes/task/revision with same actor key409', async () => {
    const { id, body, token } = original; const before = await snapshot();
    const dto = checked(await submit(id, body, token)); await validate(dto, id, true);
    assert.equal(dto.replayed, true); assert.equal(dto.delivery_id, original.deliveryId); assert.deepEqual(await snapshot(), before);
    for (const changed of [{ ...body, notes: 'different' }, { ...body, url: 'https://example.invalid/other' }, { ...body, expected_revision: body.expected_revision + 1 }])
      assert.equal((await submit(id, changed, token)).status, 409);
    const independent = await input(taskIds[1], { request_id: body.request_id });
    checked(await submit(taskIds[1], independent, admin), 201);
    // Same actor is assigned to both tasks, so cross-task key reuse reaches hash validation.
    const ownBody = await input(taskIds[1]); checked(await submit(taskIds[1], ownBody), 201);
    assert.equal((await submit(taskIds[2], ownBody)).status, 409);
  });
  await t.test('concurrent distinct keys with one observed task revision produce exactly201+409, no lost metadata', async () => {
    const id = taskIds[2], body = await input(id), protectedBefore = await protectedState(id);
    const beforeN = (await fixture.query('SELECT count(*)::int AS n FROM task_editing_deliveries WHERE task_id=$1', [id]))[0].n;
    const responses = await Promise.all([submit(id, body), submit(id, { ...body, request_id: randomUUID(), url: 'https://example.invalid/version-2' })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]); assert.equal((await task(id)).revision, body.expected_revision + 1);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM task_editing_deliveries WHERE task_id=$1', [id]))[0].n, beforeN + 1);
    assert.deepEqual(await protectedState(id), protectedBefore);
  });
  await t.test('simultaneous exact retry produces201+200 and one durable event/version increment', async () => {
    const id = taskIds[2], body = await input(id), beforeN = (await read(id)).deliveries.length;
    const responses = await Promise.all([submit(id, body), submit(id, body)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
    assert.equal(responses[0].body.delivery_id, responses[1].body.delivery_id);
    assert.equal((await read(id)).deliveries.length, beforeN + 1); assert.equal((await task(id)).revision, body.expected_revision + 1);
  });
  await t.test('XX000 event insertion fault rolls back task state/approval/revision/goal; same intention retries successfully', async () => {
    const id = taskIds[0]; await patch(id, 'aprobada'); const body = await input(id), before = await snapshot();
    await fixture.query(`CREATE FUNCTION qa_delivery_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA delivery insertion failure' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER qa_delivery_fail BEFORE INSERT ON task_editing_deliveries FOR EACH ROW EXECUTE FUNCTION qa_delivery_fail()`);
    try { assert.equal((await submit(id, body)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('DROP TRIGGER qa_delivery_fail ON task_editing_deliveries; DROP FUNCTION qa_delivery_fail()'); }
    checked(await submit(id, body), 201);
  });
  await t.test('review/approval/finalization keeps delivery history and editorial unpublicized while goal legitimately completes', async () => {
    const id = taskIds[0], protectedBefore = await protectedState(id), eventsBefore = (await read(id)).deliveries;
    await patch(id, 'aprobada'); await patch(id, 'finalizada');
    const protectedAfter = await protectedState(id);
    // Generic workflow may refresh its notification marker; delivery submission
    // itself is checked above against the complete metadata snapshot.
    delete protectedAfter.props.mia_notificacion_pendiente;
    delete protectedBefore.props.mia_notificacion_pendiente;
    assert.deepEqual(protectedAfter, protectedBefore);
    const dto = await read(id); assert.equal(dto.task.estado, 'finalizada'); assert.equal(dto.can_deliver, false); assert.deepEqual(dto.deliveries, eventsBefore);
    const before = await snapshot(); assert.equal((await submit(id, await input(id))).status, 409); assert.deepEqual(await snapshot(), before);
    const replay = checked(await submit(id, original.body, original.token)); assert.equal(replay.replayed, true); assert.equal(replay.task.estado, 'finalizada');
    const [work] = await fixture.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1', [slot.id]);
    assert.equal(work.estado, 'finalizada'); assert.ok(work.completada_at);
    assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos WHERE dominio=\'publicacion\' AND pieza_id=$1', [publication.id]), []);
    await validate(await read(id, await login('qa_delivery_108001')), id);
  });
  await t.test('revoked membership/session/activity and current unsupported role deny even exact replay', async () => {
    const id = original.id;
    await fixture.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=108003', [id]);
    const before = await snapshot(); assert.equal((await submit(id, original.body, collaborator)).status, 403); assert.deepEqual(await snapshot(), before);
    const body = await input(taskIds[1]); checked(await submit(taskIds[1], body), 201);
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=108001');
    assert.equal((await submit(taskIds[1], body)).status, 401); editor = await login('qa_delivery_108001');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=108001');
    assert.equal((await submit(taskIds[1], body)).status, 401);
    await fixture.query("UPDATE usuarios SET activo=true,rol='qa_unknown' WHERE id=108001");
    assert.equal((await submit(taskIds[1], body)).status, 403);
    await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=108001"); editor = await login('qa_delivery_108001');
  });
  await t.test('persisted non-editing/private/archive/trash scope cannot be bypassed by IDs or admin', async () => {
    const id = taskIds[2];
    for (const [change, restore] of [
      ["tipo_tarea='diseno'", "tipo_tarea='edicion'"],
      ["propiedades_extra=propiedades_extra||'{\"workspace\":\"private\"}'", "propiedades_extra=propiedades_extra||'{\"workspace\":\"render_os\"}'"],
      ["propiedades_extra=propiedades_extra||'{\"archivada_render_os\":true}'", "propiedades_extra=propiedades_extra-'archivada_render_os'"],
      ["propiedades_extra=propiedades_extra||'{\"papelera_render_os\":true}'", "propiedades_extra=propiedades_extra-'papelera_render_os'"],
    ]) {
      await fixture.query(`UPDATE tareas SET ${change} WHERE id=$1`, [id]);
      try { const before = await snapshot(); for (const token of [admin, editor]) {
        assert.equal((await api(route(id), token)).status, 404); assert.equal((await submit(id, await input(id), token)).status, 404);
      } assert.deepEqual(await snapshot(), before); }
      finally { await fixture.query(`UPDATE tareas SET ${restore} WHERE id=$1`, [id]); }
    }
  });
  await t.test('immutable event and restrictive task deletion reject with exact SQL constraint and preserve all history', async () => {
    const [event] = await fixture.query('SELECT id,task_id FROM task_editing_deliveries ORDER BY recorded_at,id LIMIT 1');
    const reject = async (statement, state, constraint) => fixture.query(`DO $qa$ DECLARE actual text; BEGIN
      BEGIN ${statement}; RAISE EXCEPTION 'QA expected constraint' USING ERRCODE='XX000';
      EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS actual=CONSTRAINT_NAME;
        IF actual IS DISTINCT FROM '${constraint}' THEN RAISE EXCEPTION 'Wrong constraint: %',actual; END IF; END; END $qa$`);
    for (const statement of [`UPDATE task_editing_deliveries SET notes=notes WHERE id='${event.id}'`, `DELETE FROM task_editing_deliveries WHERE id='${event.id}'`]) {
      const before = await snapshot(); await reject(statement, '23514', 'task_editing_deliveries_immutable'); assert.deepEqual(await snapshot(), before);
    }
    const [standalone] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
      VALUES ('QA delivery restrictive task','QA fixture admin','edicion','pendiente','{"workspace":"render_os"}') RETURNING id`);
    checked(await submit(standalone.id, await input(standalone.id), admin), 201);
    const before = await snapshot();
    assert.equal((await api(`/tareas/${standalone.id}?workspace=render_os`, admin, 'DELETE')).status, 409);
    assert.deepEqual(await snapshot(), before);
    await reject(`DELETE FROM tareas WHERE id=${standalone.id}`, '23503', 'task_editing_deliveries_task_fk'); assert.deepEqual(await snapshot(), before);
  });
});
