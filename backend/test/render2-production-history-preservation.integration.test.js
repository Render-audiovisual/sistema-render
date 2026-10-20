import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Explicit opt-in only. No configured DB, migrations or server imports here.
test('production history survives normal task edits and explicit registry attachment refuses mixed history', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55662 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-history fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55662,
    url: 'postgresql://render2_fixture@127.0.0.1:55662/render2_local_test', identity });
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Production History preservation',true) RETURNING id");
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const admin = expect(await api('/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } })).token;
  assert.ok(admin);
  const cases = [];
  const legacy = async (name, properties = {}, child = false) => {
    const metadata = { workspace: 'render_os', produccion_videos_previstos: 3,
      history_marker: { nested: ['preserve', name] }, ...properties };
    const [source] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,
      fecha_vencimiento,material_referencia,aclaraciones,propiedades_extra)
      VALUES ($1,'Luciano QA',$2,'en_revision','produccion','visita','2026-10-25',
        'https://example.invalid/history-material','Original historical instructions',$3::jsonb) RETURNING id`,
    [`QA visita historical ${name}`, client.id, JSON.stringify(metadata)]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [source.id]);
    if (child) {
      // Deliberately no child workspace/automatica flag, and no aggregate or
      // confirmation marker on the source. The origin relation alone is enough.
      const [linked] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,
        tarea_padre_id,fecha_vencimiento,propiedades_extra)
        VALUES ('QA historical editing child','Luciano QA',$1,'publicada','edicion','video',$2,'2026-10-26',$3::jsonb) RETURNING id`,
      [client.id, source.id, JSON.stringify({ origen_visita_id: String(source.id), history_marker: 'child without flags' })]);
      await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [linked.id]);
    }
    cases.push({ id: source.id, name });
  };
  await legacy('aggregate-records', { produccion_registros: [{ id: 'legacy-record', cantidad: 3,
    fecha: '2026-10-20', actor: 'Historical author', extra: { preserve: true } }] });
  await legacy('malformed-array', { produccion_registros: [{ invalid: 'retain verbatim' }] });
  await legacy('malformed-object', { produccion_registros: { cantidad: 3, original: 'not an array' } });
  await legacy('confirmed-no-child', { produccion_confirmada_at: '2026-10-20T12:00:00Z' });
  await legacy('child-only', {}, true);
  const snapshot = async () => {
    const result = {};
    for (const table of ['tareas', 'tarea_asignaciones', 'produccion_visitas', 'produccion_visita_participantes',
      'produccion_videos', 'produccion_fotos', 'historias', 'publicaciones', 'cliente_objetivo_piezas',
      'cliente_objetivo_eventos', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT * FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const detail = id => api(`/tareas/${id}?workspace=render_os`, { token: admin });
  const patch = (id, body) => api(`/tareas/${id}?workspace=render_os`, { token: admin, method: 'PATCH', body });
  for (const item of cases) await t.test(`${item.name}: ordinary title/priority PATCH preserves history and creates no registry/tasks`, async () => {
    for (const changes of [{ titulo: `QA visita edited ${item.name}` }, { prioridad: 'alta' }]) {
      const current = expect(await detail(item.id));
      const before = await snapshot(), prior = before.tareas.find(row => row.id === item.id);
      const saved = expect(await patch(item.id, { ...changes, expected_revision: current.revision }));
      assert.equal(saved.revision, current.revision + 1);
      const after = await snapshot(), updated = after.tareas.find(row => row.id === item.id);
      assert.deepEqual(updated, { ...prior, ...changes, revision: prior.revision + 1, updated_at: updated.updated_at },
        'Only requested columns, revision and update timestamp may change');
      assert.deepEqual(after.tareas.map(row => row.id === item.id ? prior : row), before.tareas,
        'No child task created or other historical row rewritten');
      for (const table of Object.keys(before).filter(name => name !== 'tareas')) assert.deepEqual(after[table], before[table], table);
      assert.deepEqual(after.produccion_visitas, []);
      assert.deepEqual(after.produccion_videos, []);
      assert.deepEqual(expect(await detail(item.id)).propiedades_extra, current.propiedades_extra);
    }
  });
  await t.test('explicit POST refuses every historical source before date update or registry insert', async () => {
    for (const item of cases) {
      const before = await snapshot();
      expect(await api('/producciones', { token: admin, method: 'POST', body: {
        tarea_origen_id: item.id, cliente_id: client.id, fecha: '2026-11-07',
        titulo: 'QA prohibited historical attachment', participante_ids: [91003],
      } }), 409);
      assert.deepEqual(await snapshot(), before, '409 must not change date/revision/history, create a task or insert registry rows');
    }
  });
  await t.test('fresh task POST still registers exactly one visit; existing normalized source guards remain unchanged', async () => {
    const before = await snapshot();
    const created = expect(await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA visita genuinely new source', workspace: 'render_os', asignado_a_id: 91003, colaborador_ids: [91004],
      tipo_tarea: 'produccion', subtipo: 'visita', cliente_id: client.id, fecha_vencimiento: '2026-11-07',
      produccion_videos_previstos: 3, material_referencia: 'https://example.invalid/new-material',
    } }), 201);
    const after = await snapshot();
    assert.equal(after.tareas.length, before.tareas.length + 1);
    assert.deepEqual(after.tareas.filter(row => row.id !== created.id), before.tareas);
    assert.equal(after.produccion_visitas.length, 1);
    const visit = after.produccion_visitas[0];
    assert.equal(visit.tarea_origen_id, created.id); assert.equal(visit.cliente_id, client.id);
    const [date] = await fixture.query("SELECT to_char(fecha,'YYYY-MM-DD') AS day FROM produccion_visitas WHERE id=$1", [visit.id]);
    assert.equal(date.day, '2026-11-07');
    assert.deepEqual(after.produccion_videos, []); assert.deepEqual(after.produccion_fotos, []);
    assert.deepEqual(after.produccion_visita_participantes.map(row => row.usuario_id).sort((a, b) => a - b), [91003, 91004]);
    const current = expect(await detail(created.id));
    expect(await patch(created.id, { prioridad: 'alta', expected_revision: current.revision }));
    assert.deepEqual((await snapshot()).produccion_visitas, after.produccion_visitas, 'Unrelated PATCH does not duplicate or rewrite existing visit');
    const observed = expect(await detail(created.id)), stable = await snapshot();
    expect(await patch(created.id, { fecha_vencimiento: '2026-11-08', expected_revision: observed.revision }), 409);
    assert.deepEqual(await snapshot(), stable, 'Existing normalized date remains registry-owned');
    // A fresh explicit registry POST without a historical task also stays valid.
    const independent = expect(await api('/producciones', { token: admin, method: 'POST', body: {
      cliente_id: client.id, fecha: '2026-11-09', titulo: 'QA independent fresh visit', participante_ids: [91003],
    } }), 201);
    assert.equal(independent.visita.tarea_origen_id, null);
    const final = await snapshot();
    assert.equal(final.produccion_visitas.length, 2); assert.equal(final.tareas.length, after.tareas.length);
    for (const table of ['produccion_videos', 'produccion_fotos', 'historias', 'publicaciones',
      'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      assert.deepEqual(final[table], before[table], table);
  });
});
