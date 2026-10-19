import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('canonical task workflow: approval, finalization and editorial independence', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const migration = await readFile(new URL('../migrations/058_task_work_states.sql', import.meta.url), 'utf8');
  const fixture = await startLocalHarness({ port: 55598, deferTaskStateMigration: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own workflow fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  for (const [id, role] of [[95001, 'community'], [95002, 'produccion']])
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_workflow_${role}`, `QA Workflow ${role}`, role]);
  const admin = await login('qa_franco');
  const employee = await login('qa_luciano');
  const community = await login('qa_workflow_community');
  const production = await login('qa_workflow_produccion');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA canonical workflow') RETURNING id");

  await t.test('058 installs over populated history without rewriting task states, dates or goals', async () => {
    assert.equal((await fixture.query("SELECT nombre FROM _migrations WHERE nombre='058_task_work_states.sql'")).length, 0);
    const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,fecha_publicación_real)
      VALUES ($1,'video','publicada','2026-09-01','2026-09-01T14:12:00Z') RETURNING id`, [client.id]);
    const legacy = [];
    for (const estado of ['publicada', 'programada']) {
      const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,publicacion_id,propiedades_extra,updated_at)
        VALUES ($1,'Historical QA',$2,$3,'{"workspace":"render_os","legacy_marker":"preserve"}',
        '2026-09-01T14:00:00Z') RETURNING id`, [`QA historical ${estado}`, estado, estado === 'publicada' ? piece.id : null]);
      legacy.push(task.id);
    }
    const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
      (clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
      VALUES ('qa-workflow-history','2026-09-01',$1,'Historical workflow goal',1,0,'Historical QA') RETURNING id`, [client.id]);
    const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
      (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado,completada_at)
      VALUES ($1,'video',1,$2,$3,'Historical delivered slot','publicada','2026-09-01T14:00:00Z') RETURNING id`, [goal.id, legacy[0], piece.id]);
    await fixture.query(`INSERT INTO cliente_objetivo_eventos(pieza_id,estado_anterior,estado_nuevo,tarea_id,created_at)
      VALUES ($1,'en_revision','publicada',$2,'2026-09-01T14:00:00Z')`, [slot.id, legacy[0]]);
    const history = async () => {
      const rows = {};
      for (const table of ['usuarios', 'tareas', 'tarea_asignaciones', 'historias', 'publicaciones',
        'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
        rows[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY ${table === 'tarea_asignaciones' ? 'tarea_id,usuario_id' : 'id'}`);
      return rows;
    };
    const before = await history();
    await fixture.query(migration);
    assert.deepEqual(await history(), before, '058 must only expand constraints/trigger definitions, not rewrite historical rows');
    assert.deepEqual((await fixture.query('SELECT estado FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [legacy])).map(row => row.estado),
      ['publicada', 'programada']);
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('058_task_work_states.sql')");
  });

  const detail = async id => {
    const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const patch = async (id, token, body) => {
    const current = await detail(id);
    return api(`/tareas/${id}?workspace=render_os`, { token, method: 'PATCH',
      body: { expected_revision: current.revision, expected_updated_at: current.updated_at, ...body } });
  };
  const snapshot = async id => ({ task: await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]),
    assignments: await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [id]) });
  const assertState = async (id, result, estado) => {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.estado, estado);
    assert.equal((await snapshot(id)).task[0].estado, estado);
  };
  const create = async (extra = {}) => {
    const result = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA workflow video', asignado_a_id: 91003, colaborador_ids: [95001],
      tipo_tarea: 'edicion', subtipo: 'video', workspace: 'render_os', ...extra,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.estado, 'pendiente');
    return result.body.id;
  };
  const newLinked = async () => {
    const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada)
      VALUES ($1,'video','lista','2026-10-25') RETURNING id`, [client.id]);
    const id = await create({ cliente_id: client.id, publicacion_id: piece.id });
    return { id, pieceId: piece.id };
  };
  const editorial = id => fixture.query('SELECT * FROM publicaciones WHERE id=$1', [id]);
  const review = async id => {
    await assertState(id, await patch(id, employee, { estado: 'en_progreso' }), 'en_progreso');
    await assertState(id, await patch(id, employee, { estado: 'en_revision' }), 'en_revision');
  };

  await t.test('assigned employee progresses and reviews; admin approves; finalizer completes without editorial publication', async () => {
    const { id, pieceId } = await newLinked();
    const before = await editorial(pieceId);
    await review(id);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    assert.equal((await detail(id)).propiedades_extra.revision_aprobada, true);
    await assertState(id, await patch(id, community, { estado: 'finalizada' }), 'finalizada');
    assert.ok((await detail(id)).propiedades_extra.finalizada_at);
    assert.deepEqual(await editorial(pieceId), before, 'Task finalization cannot publish editorial state or actual date');
    const published = await api(`/publicaciones/${pieceId}`, { token: admin, method: 'PATCH', body: { estado: 'publicada' } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const actual = await editorial(pieceId);
    assert.equal(actual[0].estado, 'publicada');
    assert.ok(actual[0].fecha_publicación_real, 'Only actual editorial publication sets its real date');
    await assertState(id, await patch(id, admin, { estado: 'en_progreso' }), 'en_progreso');
    assert.deepEqual(await editorial(pieceId), actual, 'Task reopening cannot unpublish an actual publication');
  });
  await t.test('employee approval, forged approval metadata and skipped approval cannot authorize completion', async () => {
    const id = await create();
    for (const estado of ['aprobada', 'finalizada', 'publicada']) {
      const before = await snapshot(id);
      const result = await patch(id, admin, { estado });
      assert.ok([400, 409].includes(result.status), JSON.stringify(result));
      assert.deepEqual(await snapshot(id), before);
    }
    await review(id);
    const before = await snapshot(id);
    assert.equal((await patch(id, employee, { estado: 'aprobada' })).status, 403);
    assert.deepEqual(await snapshot(id), before);
    const forged = await patch(id, admin, { propiedades_extra: {
      revision_aprobada: true, revision_aprobada_por_id: 91001, revision_aprobada_at: '2026-10-01T12:00:00Z',
    } });
    assert.ok([200, 400, 403].includes(forged.status), JSON.stringify(forged));
    const current = await detail(id);
    assert.equal(current.estado, 'en_revision');
    assert.notEqual(current.propiedades_extra.revision_aprobada, true, 'Client metadata cannot grant approval');
    const final = await patch(id, admin, { estado: 'finalizada' });
    assert.ok([400, 409].includes(final.status), JSON.stringify(final));
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    const approved = await snapshot(id);
    assert.equal((await patch(id, employee, { estado: 'finalizada' })).status, 403);
    assert.deepEqual(await snapshot(id), approved);
  });
  await t.test('missing/stale revisions reject approval and finalization without side effects', async () => {
    const id = await create();
    await review(id);
    const observed = await detail(id);
    await patch(id, employee, { titulo: 'QA newer workflow revision' }).then(result => assert.equal(result.status, 200));
    const before = await snapshot(id);
    for (const body of [{ estado: 'aprobada' }, { estado: 'aprobada', expected_revision: observed.revision }]) {
      const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin, method: 'PATCH', body });
      assert.equal(result.status, body.expected_revision ? 409 : 400, JSON.stringify(result.body));
      assert.deepEqual(await snapshot(id), before);
    }
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    const approved = await snapshot(id);
    assert.equal((await patch(id, community, { estado: 'finalizada', expected_revision: observed.revision })).status, 409);
    assert.deepEqual(await snapshot(id), approved);
  });
  await t.test('reopening approval clears server approval metadata and requires a fresh approval', async () => {
    const id = await create();
    await review(id);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    await assertState(id, await patch(id, admin, { estado: 'en_progreso' }), 'en_progreso');
    const metadata = (await detail(id)).propiedades_extra;
    assert.notEqual(metadata.revision_aprobada, true);
    for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at'])
      assert.ok(metadata[key] == null, `${key} must be removed/cleared on reopening`);
    const result = await patch(id, community, { estado: 'finalizada' });
    assert.ok([400, 409].includes(result.status), JSON.stringify(result));
  });
  await t.test('approved content edits invalidate approval through API and raw SQL until a new admin approval', async () => {
    const { id, pieceId } = await newLinked();
    const before = await editorial(pieceId);
    await review(id);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    await assertState(id, await patch(id, employee, { material_referencia: 'https://example.invalid/changed-reviewed-material' }), 'en_revision');
    const cleared = async () => {
      const task = await detail(id);
      assert.equal(task.estado, 'en_revision');
      assert.equal(task.propiedades_extra.revision_aprobada, false);
      for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at'])
        assert.ok(task.propiedades_extra[key] == null, `${key} must be cleared after content change`);
    };
    await cleared();
    const invalidated = await snapshot(id);
    const blocked = await patch(id, community, { estado: 'finalizada' });
    assert.ok([400, 409].includes(blocked.status), JSON.stringify(blocked));
    assert.deepEqual(await snapshot(id), invalidated);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    await fixture.query(`UPDATE tareas SET aclaraciones='QA direct SQL revised instructions',
      propiedades_extra=propiedades_extra || '{"copy_trabajo":"QA SQL revised copy"}'::jsonb WHERE id=$1`, [id]);
    await cleared();
    const sqlInvalidated = await snapshot(id);
    const sqlBlocked = await patch(id, community, { estado: 'finalizada' });
    assert.ok([400, 409].includes(sqlBlocked.status), JSON.stringify(sqlBlocked));
    assert.deepEqual(await snapshot(id), sqlInvalidated);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    await assertState(id, await patch(id, community, { estado: 'finalizada' }), 'finalizada');
    assert.deepEqual(await editorial(pieceId), before);
  });
  await t.test('legacy final write normalizes to finalizada; POST cannot create approved/finalized tasks', async () => {
    const { id, pieceId } = await newLinked();
    await review(id);
    await assertState(id, await patch(id, admin, { estado: 'aprobada' }), 'aprobada');
    const before = await editorial(pieceId);
    await assertState(id, await patch(id, community, { estado: 'publicada' }), 'finalizada');
    assert.deepEqual(await editorial(pieceId), before);
    const [counts] = await fixture.query('SELECT count(*)::int AS count FROM tareas');
    for (const estado of ['aprobada', 'finalizada', 'publicada']) {
      const result = await api('/tareas', { token: admin, method: 'POST', body: {
        titulo: 'No initial approval/finalization', asignado_a_id: 91003, workspace: 'render_os', estado,
      } });
      assert.ok([400, 409].includes(result.status), JSON.stringify(result));
      assert.deepEqual(await fixture.query('SELECT count(*)::int AS count FROM tareas'), [counts]);
    }
  });
  await t.test('dedicated approval endpoint still checks role/revision and persists approved state', async () => {
    const id = await create({ tipo_tarea: 'diseno', subtipo: 'carrusel', titulo: 'QA approve non-video' });
    await review(id);
    const observed = await detail(id);
    const approve = (token, revision) => api(`/tareas/${id}/aprobar-publicacion?workspace=render_os`, {
      token, method: 'POST', body: { responsable_publicacion_id: 95001, expected_revision: revision },
    });
    assert.equal((await approve(employee, observed.revision)).status, 403);
    await assertState(id, await approve(admin, observed.revision), 'aprobada');
    assert.equal((await detail(id)).asignado_a_id, 95001);
    assert.equal((await approve(admin, (await detail(id)).revision)).status, 409);
  });
  await t.test('only complete production visits bypass approval; generic production tasks cannot', async () => {
    const generic = await create({ titulo: 'QA production inventory', tipo_tarea: 'produccion', subtipo: 'inventario', asignado_a_id: 95002 });
    const denied = await patch(generic, production, { estado: 'finalizada' });
    assert.equal(denied.status, 403, JSON.stringify(denied));
    const unapproved = await patch(generic, admin, { estado: 'finalizada' });
    assert.ok([400, 409].includes(unapproved.status), JSON.stringify(unapproved));
    const visit = await create({ titulo: 'QA visita de produccion', tipo_tarea: 'produccion', subtipo: 'visita',
      asignado_a_id: 95002, produccion_videos_previstos: 1, material_referencia: 'https://example.invalid/qa-material' });
    const incomplete = await detail(visit);
    const beforeOmittedWorkspace = await snapshot(visit);
    const omittedWorkspace = await api(`/tareas/${visit}`, { token: admin, method: 'PATCH', body: {
      estado: 'finalizada', expected_revision: incomplete.revision, expected_updated_at: incomplete.updated_at,
    } });
    assert.equal(omittedWorkspace.status, 400, JSON.stringify(omittedWorkspace.body));
    assert.deepEqual(await snapshot(visit), beforeOmittedWorkspace,
      'Persisted Render OS visit must keep state, metadata, revision and bindings when workspace query is omitted');
    assert.equal((await patch(visit, production, { estado: 'finalizada' })).status, 400);
    const recorded = await api(`/tareas/${visit}/produccion/registros`, { token: production, method: 'POST',
      body: { cantidad: 1, fecha: '2026-10-25', expected_revision: (await detail(visit, production)).revision } });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    await assertState(visit, await patch(visit, production, { estado: 'finalizada' }), 'finalizada');
  });
});
