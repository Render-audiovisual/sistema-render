import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('project deliverable approvals bind observed content, preserve historical receipts and never resurrect on ABA', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55735 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55735,
    url: 'postgresql://render2_fixture@127.0.0.1:55735/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status,
    `Unexpected principal HTTP status${typeof response.body?.error === 'string' ? ': ' + response.body.error.slice(0, 250) : ''}`); return response.body; };
  const login = async usuario => {
    const result = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const admin = await login('qa_franco'); let secondAdmin = await login('qa_agustin');
  let responsible = await login('qa_luciano'); const homonym = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA103 deliverable client',true) RETURNING id");
  const project = ok(await api('/proyectos', admin, 'POST', { request_id: randomUUID(), titulo: 'QA103 canonical project',
    cliente_id: client.id, responsable_id: 91003, tipo: 'web', descripcion: 'Independent versioned review',
    fecha_inicio: '2026-10-01', fecha_entrega: '2026-11-01', miembro_ids: [91004] }), 201).proyecto;
  const read = async (token = responsible) => ok(await api(`/proyectos/${project.id}`, token)).proyecto;
  const endpoint = id => `/proyectos/${project.id}/entregables/${id}`;
  const create = async title => {
    const current = await read();
    const result = ok(await api(`/proyectos/${project.id}/entregables`, responsible, 'POST', {
      request_id: randomUUID(), expected_revision: current.revision, titulo: title, url: 'https://example.invalid/qa103-a', observaciones: 'Original observed content',
    }), 201).proyecto;
    return result.entregables.find(row => row.titulo === title);
  };
  const selection = async (id, token = responsible) => {
    const current = await read(token), row = current.entregables.find(item => item.id === id); assert.ok(row);
    assert.match(row.contenido_hash, /^[0-9a-f]{64}$/);
    return { request_id: randomUUID(), expected_revision: current.revision,
      expected_entregable_revision: row.entregable_revision, expected_content_revision: row.contenido_revision,
      expected_content_hash: row.contenido_hash };
  };
  const approve = (id, body, token = responsible) => api(`${endpoint(id)}/aprobaciones`, token, 'POST', body);
  const edit = async (id, changes, token = responsible) => {
    const current = await read(token);
    return ok(await api(endpoint(id), token, 'PATCH', { expected_revision: current.revision, ...changes })).proyecto;
  };
  const tables = ['proyectos', 'proyecto_miembros', 'proyecto_etapas', 'proyecto_hitos', 'proyecto_entregables',
    'proyecto_tareas', 'proyecto_actividad', 'proyecto_entregable_aprobaciones', 'tareas', 'tarea_asignaciones',
    'tarea_comentarios', 'task_editing_deliveries', 'task_editing_reviews', 'publicaciones', 'historias',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'editorial_publicacion_versiones', 'editorial_publicacion_eventos'];
  const snapshot = async () => {
    const result = {};
    for (const name of tables) result[name] = await f.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const businessBefore = await snapshot();
  const evidence = () => f.query('SELECT * FROM proyecto_entregable_aprobaciones ORDER BY id');
  const assertApproval = (result, id, input, replayed) => {
    assert.deepEqual(Object.keys(result).sort(), ['aprobacion', 'proyecto', 'replayed']);
    assert.equal(result.replayed, replayed);
    assert.deepEqual(Object.keys(result.aprobacion).sort(), ['id', 'entregable_id', 'contenido_revision',
      'entregable_revision', 'contenido_hash', 'actor_id', 'aprobado_at'].sort());
    assert.equal(result.aprobacion.entregable_id, id);
    assert.equal(result.aprobacion.contenido_hash, input.expected_content_hash);
    assert.equal(result.aprobacion.contenido_revision, input.expected_content_revision);
    assert.equal(result.aprobacion.entregable_revision, input.expected_entregable_revision + 1);
  };
  let deliverable, firstInput, firstReceipt;

  await t.test('generic create/PATCH cannot approve; explicit observed approval creates exact versioned evidence', async () => {
    deliverable = await create('QA103 content lifecycle');
    const current = await read(), before = await snapshot();
    ok(await api(`/proyectos/${project.id}/entregables`, responsible, 'POST', {
      request_id: randomUUID(), expected_revision: current.revision, titulo: 'Do not create approved', estado: 'aprobado' }), 400);
    ok(await api(endpoint(deliverable.id), responsible, 'PATCH', { expected_revision: current.revision, estado: 'aprobado' }), 400);
    assert.deepEqual(await snapshot(), before);
    firstInput = await selection(deliverable.id);
    const result = ok(await approve(deliverable.id, firstInput), 201); assertApproval(result, deliverable.id, firstInput, false);
    firstReceipt = result.aprobacion;
    const row = result.proyecto.entregables.find(item => item.id === deliverable.id);
    assert.equal(row.estado, 'aprobado'); assert.equal(row.aprobacion_versionada, true);
    assert.equal(row.aprobacion_actual_id, firstReceipt.id); assert.equal(row.aprobado_por_id, 91003);
    const saved = (await evidence()).find(item => item.id === firstReceipt.id);
    assert.equal(saved.url, deliverable.url); assert.equal(saved.titulo, deliverable.titulo);
    assert.equal(saved.observaciones, deliverable.observaciones);
  });

  await t.test('no-op content preserves proof; each material field edit invalidates without rewriting prior evidence', async () => {
    const receipts = await evidence();
    let result = await edit(deliverable.id, { titulo: deliverable.titulo });
    let row = result.entregables.find(item => item.id === deliverable.id);
    assert.equal(row.aprobacion_versionada, true); assert.equal(row.aprobacion_actual_id, firstReceipt.id);
    for (const changes of [{ url: 'https://example.invalid/qa103-b' }, { observaciones: 'New observed notes' }, { titulo: 'QA103 revised title' }]) {
      const previous = (await read()).entregables.find(item => item.id === deliverable.id);
      const oldEvidence = await evidence(); result = await edit(deliverable.id, changes);
      row = result.entregables.find(item => item.id === deliverable.id);
      assert.equal(row.estado, 'en_revision'); assert.equal(row.aprobacion_versionada, false);
      assert.equal(row.aprobacion_actual_id, null); assert.equal(row.aprobado_por_id, null); assert.equal(row.aprobado_at, null);
      assert.equal(row.contenido_revision, previous.contenido_revision + 1);
      assert.ok(row.entregable_revision > previous.entregable_revision);
      assert.deepEqual(await evidence(), oldEvidence);
      const input = await selection(deliverable.id); assertApproval(ok(await approve(deliverable.id, input), 201), deliverable.id, input, false);
    }
    for (const original of receipts) assert.deepEqual((await evidence()).find(item => item.id === original.id), original);
  });

  await t.test('ABA content revert never resurrects old proof and old receipt replay cannot reapply approval', async () => {
    await edit(deliverable.id, { titulo: deliverable.titulo, url: deliverable.url, observaciones: deliverable.observaciones });
    const row = (await read()).entregables.find(item => item.id === deliverable.id);
    assert.equal(row.contenido_hash, firstInput.expected_content_hash);
    assert.ok(row.contenido_revision > firstInput.expected_content_revision);
    assert.equal(row.estado, 'en_revision'); assert.equal(row.aprobacion_versionada, false);
    const before = await snapshot();
    const replay = ok(await approve(deliverable.id, firstInput)); assertApproval(replay, deliverable.id, firstInput, true);
    assert.deepEqual(replay.aprobacion, firstReceipt);
    assert.equal(replay.proyecto.entregables.find(item => item.id === deliverable.id).aprobacion_versionada, false);
    assert.deepEqual(await snapshot(), before);
    ok(await approve(deliverable.id, { ...firstInput, expected_content_revision: firstInput.expected_content_revision + 1 }), 409);
    assert.deepEqual(await snapshot(), before);
    const fresh = await selection(deliverable.id); assertApproval(ok(await approve(deliverable.id, fresh), 201), deliverable.id, fresh, false);
  });

  await t.test('status ABA preserves content version but invalidates observed deliverable version; replay never reactivates approval', async () => {
    const item = await create('QA103 status ABA');
    const approvedInput = await selection(item.id);
    const approvedResult = ok(await approve(item.id, approvedInput), 201);
    assertApproval(approvedResult, item.id, approvedInput, false);
    const observed = await selection(item.id);
    const originalEvidence = await evidence();
    await edit(item.id, { estado: 'correcciones' });
    await edit(item.id, { estado: 'en_revision' });
    const current = await read(), row = current.entregables.find(value => value.id === item.id);
    assert.equal(row.contenido_hash, observed.expected_content_hash);
    assert.equal(row.contenido_revision, observed.expected_content_revision);
    assert.ok(row.entregable_revision > observed.expected_entregable_revision);
    assert.equal(row.estado, 'en_revision'); assert.equal(row.aprobacion_versionada, false);
    assert.equal(row.aprobacion_actual_id, null);
    const before = await snapshot();
    // Refresh only the project CAS here to independently exercise the stale
    // deliverable revision, rather than failing merely on old parent CAS.
    ok(await approve(item.id, { ...observed, request_id: randomUUID(), expected_revision: current.revision }), 409);
    assert.deepEqual(await snapshot(), before);
    const replay = ok(await approve(item.id, approvedInput));
    assertApproval(replay, item.id, approvedInput, true);
    assert.deepEqual(replay.aprobacion, approvedResult.aprobacion);
    const visible = replay.proyecto.entregables.find(value => value.id === item.id);
    assert.equal(visible.estado, 'en_revision'); assert.equal(visible.aprobacion_versionada, false);
    assert.equal(visible.aprobacion_actual_id, null);
    assert.deepEqual(await evidence(), originalEvidence); assert.deepEqual(await snapshot(), before);
  });

  await t.test('independent stale approvals have one CAS winner; identical concurrent requests have one durable receipt', async () => {
    const item = await create('QA103 concurrency');
    const a = await selection(item.id), b = { ...a, request_id: randomUUID() };
    const results = await Promise.all([approve(item.id, a), approve(item.id, b, admin)]);
    assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
    const another = await create('QA103 identical receipt'); const input = await selection(another.id);
    const before = await evidence(), responses = await Promise.all([approve(another.id, input), approve(another.id, input)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]);
    assert.equal(responses[0].body.aprobacion.id, responses[1].body.aprobacion.id);
    assert.equal((await evidence()).length, before.length + 1);
  });

  await t.test('late activity INSERT fault rolls back receipt, approval pointer and project revision; exact retry succeeds', async () => {
    const item = await create('QA103 rollback'), input = await selection(item.id), before = await snapshot();
    await f.query(`CREATE FUNCTION qa103_approval_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA103 synthetic approval activity failure'; END $$`);
    try {
      await f.query('CREATE TRIGGER qa103_approval_fault BEFORE INSERT ON proyecto_actividad FOR EACH ROW EXECUTE FUNCTION qa103_approval_fault()');
      try { ok(await approve(item.id, input), 500); assert.deepEqual(await snapshot(), before); }
      finally { await f.query('DROP TRIGGER qa103_approval_fault ON proyecto_actividad'); }
    } finally { await f.query('DROP FUNCTION qa103_approval_fault()'); }
    assertApproval(ok(await approve(item.id, input), 201), item.id, input, false);
  });

  await t.test('receipt snapshots are immutable; fresh login reads exact persisted approval without financial/evidence bags', async () => {
    const before = await snapshot();
    await assert.rejects(f.query("UPDATE proyecto_entregable_aprobaciones SET titulo='Rewrite forbidden' WHERE id=$1", [firstReceipt.id]));
    await assert.rejects(f.query('DELETE FROM proyecto_entregable_aprobaciones WHERE id=$1', [firstReceipt.id]));
    assert.deepEqual(await snapshot(), before);
    const fresh = await read(await login('qa_luciano'));
    const row = fresh.entregables.find(item => item.id === deliverable.id);
    assert.equal(row.aprobacion_versionada, true); assert.equal(row.estado, 'aprobado');
    for (const key of ['password_hash', 'payload_hash', 'request_id', 'metadata', 'importe', 'abono_mensual']) assert.equal(Object.hasOwn(row, key), false);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('homonymous/member identity has no approval power; responsibility removal and current admin downgrade deny replay', async () => {
    await f.query("UPDATE usuarios SET nombre='QA103 same visible name' WHERE id IN (91003,91004)");
    responsible = await login('qa_luciano');
    let before = await snapshot(); ok(await approve(deliverable.id, firstInput, homonym), 403); assert.deepEqual(await snapshot(), before);
    const current = await read(admin);
    ok(await api(`/proyectos/${project.id}`, admin, 'PATCH', { expected_revision: current.revision, responsable_id: 91004 }));
    before = await snapshot(); ok(await approve(deliverable.id, firstInput, responsible), 403); assert.deepEqual(await snapshot(), before);
    // Admin's own genuine receipt remains subject to present authority on replay.
    const observed = await read(admin), row = observed.entregables.find(item => item.id === deliverable.id);
    const input = { request_id: randomUUID(), expected_revision: observed.revision,
      expected_entregable_revision: row.entregable_revision, expected_content_revision: row.contenido_revision, expected_content_hash: row.contenido_hash };
    ok(await approve(deliverable.id, input, secondAdmin), 201);
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    try { before = await snapshot(); ok(await approve(deliverable.id, input, secondAdmin), 403); assert.deepEqual(await snapshot(), before); }
    finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    secondAdmin = await login('qa_agustin');
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    before = await snapshot(); ok(await approve(deliverable.id, input, secondAdmin), 401);
    ok(await approve(deliverable.id, input, null), 401); assert.deepEqual(await snapshot(), before);
  });

  await t.test('entire approval lifecycle leaves task/editorial/publication business rows unchanged', async () => {
    const after = await snapshot();
    for (const name of tables.filter(name => !name.startsWith('proyecto'))) assert.deepEqual(after[name], businessBefore[name], name);
  });
});
