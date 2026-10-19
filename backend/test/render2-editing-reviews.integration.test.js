import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const marker = 'QA_EDITING_REVIEWS_FINANCE_55625';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
test('durable editing decisions: concrete artifacts, current authority and atomic principal workflow', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55625, deferEditingReviewsMigration: true });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editing-reviews fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const api = (path, token = admin, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco');
  for (const [id, role] of [[113001, 'edicion'], [113002, 'edicion'], [113003, 'admin'], [113004, 'community']]) await fixture.query(`INSERT INTO usuarios
    (id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA same editing reviewer',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_review_${id}`, role]);
  const editor = await login('qa_review_113001'); const homonym = await login('qa_review_113002'); const secondAdmin = await login('qa_review_113003');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA durable reviews client') RETURNING id");
  let serial = 0;
  const taskRow = async id => (await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]))[0];
  const create = async (linked = false) => {
    const n = ++serial;
    const piece = linked ? (await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy)
      VALUES ($1,'video','lista','2026-10-29','QA preserve editorial copy') RETURNING id`, [client.id]))[0] : null;
    const task = checked(await api('/tareas', admin, 'POST', { titulo: `QA editing decision ${n}`, workspace: 'render_os', cliente_id: client.id,
      tipo_tarea: 'edicion', subtipo: 'video', asignado_a_id: 113001, colaborador_ids: [], fecha_vencimiento: '2026-10-25',
      material_referencia: 'https://example.invalid/raw-preserved', aclaraciones: 'QA original script', ...(piece ? { publicacion_id: piece.id } : {}),
    }), 201);
    await fixture.query('UPDATE tareas SET propiedades_extra=propiedades_extra||$2::jsonb WHERE id=$1', [task.id, JSON.stringify({
      guiones: 'QA original script', copy_trabajo: 'QA preserve editorial copy', private_finance: { amount: 745982.61, marker },
      edicion_responsable_id: 113001, qa_preserved_credit: 'historical editing credit',
    })]);
    if (piece) {
      const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
        VALUES ($1,'2026-10-01',$2,'QA durable review objective',1,0,'QA fixture') RETURNING id`, [`qa-review-${n}`, client.id]);
      await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy)
        VALUES ($1,'video',1,$2,$3,'QA decision work slot','QA preserve editorial copy')`, [goal.id, task.id, piece.id]);
    }
    return { id: task.id, pieceId: piece?.id ?? null };
  };
  const deliver = async id => {
    const body = { request_id: randomUUID(), expected_revision: (await taskRow(id)).revision,
      url: `https://example.invalid/review-artifact-${randomUUID()}`, notes: 'QA edited delivery' };
    const dto = checked(await api(`/tareas-edicion/${id}/entregas`, editor, 'POST', body), 201);
    return dto.delivery_id;
  };
  const read = async (id, token = admin) => checked(await api(`/tareas-edicion/${id}/revisiones`, token));
  const correctionBody = async (id, deliveryId, extra = {}) => ({ request_id: randomUUID(), expected_revision: (await taskRow(id)).revision,
    expected_entrega_id: deliveryId, notes: 'QA deliberate corrections', ...extra });
  const correct = (id, body, token = admin) => api(`/tareas-edicion/${id}/correcciones`, token, 'POST', body);
  const approve = async (id, deliveryId, mode = 'patch', revision, token = admin) => api(
    mode === 'patch' ? `/tareas/${id}?workspace=render_os` : `/tareas/${id}/aprobar-publicacion?workspace=render_os`, token,
    mode === 'patch' ? 'PATCH' : 'POST', { expected_revision: revision ?? (await taskRow(id)).revision,
      ...(mode === 'patch' ? { estado: 'aprobada' } : { responsable_publicacion_id: 113004 }),
      ...(deliveryId === undefined ? {} : { expected_entrega_id: deliveryId }) });
  const business = async (reviews = true) => {
    const result = {};
    for (const name of ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'task_editing_deliveries',
      ...(reviews ? ['task_editing_reviews'] : []), 'publicaciones', 'historias', 'cliente_objetivos_mensuales',
      'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'editorial_publicacion_eventos', 'editorial_publicacion_versiones'])
      result[name] = await fixture.query(`SELECT to_jsonb(r) AS row FROM ${name} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const invariant = async id => {
    const task = await taskRow(id);
    return { client: task.cliente_id, deadline: task.fecha_vencimiento, raw: task.material_referencia, script: task.aclaraciones,
      guiones: task.propiedades_extra.guiones, copy: task.propiedades_extra.copy_trabajo, credit: task.propiedades_extra.qa_preserved_credit,
      assignments: await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [id]),
      piece: task.publicacion_id ? await fixture.query('SELECT id,estado,"fecha_publicación_real",fecha_programada,copy FROM publicaciones WHERE id=$1', [task.publicacion_id]) : [],
    };
  };
  const validate = async (dto, id, writing = false) => {
    assert.deepEqual(Object.keys(dto).sort(), ['task', 'latest_delivery', 'decisions', 'total', 'truncated', 'can_request_corrections',
      ...(writing ? ['decision_id', 'replayed'] : [])].sort());
    assert.deepEqual(Object.keys(dto.task).sort(), ['id', 'revision', 'estado'].sort());
    const task = await taskRow(id); assert.deepEqual(dto.task, { id, revision: task.revision, estado: task.estado });
    const deliveries = await fixture.query(`SELECT id,task_id,actor_id,task_revision,url,notes,recorded_at FROM task_editing_deliveries
      WHERE task_id=$1 ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1`, [id]);
    assert.deepEqual(dto.latest_delivery, deliveries.length ? { ...deliveries[0], recorded_at: new Date(deliveries[0].recorded_at).toISOString() } : null);
    const rows = await fixture.query(`SELECT * FROM (SELECT id,task_id,delivery_id,actor_id,action,task_revision,notes,recorded_at
      FROM task_editing_reviews WHERE task_id=$1 ORDER BY task_revision DESC,id DESC LIMIT 200) recent ORDER BY task_revision,id`, [id]);
    assert.deepEqual(dto.decisions, rows.map(row => ({ ...row, recorded_at: new Date(row.recorded_at).toISOString() })));
    for (const row of dto.decisions) assert.deepEqual(Object.keys(row).sort(), ['id', 'task_id', 'delivery_id', 'actor_id', 'action', 'task_revision', 'notes', 'recorded_at'].sort());
    assert.equal(dto.total, (await fixture.query('SELECT count(*)::int AS n FROM task_editing_reviews WHERE task_id=$1', [id]))[0].n);
    assert.equal(dto.truncated, dto.total > 200); assert.equal(typeof dto.can_request_corrections, 'boolean');
    assert.ok(!JSON.stringify(dto).includes(marker)); assert.ok(!JSON.stringify(dto).includes('745982.61'));
  };
  const historical = await create(true);
  const oldDeliveryId = await deliver(historical.id);
  await fixture.query(`UPDATE tareas SET estado='aprobada',propiedades_extra=propiedades_extra||jsonb_build_object(
    'revision_aprobada',true,'revision_aprobada_por_id',91001,'revision_aprobada_entrega_id',$2::text) WHERE id=$1`, [historical.id, oldDeliveryId]);
  await t.test('068 populated067 upgrade preserves tasks/065 deliveries/066 approvals/goal/editorial rows without inferred decisions', async () => {
    assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE nombre='067_auth_login_buckets.sql'"), [{ nombre: '067_auth_login_buckets.sql' }]);
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^068_.*\.sql$/.test(name)); assert.equal(files.length, 1);
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [files[0]]), []);
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.task_editing_reviews') AS relation"), [{ relation: null }]);
    const before = await business(false); await fixture.query(await readFile(new URL(`../migrations/${files[0]}`, import.meta.url), 'utf8'));
    assert.deepEqual(await business(false), before); assert.deepEqual(await fixture.query('SELECT * FROM task_editing_reviews'), []);
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [files[0]]);
    const status = await read(historical.id); assert.deepEqual(status.decisions, []); assert.equal(status.latest_delivery.id, oldDeliveryId);
  });
  for (const mode of ['patch', 'publisher']) await t.test(`${mode}: approval ledger→resubmit→corrections→new delivery→approval/finalize persists without publication`, async () => {
    const task = await create(true), first = await deliver(task.id);
    checked(await approve(task.id, first, mode));
    let dto = await read(task.id); await validate(dto, task.id); assert.equal(dto.decisions.length, 1);
    assert.equal(dto.decisions[0].action, 'aprobada'); assert.equal(dto.decisions[0].delivery_id, first); assert.equal(dto.decisions[0].notes, '');
    const rejected = await business(); assert.equal((await correct(task.id, await correctionBody(task.id, first))).status, 409); assert.deepEqual(await business(), rejected);
    const second = await deliver(task.id); const body = await correctionBody(task.id, second, { notes: '  QA deliberate corrections  ' });
    const protectedBefore = await invariant(task.id);
    const corrected = checked(await correct(task.id, body), 201); await validate(corrected, task.id, true);
    assert.equal(corrected.task.estado, 'en_progreso'); assert.equal(corrected.replayed, false);
    assert.equal(corrected.decisions.at(-1).notes, 'QA deliberate corrections'); assert.equal(corrected.decisions.at(-1).action, 'correcciones');
    assert.equal((await taskRow(task.id)).propiedades_extra.revision_aprobada_entrega_id ?? null, null);
    assert.deepEqual(await invariant(task.id), protectedBefore, 'Correction never silently reassigns publisher/editor or changes piece/date/raw content');
    const third = await deliver(task.id);
    const beforeReplay = await business(); const replay = checked(await correct(task.id, body));
    assert.equal(replay.replayed, true); assert.equal(replay.decision_id, corrected.decision_id); assert.equal(replay.latest_delivery.id, third);
    assert.deepEqual(await business(), beforeReplay);
    checked(await approve(task.id, third, mode));
    const countBeforeNoop = (await read(task.id)).total;
    checked(await approve(task.id, third, 'patch')); assert.equal((await read(task.id)).total, countBeforeNoop, 'Approved-state no-op adds no artifact decision');
    checked(await api(`/tareas/${task.id}?workspace=render_os`, admin, 'PATCH', { estado: 'finalizada', expected_revision: (await taskRow(task.id)).revision }));
    dto = await read(task.id, await login('qa_review_113001')); await validate(dto, task.id);
    assert.deepEqual(dto.decisions.map(row => row.action), ['aprobada', 'correcciones', 'aprobada']);
    assert.equal(dto.task.estado, 'finalizada'); assert.equal(dto.can_request_corrections, false);
    const finalizedBefore = await business();
    assert.equal((await correct(task.id, await correctionBody(task.id, third))).status, 409);
    assert.deepEqual(await business(), finalizedBefore);
    assert.deepEqual(await invariant(task.id), protectedBefore);
    assert.deepEqual(await fixture.query("SELECT * FROM editorial_publicacion_eventos WHERE dominio='publicacion' AND pieza_id=$1", [task.pieceId]), []);
  });
  await t.test('corrections require exact latest/current CAS; generic invalid input and homonyms never gain authority', async () => {
    const task = await create(), first = await deliver(task.id), staleRevision = (await taskRow(task.id)).revision;
    const latest = await deliver(task.id), foreignTask = await create(), foreign = await deliver(foreignTask.id);
    const body = await correctionBody(task.id, latest);
    for (const invalid of [{ ...body, notes: '' }, { ...body, notes: ' ' }, { ...body, notes: 'a\0b' }, { ...body, notes: 'x'.repeat(4001) },
      { ...body, actor_id: 91001 }, { ...body, expected_entrega_id: 'bad' }, { ...body, expected_revision: 0 }, { ...body, request_id: 'bad' }]) {
      const before = await business(); assert.equal((await correct(task.id, invalid)).status, 400); assert.deepEqual(await business(), before);
    }
    for (const invalid of [{ ...body, expected_entrega_id: first }, { ...body, expected_entrega_id: foreign }, { ...body, expected_revision: staleRevision }]) {
      const before = await business(); assert.equal((await correct(task.id, invalid)).status, 409); assert.deepEqual(await business(), before);
    }
    for (const token of [editor, homonym]) {
      const before = await business(); assert.equal((await correct(task.id, body, token)).status, 403); assert.deepEqual(await business(), before);
      const shared = await read(task.id, token); await validate(shared, task.id); assert.equal(shared.can_request_corrections, false);
    }
    assert.equal((await api(`/tareas-edicion/${task.id}/revisiones?limit=1`)).status, 400);
    for (const id of ['0', '01', '1x', '2147483648']) assert.equal((await api(`/tareas-edicion/${id}/revisiones`)).status, 400);
    assert.equal((await request(fixture.base, `/api/tareas-edicion/${task.id}/revisiones`)).status, 401);
  });
  await t.test('exact concurrent correction retries201+200 once; changed intent conflicts and another admin key is independent', async () => {
    const task = await create(), version = await deliver(task.id), body = await correctionBody(task.id, version);
    const responses = await Promise.all([correct(task.id, body), correct(task.id, body)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]); assert.equal(responses[0].body.decision_id, responses[1].body.decision_id);
    assert.equal((await read(task.id)).total, 1); assert.equal((await taskRow(task.id)).revision, body.expected_revision + 1);
    const before = await business(); assert.equal((await correct(task.id, { ...body, notes: 'Changed meaning' })).status, 409); assert.deepEqual(await business(), before);
    const other = await create(), otherVersion = await deliver(other.id);
    assert.equal((await correct(other.id, { ...await correctionBody(other.id, otherVersion), request_id: body.request_id })).status, 409);
    checked(await correct(other.id, { ...await correctionBody(other.id, otherVersion), request_id: body.request_id }, secondAdmin), 201);
  });
  for (const mode of ['patch', 'publisher']) await t.test(`${mode}: approval/correction same-CAS race commits one concrete decision only`, async () => {
    const task = await create(true), version = await deliver(task.id), body = await correctionBody(task.id, version);
    const results = await Promise.all([approve(task.id, version, mode, body.expected_revision), correct(task.id, body)]);
    const current = await taskRow(task.id), history = await read(task.id); await validate(history, task.id);
    assert.equal(current.revision, body.expected_revision + 1); assert.equal(history.total, 1);
    if (results[0].status === 200) {
      assert.equal(results[1].status, 409); assert.equal(current.estado, 'aprobada'); assert.equal(history.decisions[0].action, 'aprobada');
    } else {
      assert.equal(results[0].status, 409); checked(results[1], 201); assert.equal(current.estado, 'en_progreso'); assert.equal(history.decisions[0].action, 'correcciones');
    }
  });
  await t.test('new delivery/correction race cannot record a decision against an unseen version', async () => {
    const task = await create(), version = await deliver(task.id), body = await correctionBody(task.id, version);
    const result = await Promise.all([api(`/tareas-edicion/${task.id}/entregas`, editor, 'POST', {
      request_id: randomUUID(), expected_revision: body.expected_revision, url: 'https://example.invalid/racing-new-version', notes: 'QA new artifact',
    }), correct(task.id, body)]);
    assert.deepEqual(result.map(row => row.status).sort(), [201, 409]); assert.equal((await taskRow(task.id)).revision, body.expected_revision + 1);
    const status = await read(task.id); await validate(status, task.id);
    if (result[0].status === 201) { assert.equal(status.total, 0); assert.notEqual(status.latest_delivery.id, version); }
    else { assert.equal(status.total, 1); assert.equal(status.decisions[0].delivery_id, version); assert.equal(status.task.estado, 'en_progreso'); }
  });
  await t.test('unexpected review INSERT faults500 roll back both approval entrypoints and correction including goal/assignment writes', async () => {
    for (const mode of ['patch', 'publisher', 'correction']) {
      const task = await create(true), version = await deliver(task.id), body = await correctionBody(task.id, version), before = await business();
      await fixture.query(`CREATE FUNCTION qa_review_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'QA review insert fault' USING ERRCODE='XX000'; END $$;
        CREATE TRIGGER qa_review_fault BEFORE INSERT ON task_editing_reviews FOR EACH ROW EXECUTE FUNCTION qa_review_fault()`);
      try {
        assert.equal((await (mode === 'correction' ? correct(task.id, body) : approve(task.id, version, mode, body.expected_revision))).status, 500);
        assert.deepEqual(await business(), before);
      } finally { await fixture.query('DROP TRIGGER qa_review_fault ON task_editing_reviews; DROP FUNCTION qa_review_fault()'); }
      if (mode === 'correction') checked(await correct(task.id, body), 201); else checked(await approve(task.id, version, mode, body.expected_revision));
    }
  });
  await t.test('legacy zero-delivery approval is not reconstructed as an artifact decision', async () => {
    for (const mode of ['patch', 'publisher']) {
      const task = await create(); checked(await api(`/tareas/${task.id}?workspace=render_os`, editor, 'PATCH', { estado: 'en_revision', expected_revision: (await taskRow(task.id)).revision }));
      checked(await approve(task.id, undefined, mode)); const dto = await read(task.id); await validate(dto, task.id);
      assert.equal(dto.latest_delivery, null); assert.deepEqual(dto.decisions, []); assert.equal(dto.total, 0); assert.equal(dto.can_request_corrections, false);
    }
  });
  await t.test('read latest200 decisions in revision order with explicit total/truncation and closed all-role privacy', async () => {
    const task = await create();
    const [delivery] = await fixture.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes,recorded_at)
      VALUES ($1,$2,113001,$3,$4,1,'https://example.invalid/history-version-1','QA old artifact','2026-09-02T12:00:00Z') RETURNING id`, [randomUUID(), task.id, randomUUID(), 'd'.repeat(64)]);
    const [latest] = await fixture.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes,recorded_at)
      VALUES ($1,$2,113001,$3,$4,2,'https://example.invalid/history-version-2','QA newer revision older timestamp','2026-09-01T12:00:00Z') RETURNING id`, [randomUUID(), task.id, randomUUID(), 'e'.repeat(64)]);
    // Bounded fixture-only history, not an application backfill or inferred decision.
    await fixture.query(`DO $qa$ BEGIN FOR i IN 1..202 LOOP UPDATE tareas SET titulo=titulo WHERE id=${task.id}; END LOOP; END $qa$`);
    await fixture.query(`INSERT INTO task_editing_reviews(id,task_id,delivery_id,actor_id,action,task_revision,notes,recorded_at,request_id,payload_hash)
      SELECT md5('qa_review_id:'||g)::uuid,$1,$2,91001,'correcciones',g+2,'QA synthetic bounded history',
        clock_timestamp(),md5('qa_review_request:'||g)::uuid,repeat('a',64) FROM generate_series(1,201) g`, [task.id, latest.id]);
    const before = await business();
    for (const token of [admin, editor, homonym, secondAdmin]) {
      const dto = await read(task.id, token); await validate(dto, task.id);
      assert.equal(dto.total, 201); assert.equal(dto.truncated, true); assert.equal(dto.decisions.length, 200);
      assert.equal(dto.decisions[0].task_revision, 4); assert.equal(dto.decisions.at(-1).task_revision, 203);
      assert.equal(dto.latest_delivery.id, latest.id); assert.notEqual(dto.latest_delivery.id, delivery.id);
    }
    assert.deepEqual(await business(), before);
  });
  await t.test('current admin/session and archived/private/wrong-sector/inactive scope are checked before replay', async () => {
    const task = await create(), version = await deliver(task.id), body = await correctionBody(task.id, version);
    checked(await correct(task.id, body, secondAdmin), 201);
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=113003');
    assert.equal((await correct(task.id, body, secondAdmin)).status, 401);
    const renewed = await login('qa_review_113003'); await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=113003");
    assert.equal((await correct(task.id, body, renewed)).status, 403);
    await fixture.query("UPDATE usuarios SET rol='admin',activo=false WHERE id=113003"); assert.equal((await correct(task.id, body, renewed)).status, 401);
    await fixture.query('UPDATE usuarios SET activo=true WHERE id=113003');
    for (const [change, restore] of [
      ["tipo_tarea='diseno'", "tipo_tarea='edicion'"],
      ["propiedades_extra=propiedades_extra||'{\"workspace\":\"private\"}'", "propiedades_extra=propiedades_extra||'{\"workspace\":\"render_os\"}'"],
      ["propiedades_extra=propiedades_extra||'{\"archivada_render_os\":true}'", "propiedades_extra=propiedades_extra-'archivada_render_os'"],
      ["propiedades_extra=propiedades_extra||'{\"papelera_render_os\":true}'", "propiedades_extra=propiedades_extra-'papelera_render_os'"],
    ]) {
      await fixture.query(`UPDATE tareas SET ${change} WHERE id=$1`, [task.id]);
      try { const before = await business(); assert.equal((await api(`/tareas-edicion/${task.id}/revisiones`)).status, 404);
        assert.equal((await correct(task.id, body, await login('qa_review_113003'))).status, 404); assert.deepEqual(await business(), before); }
      finally { await fixture.query(`UPDATE tareas SET ${restore} WHERE id=$1`, [task.id]); }
    }
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]);
    try { assert.equal((await api(`/tareas-edicion/${task.id}/revisiones`)).status, 404); }
    finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]); }
  });
  await t.test('immutable decision SQL and cross-task delivery FK reject without modifying historical rows', async () => {
    const first = await create(), firstVersion = await deliver(first.id), body = await correctionBody(first.id, firstVersion);
    const accepted = checked(await correct(first.id, body), 201);
    const reject = async (statement, state, exactConstraint) => fixture.query(`DO $qa$ DECLARE actual text; BEGIN BEGIN
      ${statement}; RAISE EXCEPTION 'QA expected rejection' USING ERRCODE='XX000';
      EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS actual=CONSTRAINT_NAME;
      IF ${exactConstraint ? `actual IS DISTINCT FROM '${exactConstraint}'` : "actual NOT LIKE 'task_editing_reviews_%'"} THEN RAISE EXCEPTION 'Wrong review constraint: %',actual; END IF;
      END; END $qa$`);
    for (const statement of [`UPDATE task_editing_reviews SET notes=notes WHERE id='${accepted.decision_id}'`, `DELETE FROM task_editing_reviews WHERE id='${accepted.decision_id}'`]) {
      const before = await business(); await reject(statement, '23514', 'task_editing_reviews_immutable'); assert.deepEqual(await business(), before);
    }
    const foreign = await create(), foreignVersion = await deliver(foreign.id), before = await business();
    await reject(`INSERT INTO task_editing_reviews(id,task_id,delivery_id,actor_id,action,task_revision,notes,request_id,payload_hash)
      VALUES ('${randomUUID()}',${first.id},'${foreignVersion}',91001,'correcciones',999,'QA wrong task tuple','${randomUUID()}',repeat('a',64))`, '23503', 'task_editing_reviews_delivery_fk');
    assert.deepEqual(await business(), before);
    const [event] = await fixture.query('SELECT id FROM task_editing_reviews WHERE id=$1', [accepted.decision_id]); assert.match(event.id, uuid);
  });
});
