import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Principal HTTP + disposable physical PostgreSQL only; no configured database.
test('production create receipts: atomic, actor scoped, replay current aggregate without writes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55719 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55719,
    url: 'postgresql://render2_fixture@127.0.0.1:55719/render2_local_test', identity });
  const api = (path, options) => request(f.base, `/api${path}`, options);
  const ok = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status');
    return response.body;
  };
  const login = async usuario => {
    const body = ok(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof body.token, 'string');
    return body.token;
  };
  const actor = await login('qa_franco'), other = await login('qa_agustin');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA96 create receipt client',true) RETURNING id");
  const payload = (changes = {}) => ({ request_id: randomUUID(), cliente_id: client.id,
    fecha: '2026-10-25', titulo: 'QA96 independent visit', participante_ids: [91003, 91004],
    drive_url: '', observaciones: 'Receipt preservation QA96', ...changes });
  const post = (body, token = actor) => api('/producciones', { method: 'POST', token, body });
  const tables = ['production_create_receipts', 'produccion_visitas', 'produccion_visita_participantes',
    'produccion_videos', 'produccion_fotos', 'tareas', 'tarea_asignaciones', 'historias', 'publicaciones'];
  const snapshot = async () => {
    const result = {};
    for (const name of tables) result[name] = await f.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const fullVisit = body => {
    const visit = body.visita;
    assert.equal(typeof visit?.id, 'string');
    assert.ok(Number.isSafeInteger(visit.revision) && visit.revision > 0);
    assert.equal(visit.cliente_id, client.id);
    for (const key of ['cliente_nombre', 'fecha', 'titulo', 'observaciones', 'drive_url']) assert.equal(typeof visit[key], 'string');
    for (const key of ['videos', 'fotos', 'participante_ids']) assert.ok(Array.isArray(visit[key]));
    return visit;
  };

  await t.test('concurrent identical requests commit exactly one visit and one receipt', async () => {
    const body = payload(), before = await snapshot();
    const responses = await Promise.all([post(body), post(body)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]);
    const visits = responses.map(row => fullVisit(row.body));
    assert.equal(visits[0].id, visits[1].id);
    assert.deepEqual(visits[0], visits[1]);
    const after = await snapshot();
    assert.equal(after.production_create_receipts.length, before.production_create_receipts.length + 1);
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 1);
    assert.equal(after.produccion_visita_participantes.length, before.produccion_visita_participantes.length + 2);
    for (const table of tables.filter(name => !['production_create_receipts', 'produccion_visitas', 'produccion_visita_participantes'].includes(name)))
      assert.deepEqual(after[table], before[table], table);
  });

  await t.test('lost-response simulation discards a genuine HTTP result, then replay is read-only', async () => {
    const body = payload();
    // Real response is deliberately not used to recover the created ID. This
    // simulates caller observation loss, not a claim of TCP fault injection.
    assert.equal((await post(body)).status, 201);
    const before = await snapshot();
    fullVisit(ok(await post(body)));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('canonical equivalent defaults and key order replay, changed intent conflicts without writes', async () => {
    const body = payload();
    const first = fullVisit(ok(await post(body), 201));
    const equivalent = { titulo: body.titulo, fecha: body.fecha, cliente_id: body.cliente_id,
      request_id: body.request_id, participante_ids: body.participante_ids, observaciones: body.observaciones };
    const before = await snapshot();
    assert.equal(fullVisit(ok(await post(equivalent))).id, first.id);
    assert.deepEqual(await snapshot(), before);
    ok(await post({ ...body, titulo: 'Different requested visit' }), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('same request UUID belongs independently to each actor', async () => {
    const body = payload();
    const first = fullVisit(ok(await post(body), 201));
    const second = fullVisit(ok(await post(body, other), 201));
    assert.notEqual(first.id, second.id);
    const before = await snapshot();
    assert.equal(fullVisit(ok(await post(body, other))).id, second.id);
    assert.equal(fullVisit(ok(await post(body))).id, first.id);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('uppercase UUID and participant set ordering use the same canonical receipt', async () => {
    const body = payload({ request_id: 'abcdefab-cdef-4abc-8def-abcdefabcdef' });
    const created = fullVisit(ok(await post({ ...body, request_id: body.request_id.toUpperCase() }), 201));
    const before = await snapshot();
    assert.equal(fullVisit(ok(await post({ ...body, participante_ids: [91004, 91003, 91004] }))).id, created.id);
    assert.deepEqual(await snapshot(), before);
    const receipts = await f.query('SELECT actor_user_id,request_id,visit_id FROM production_create_receipts WHERE request_id=$1', [body.request_id]);
    assert.deepEqual(receipts, [{ actor_user_id: 91001, request_id: body.request_id, visit_id: created.id }]);
  });

  await t.test('replay never reapplies original source date after an explicit visit reschedule', async () => {
    // Raw SQL is fixture setup only: avoid automatic task POST normalization.
    const [source] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,
      fecha_vencimiento,propiedades_extra) VALUES ('QA96 fresh source','Luciano QA',$1,'pendiente','produccion','visita',
      '2026-10-24','{"workspace":"render_os"}'::jsonb) RETURNING id`, [client.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [source.id]);
    const body = payload({ tarea_origen_id: source.id });
    const created = fullVisit(ok(await post(body), 201));
    const changed = fullVisit(ok(await api(`/producciones/${created.id}`, { method: 'PATCH', token: actor,
      body: { expected_revision: created.revision, fecha: '2026-11-09' } })));
    const before = await snapshot();
    assert.deepEqual(fullVisit(ok(await post(body))), changed);
    assert.deepEqual(await snapshot(), before);
    const [row] = await f.query("SELECT to_char(fecha_vencimiento,'YYYY-MM-DD') AS day FROM tareas WHERE id=$1", [source.id]);
    assert.equal(row.day, '2026-11-09');
  });

  await t.test('replay returns current full aggregate after edits, without rewriting current data', async () => {
    const body = payload(), created = fullVisit(ok(await post(body), 201));
    fullVisit(ok(await api(`/producciones/${created.id}`, { method: 'PATCH', token: actor,
      body: { expected_revision: created.revision, titulo: 'Current edited title', observaciones: 'Current edited notes' } })));
    const current = fullVisit(ok(await api(`/producciones/${created.id}`, { token: actor })));
    assert.ok(current.revision > created.revision);
    const before = await snapshot();
    assert.deepEqual(fullVisit(ok(await post(body))), current);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('replays still reject anonymous, inactive and revoked actors without writes', async () => {
    const body = payload();
    ok(await post(body, other), 201);
    let before = await snapshot();
    ok(await post(body, null), 401);
    assert.deepEqual(await snapshot(), before);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try {
      before = await snapshot();
      ok(await post(body, other), 401);
      assert.deepEqual(await snapshot(), before);
    } finally { await f.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    before = await snapshot();
    ok(await post(body, other), 401);
    assert.deepEqual(await snapshot(), before);
    const fresh = await login('qa_agustin');
    assert.equal(fullVisit(ok(await post(body, fresh))).titulo, body.titulo);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('receipt INSERT fault rolls back visit and participants; same key succeeds afterward', async () => {
    const body = payload(), before = await snapshot();
    await f.query(`CREATE FUNCTION qa96_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA96 synthetic receipt failure'; END $$`);
    try {
      await f.query('CREATE TRIGGER qa96_receipt_fault BEFORE INSERT ON production_create_receipts FOR EACH ROW EXECUTE FUNCTION qa96_receipt_fault()');
      try {
        ok(await post(body), 500);
        assert.deepEqual(await snapshot(), before);
      } finally { await f.query('DROP TRIGGER qa96_receipt_fault ON production_create_receipts'); }
    } finally { await f.query('DROP FUNCTION qa96_receipt_fault()'); }
    fullVisit(ok(await post(body), 201));
    const after = await snapshot();
    assert.equal(after.production_create_receipts.length, before.production_create_receipts.length + 1);
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 1);
  });

  await t.test('legacy unkeyed callers remain independent creates without receipts', async () => {
    const body = payload(); delete body.request_id;
    const before = await snapshot();
    const first = fullVisit(ok(await post(body), 201));
    const second = fullVisit(ok(await post(body), 201));
    assert.notEqual(first.id, second.id);
    const after = await snapshot();
    assert.deepEqual(after.production_create_receipts, before.production_create_receipts);
    assert.equal(after.produccion_visitas.length, before.produccion_visitas.length + 2);
  });
});
