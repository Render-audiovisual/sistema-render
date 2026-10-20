import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Backend service readiness only. Actual /german cutover/browser verification is
// Main-owned; this test neither retires a router nor migrates legacy production.
test('production home consolidation HTTP: stable-ID board, recorded context, coordination CAS and work completion', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55660 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-home fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55660,
    url: 'postgresql://render2_fixture@127.0.0.1:55660/render2_local_test', identity });
  const [dates] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba'),'YYYY-MM-DD') AS first`);
  const ids = { owner: 99201, homonym: 99202 };
  for (const [name, id] of Object.entries(ids)) {
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA Production Homonym','produccion',password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [id, `qa_production_home_${name}`]);
    assert.deepEqual(inserted, [{ id }]);
  }
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Production Home client',true) RETURNING id,nombre");
  const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea)
    VALUES ($1,'video','lista',$2,'QA unrelated editorial piece') RETURNING id`, [client.id, dates.first]);
  const legacy = { material: 'Material histórico\nhttps://example.invalid/legacy-material',
    Material: 'Referencia histórica adicional', feedback: 'Feedback histórico\nConservar encuadre y audio.',
    motivo_bloqueo: 'Cliente todavía no confirmó el horario.', horario: 'Horario histórico libre', coordinada: false,
    clickup_lista: 'Producción histórica', qa_history_sentinel: { nested: ['preserve', 19] } };
  const seed = async ({ owner = ids.owner, collaborators = [], type = 'produccion', state = 'pendiente',
    label = 'Legacy Other Person', workspace = 'render_os', linked = null } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      publicacion_id,fecha_vencimiento,material_referencia,aclaraciones,propiedades_extra)
      VALUES ($1,$2,$3,$4,'coordinacion',$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
    [`QA production coordination ${state}`, label, state, type, client.id, linked, dates.first,
      'https://example.invalid/root-material', 'Indicaciones raíz históricas sin reinterpretar',
      JSON.stringify({ workspace, ...legacy })]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    for (const id of [...new Set(collaborators)].filter(id => id !== owner))
      await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'colaborador')", [row.id, id]);
    return row.id;
  };
  const owned = await seed({ state: 'aprobada', linked: piece.id });
  const collaborative = await seed({ owner: ids.homonym, collaborators: [ids.owner, ids.owner] });
  const foreign = await seed({ owner: ids.homonym, label: 'QA Production Homonym' });
  const nameOnly = await seed({ owner: null, label: 'QA Production Homonym' });
  const otherSector = await seed({ type: 'edicion' });
  const historical = await seed({ workspace: 'historical' });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(body.token); return body.token;
  };
  const admin = await login('qa_franco');
  let ownerToken = await login('qa_production_home_owner');
  const homonymToken = await login('qa_production_home_homonym');
  const detail = (id, token = ownerToken) => api(`/tareas/${id}?workspace=render_os`, { token });
  const patch = (id, token, body) => api(`/tareas/${id}?workspace=render_os`, { token, method: 'PATCH', body });
  const board = async (id, token, expectedIds) => {
    const result = expect(await api(`/tareas?workspace=render_os&asignado_a_id=${id}&tipo_tarea=produccion&limit=100&offset=0`, { token }));
    assert.deepEqual(result.map(row => row.id), [...expectedIds].sort((a, b) => b - a), 'All dates tie: current board order is ID DESC');
    assert.equal(new Set(result.map(row => row.id)).size, result.length);
    return result;
  };
  const monthly = async (token, total, completed) => {
    const data = expect(await api(`/inicio/produccion-mensual?period=${dates.period}&limit=50&offset=0`, { token }));
    assert.deepEqual({ total: data.total, completed: data.completed, client_count: data.client_count, clients: data.clients }, {
      total, completed, client_count: 1, clients: [{ client, total, completed }],
    });
    const home = expect(await api('/inicio', { token }));
    assert.deepEqual(home.monthly_progress.production, { total, completed, client_count: 1, clients: [{ client, total, completed }] });
    return data;
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['tareas', 'tarea_asignaciones', 'historias', 'publicaciones', 'produccion_visitas',
      'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const raw = async id => (await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]))[0];
  const context = data => {
    assert.equal(data.material_referencia, 'https://example.invalid/root-material');
    assert.equal(data.aclaraciones, 'Indicaciones raíz históricas sin reinterpretar');
    for (const key of ['material', 'Material', 'feedback', 'motivo_bloqueo']) assert.equal(data.propiedades_extra[key], legacy[key]);
  };
  await t.test('current-ID board and monthly counts use owner/collaborator bindings, never names or other sectors', async () => {
    const before = await snapshot();
    const own = await board(ids.owner, ownerToken, [owned, collaborative]);
    const other = await board(ids.homonym, homonymToken, [collaborative, foreign]);
    assert.equal(own.find(row => row.id === owned).asignado_a, 'Legacy Other Person');
    assert.ok(own.find(row => row.id === collaborative).colaborador_ids.includes(ids.owner));
    for (const id of [foreign, nameOnly, otherSector, historical]) assert.ok(!own.some(row => row.id === id));
    assert.notDeepEqual(own.map(row => row.id), other.map(row => row.id));
    ownerToken = await login('qa_production_home_owner');
    await board(ids.owner, ownerToken, [owned, collaborative]);
    const loaded = expect(await detail(owned)); context(loaded);
    assert.equal(loaded.estado, 'aprobada'); assert.equal(loaded.propiedades_extra.horario, legacy.horario);
    assert.equal(loaded.propiedades_extra.coordinada, false);
    await monthly(ownerToken, 2, 0); await monthly(homonymToken, 2, 0);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('owner coordination CAS persists exact recorded context; stale revision and homonymous nonmember cannot overwrite', async () => {
    const before = await raw(owned), observed = expect(await detail(owned));
    const metadata = { horario: 'Jueves 10:30\nConfirmado por el cliente', coordinada: true };
    const saved = expect(await patch(owned, ownerToken, { propiedades_extra: metadata, expected_revision: observed.revision }));
    const reloaded = expect(await detail(owned)); context(saved); context(reloaded);
    assert.equal(reloaded.revision, observed.revision + 1);
    assert.equal(reloaded.propiedades_extra.horario, metadata.horario); assert.equal(reloaded.propiedades_extra.coordinada, true);
    const after = await raw(owned);
    assert.deepEqual(after.propiedades_extra, { ...before.propiedades_extra, ...metadata });
    for (const key of Object.keys(before).filter(key => !['revision', 'updated_at', 'propiedades_extra'].includes(key)))
      assert.deepEqual(after[key], before[key], `Coordination must preserve stored ${key}`);
    const preserved = await snapshot();
    expect(await patch(owned, ownerToken, { propiedades_extra: { horario: 'Stale overwrite' }, expected_revision: observed.revision }), 409);
    const denied = await patch(owned, homonymToken, { propiedades_extra: { coordinada: false }, expected_revision: reloaded.revision });
    assert.ok([403, 404].includes(denied.status), JSON.stringify(denied.body));
    assert.deepEqual(await snapshot(), preserved);
  });
  await t.test('approved generic production finishes only with existing finalizer authority, without publishing or normalized visits', async () => {
    const current = expect(await detail(owned)), before = await snapshot();
    assert.equal(current.estado, 'aprobada', 'Approval does not expand production-role authority on a non-visit');
    assert.equal(current.tipo_tarea, 'produccion'); assert.equal(current.subtipo, 'coordinacion');
    // Source workflow-contract.js: produccion may finalize recognized visits;
    // this deliberately non-visit task requires admin/community finalizer role.
    expect(await patch(owned, ownerToken, { estado: 'finalizada', expected_revision: current.revision }), 403);
    assert.deepEqual(await snapshot(), before);
    const finished = expect(await patch(owned, admin, { estado: 'finalizada', expected_revision: current.revision }));
    assert.equal(finished.estado, 'finalizada'); context(expect(await detail(owned)));
    assert.equal((await raw(owned)).estado, 'finalizada');
    await monthly(ownerToken, 2, 1);
    const after = await snapshot();
    for (const table of ['historias', 'publicaciones', 'produccion_visitas', 'produccion_visita_participantes',
      'produccion_videos', 'produccion_fotos', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      assert.deepEqual(after[table], before[table], `${table} must not be inferred from task completion`);
    const [storedPiece] = await fixture.query('SELECT estado,"fecha_publicación_real" FROM publicaciones WHERE id=$1', [piece.id]);
    assert.equal(storedPiece.estado, 'lista'); assert.equal(storedPiece['fecha_publicación_real'], null);
    assert.deepEqual(after.produccion_visitas, [], 'Legacy task is never converted into a normalized visit');
  });
  await t.test('explicit reassignment revokes old ID edits despite matching labels while preserving shared reads', async () => {
    const current = expect(await detail(owned, admin));
    const moved = expect(await patch(owned, admin, { asignado_a_id: ids.homonym, colaborador_ids: [],
      expected_revision: current.revision, expected_updated_at: current.updated_at }));
    assert.equal(moved.asignado_a_id, ids.homonym); assert.deepEqual(moved.colaborador_ids, []);
    assert.equal(moved.asignado_a, 'QA Production Homonym', 'Label now also matches the revoked owner name; it grants nothing');
    const before = await snapshot();
    ownerToken = await login('qa_production_home_owner');
    const denied = await patch(owned, ownerToken, { propiedades_extra: { horario: 'Revoked owner attempt' }, expected_revision: moved.revision });
    assert.ok([403, 404].includes(denied.status), JSON.stringify(denied.body));
    context(expect(await detail(owned, ownerToken))); // Shared read is not write permission.
    await board(ids.owner, ownerToken, [collaborative]);
    await board(ids.homonym, homonymToken, [owned, collaborative, foreign]);
    await monthly(ownerToken, 1, 0); await monthly(homonymToken, 3, 1);
    assert.deepEqual(await snapshot(), before);
    const edited = expect(await patch(owned, homonymToken, { propiedades_extra: { horario: 'New verified owner schedule' }, expected_revision: moved.revision }));
    assert.equal(edited.propiedades_extra.horario, 'New verified owner schedule');
    context(expect(await detail(owned, homonymToken)));
  });
  await t.test('production role rejects incomplete visits but can finish a genuinely complete explicitly created visit', async () => {
    // New visit through the existing API, after all legacy-task assertions.
    // Never change the type/title/metadata of a historical generic task to
    // manufacture visit eligibility or add a new permission.
    const created = expect(await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA visita de produccion readiness', workspace: 'render_os', tipo_tarea: 'produccion', subtipo: 'visita',
      asignado_a_id: ids.owner, colaborador_ids: [], cliente_id: client.id, fecha_vencimiento: dates.first,
      produccion_videos_previstos: 1, material_referencia: 'https://example.invalid/explicit-visit-material',
    } }), 201);
    const incomplete = expect(await detail(created.id));
    assert.equal(incomplete.asignado_a_id, ids.owner);
    assert.equal(incomplete.propiedades_extra.produccion_videos_previstos, 1);
    assert.deepEqual(incomplete.propiedades_extra.produccion_registros, []);
    const beforeDenied = await snapshot();
    for (const token of [ownerToken, admin]) {
      expect(await patch(created.id, token, { estado: 'finalizada', expected_revision: incomplete.revision }), 400);
      assert.deepEqual(await snapshot(), beforeDenied, 'Incomplete visit must retain state/revision even for an admin');
    }
    const recorded = expect(await api(`/tareas/${created.id}/produccion/registros`, {
      token: ownerToken, method: 'POST', body: { cantidad: 1, fecha: dates.first, expected_revision: incomplete.revision },
    }), 201);
    assert.equal(recorded.propiedades_extra.produccion_registros.reduce((sum, item) => sum + item.cantidad, 0), 1);
    const complete = expect(await detail(created.id));
    const beforeFinish = await snapshot();
    const finished = expect(await patch(created.id, ownerToken, { estado: 'finalizada', expected_revision: complete.revision }));
    assert.equal(finished.estado, 'finalizada'); assert.equal(finished.revision, complete.revision + 1);
    assert.equal(expect(await detail(created.id)).estado, 'finalizada');
    const afterFinish = await snapshot();
    for (const table of ['historias', 'publicaciones', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      assert.deepEqual(afterFinish[table], beforeFinish[table], 'Valid visit completion remains work completion, not publication evidence');
    assert.equal((await raw(owned)).subtipo, 'coordinacion', 'Legacy non-visit remains a non-visit');
  });
});
