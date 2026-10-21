import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('production editorial: canonical delivery identity and atomic association', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55603, deferProductionEditorialMigration: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-editorial fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, body, token = admin, method = 'POST') => request(fixture.base, `/api${route}`,
    { token, method, ...(body === undefined ? {} : { body }) });
  const ok = (result, statuses = [200]) => {
    assert.ok(statuses.includes(result.status), `${result.status}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  const login = async usuario => ok(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  const admin = await login('qa_franco');
  for (const [id, role] of [[101001, 'edicion'], [101002, 'edicion'], [101003, 'diseno'], [101004, 'edicion']])
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA editorial homonym',$3,password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_editorial_${id}`, role]);
  const staff = await login('qa_editorial_101001');
  const impostor = await login('qa_editorial_101002');
  const [client] = await fixture.query("INSERT INTO clientes(nombre,cuota_reels) VALUES ('QA editorial client',100) RETURNING id");
  const [other] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA editorial other') RETURNING id");
  const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
    (clave,periodo,cliente_id,cuentas,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-editorial','2026-10-01',$1,jsonb_build_array(jsonb_build_object('id',$1::int)),
      'QA editorial goal',100,0,'fixture') RETURNING id`, [client.id]);
  let number = 0;
  const seed = async ({ piece = true, clientId = client.id, type = 'video' } = {}) => {
    number++;
    assert.ok(number<=100,'Association fixture slots must remain within its explicitly prepared quota');
    const publication = piece ? (await fixture.query(`INSERT INTO publicaciones
      (cliente_id,tipo,estado,fecha_programada,copy,metadata)
      VALUES ($1,$2,'pendiente','2026-10-29','QA slot copy','{"qa_history":"preserve"}') RETURNING *`, [clientId, type]))[0] : null;
    const [task] = await fixture.query(`INSERT INTO tareas
      (titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,estado,fecha_vencimiento,propiedades_extra)
      VALUES ($1,'QA editorial homonym',$2,$3,'edicion','video','pendiente','2026-10-25','{"workspace":"render_os","periodo_objetivo":"2026-10"}') RETURNING *`,
    [`QA canonical ${number}`, clientId, publication?.id ?? null]);
    const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
      (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy)
      VALUES ($1,'video',$2,$3,$4,$5,'QA slot copy') RETURNING *`,
    [goal.id, number, task.id, publication?.id ?? null, `QA slot ${number}`]);
    return { publication, task, slot };
  };
  const tables = ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'publicaciones', 'historias',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'produccion_visitas', 'produccion_videos', 'produccion_fotos', 'produccion_visita_participantes'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`);
    return result;
  };
  const existing = await seed();
  await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
    VALUES ($1,91003,'responsable'),($1,101002,'colaborador'),
      ($1,101003,'colaborador'),($1,101004,'colaborador')`, [existing.task.id]);
  const empty = await seed({ piece: false });
  // Populate the 059 registry before applying 060, without calling the not-yet-installed API module.
  const [historyVisit] = await fixture.query(`INSERT INTO produccion_visitas
    (id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
    VALUES ('00000000-0000-4000-8000-000000055603',$1,'2026-10-20','QA historical visit',91001,91001) RETURNING id`, [client.id]);
  await fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
    VALUES ('00000000-0000-4000-8001-000000055603',$1,'QA historical video','grabado',91001,91001)`, [historyVisit.id]);

  await t.test('060 preserves populated history; only new nullable linkage columns are introduced', async () => {
    assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE left(nombre,4)='060_'"), []);
    const names = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^060_.*\.sql$/.test(name));
    assert.equal(names.length, 1);
    const before = await snapshot();
    await fixture.query(await readFile(new URL(`../migrations/${names[0]}`, import.meta.url), 'utf8'));
    const after = await snapshot();
    for (const row of after.produccion_videos) {
      for (const column of ['publicacion_id', 'tarea_entrega_id', 'cliente_editorial_id']) {
        assert.equal(row[column], null);
        delete row[column];
      }
    }
    assert.deepEqual(after, before, 'No backfill, identity inference, task creation or historical rewrite');
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [names[0]]);
    await fixture.query(await readFile(new URL('../migrations/063_projects.sql', import.meta.url), 'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('063_projects.sql')");
    // The harness also defers 078 until the real 060 forward SQL has run.
    // Preserve the original 060 column/history assertions above unchanged.
    assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE nombre='078_production_history_batches.sql'"), []);
    const beforeBatches = await snapshot();
    await fixture.query(await readFile(new URL('../migrations/078_production_history_batches.sql', import.meta.url), 'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('078_production_history_batches.sql')");
    assert.deepEqual(await snapshot(), beforeBatches, '078 must preserve populated task, editorial, goal and registry history');
    for (const table of ['produccion_revision_lotes', 'produccion_lote_edicion_mapeos',
      'produccion_revision_lote_videos', 'produccion_revision_lote_hijos']) {
      assert.deepEqual(await fixture.query(`SELECT count(*)::int AS count FROM ${table}`), [{ count: 0 }]);
    }
  });
  const beforeApprovals = await snapshot();
  await fixture.query(await readFile(new URL('../migrations/079_project_deliverable_approvals.sql', import.meta.url), 'utf8'));
  await fixture.query("INSERT INTO _migrations(nombre) VALUES ('079_project_deliverable_approvals.sql')");
  assert.deepEqual(await snapshot(), beforeApprovals, '079 must preserve existing operational history');
  assert.deepEqual(await fixture.query('SELECT * FROM proyecto_entregable_aprobaciones'), []);
  const readVisit = async id => ok(await api(`/producciones/${id}`, undefined, admin, 'GET')).visita;
  const video = async () => {
    let visit = ok(await api('/producciones', { cliente_id: client.id, fecha: '2026-10-20', titulo: `QA editorial visit ${++number}`, participante_ids: [101001] }), [201]).visita;
    visit = ok(await api(`/producciones/${visit.id}/videos`, { expected_revision: visit.revision,
      titulo: `QA editorial video ${number}`, guion: 'NOT editorial copy', estado: 'grabado', material_url: 'https://example.invalid/qa' }), [201]).visita;
    return { visitId: visit.id, videoId: visit.videos[0].id };
  };
  const route = (v, suffix) => `/producciones/${v.visitId}/videos/${v.videoId}/${suffix}`;
  const candidates = async (v, token = admin, period = '2026-10') => api(`${route(v, 'vinculo')}?periodo=${period}`, undefined, token, 'GET');
  const payload = async (v, target, isEmpty = false) => ({
    expected_revision: (await readVisit(v.visitId)).revision,
    tarea_id: target.task.id, expected_tarea_revision: (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [target.task.id]))[0].revision,
    objetivo_pieza_id: target.slot.id,
    expected_objetivo_updated_at: (await fixture.query('SELECT updated_at FROM cliente_objetivo_piezas WHERE id=$1', [target.slot.id]))[0].updated_at,
    ...(isEmpty ? { fecha_programada: '2026-10-29' } : {
      publicacion_id: target.publication.id,
      expected_publicacion_updated_at: (await fixture.query('SELECT updated_at FROM publicaciones WHERE id=$1', [target.publication.id]))[0].updated_at,
    }),
  });
  const count = async table => (await fixture.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
  const first = await video();
  const second = await video();

  await t.test('candidate reads and association writes require current admin; candidates identify canonical task/slot', async () => {
    assert.equal((await candidates(first, staff)).status, 403);
    const data = ok(await candidates(first));
    assert.ok(data.publicaciones.some(p => p.publicacion_id === existing.publication.id && p.tarea_id === existing.task.id && p.objetivo_pieza_id === existing.slot.id));
    assert.ok(data.casilleros.some(p => p.objetivo_pieza_id === empty.slot.id && p.tarea_id === empty.task.id));
    const before = await snapshot();
    assert.equal((await api(route(first, 'vincular-pieza'), await payload(first, existing), staff)).status, 403);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('existing piece/goal uses its single canonical task and exact repeat is mutation-free', async () => {
    const body = await payload(first, existing);
    const beforeTasks = await count('tareas');
    const beforeSlots = await count('cliente_objetivo_piezas');
    const linked = ok(await api(route(first, 'vincular-pieza'), body), [200, 201]);
    assert.equal(linked.tarea_id, existing.task.id);
    assert.equal(linked.publicacion_id, existing.publication.id);
    assert.equal(linked.objetivo_pieza_id, existing.slot.id);
    assert.equal(linked.created, false);
    assert.equal(await count('tareas'), beforeTasks);
    assert.equal(await count('cliente_objetivo_piezas'), beforeSlots);
    const before = await snapshot();
    ok(await api(route(first, 'vincular-pieza'), body));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await readVisit(first.visitId)).videos[0].tarea_edicion_id, null);
  });
  await t.test('empty goal creates one draft and zero tasks; preserves slot copy rather than video script', async () => {
    const body = await payload(second, empty, true);
    const beforeTasks = await count('tareas');
    const beforePieces = await count('publicaciones');
    const linked = ok(await api(route(second, 'vincular-objetivo'), body), [200, 201]);
    assert.equal(linked.created, true);
    assert.equal(linked.tarea_id, empty.task.id);
    assert.equal(await count('tareas'), beforeTasks);
    assert.equal(await count('publicaciones'), beforePieces + 1);
    const [piece] = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [linked.publicacion_id]);
    assert.equal(piece.estado, 'pendiente');
    assert.equal(piece.copy, 'QA slot copy');
    assert.equal(piece.fecha_publicación_real, null);
    assert.equal(String(piece.fecha_programada).slice(0, 10), '2026-10-29');
    const before = await snapshot();
    ok(await api(route(second, 'vincular-objetivo'), body));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await api(route(second, 'vincular-objetivo'), { ...body, fecha_programada: '2026-10-30' })).status, 409);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('stale CAS and omitted linked goal acknowledgement reject without mutation', async () => {
    const target = await seed();
    const v = await video();
    const valid = await payload(v, target);
    for (const body of [{ ...valid, expected_revision: valid.expected_revision + 1 },
      { ...valid, expected_tarea_revision: valid.expected_tarea_revision + 1 },
      { ...valid, expected_publicacion_updated_at: '2000-01-01T00:00:00Z' },
      { ...valid, expected_objetivo_updated_at: '2000-01-01T00:00:00Z' },
      { ...valid, objetivo_pieza_id: undefined, expected_objetivo_updated_at: undefined }]) {
      const before = await snapshot();
      assert.equal((await api(route(v, 'vincular-pieza'), body)).status, 409);
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('two visits racing for one publication/task have exactly one winner', async () => {
    const target = await seed();
    const a = await video(); const b = await video();
    const bodies = await Promise.all([payload(a, target), payload(b, target)]);
    const results = await Promise.all([api(route(a, 'vincular-pieza'), bodies[0]), api(route(b, 'vincular-pieza'), bodies[1])]);
    assert.equal(results.filter(r => [200, 201].includes(r.status)).length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 1);
    assert.equal((await fixture.query('SELECT id FROM produccion_videos WHERE publicacion_id=$1', [target.publication.id])).length, 1);
  });
  await t.test('cross-client and wrong format are not candidates and cannot be forced into a link', async () => {
    for (const target of [await seed({ clientId: other.id }), await seed({ type: 'carrusel' })]) {
      const v = await video();
      const options = ok(await candidates(v));
      assert.ok(!options.publicaciones.some(p => p.publicacion_id === target.publication.id));
      const before = await snapshot();
      assert.equal((await api(route(v, 'vincular-pieza'), await payload(v, target))).status, 409);
      assert.deepEqual(await snapshot(), before);
    }
    const options = ok(await candidates(first, admin, '2026-11'));
    assert.ok(!options.casilleros.some(p => p.objetivo_pieza_id === empty.slot.id));
  });
  await t.test('fixture-only post-insert binding failure rolls back publication, slot, task and visit revision', async () => {
    const target = await seed({ piece: false });
    const v = await video();
    const body = await payload(v, target, true);
    await fixture.query(`CREATE FUNCTION qa_editorial_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='${v.videoId}'::uuid AND NEW.publicacion_id IS NOT NULL THEN
      RAISE EXCEPTION 'synthetic editorial binding failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_editorial_fail BEFORE UPDATE ON produccion_videos FOR EACH ROW EXECUTE FUNCTION qa_editorial_fail()`);
    try {
      const before = await snapshot();
      assert.equal((await api(route(v, 'vincular-objetivo'), body)).status, 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await fixture.query('DROP TRIGGER qa_editorial_fail ON produccion_videos; DROP FUNCTION qa_editorial_fail()');
    }
    ok(await api(route(v, 'vincular-objetivo'), body), [200, 201]);
  });
  await t.test('manual handoff adopts canonical task with stable editor ID; workflow never publishes piece', async () => {
    const beforeRemoval = ok(await api(`/tareas/${existing.task.id}?workspace=render_os`, undefined, admin, 'GET'));
    ok(await api(`/tareas/${existing.task.id}?workspace=render_os`, {
      expected_revision: beforeRemoval.revision, expected_updated_at: beforeRemoval.updated_at,
      asignado_a_id: 91003, colaborador_ids: [101003, 101004],
    }, admin, 'PATCH'));
    assert.equal((await fixture.query('SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=101002', [existing.task.id])).length, 0);
    // Realistic old membership: account is deactivated after assignment. Handoff
    // must preserve active IDs only, never recover a removed homonym from JSON.
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=101004');
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra ||
      '{"colaboradores":["QA editorial homonym"]}'::jsonb WHERE id=$1`, [existing.task.id]);
    const beforeTasks = await count('tareas');
    for (const id of [101003, 101004]) {
      const before = await snapshot();
      assert.equal((await api(route(first, 'enviar-edicion'), { expected_revision: (await readVisit(first.visitId)).revision,
        editor_id: id, fecha_entrega: '2026-10-25' })).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    ok(await api(route(first, 'enviar-edicion'), { expected_revision: (await readVisit(first.visitId)).revision,
      editor_id: 101001, fecha_entrega: '2026-10-25' }), [200, 201]);
    assert.equal(await count('tareas'), beforeTasks);
    const current = (await readVisit(first.visitId)).videos[0];
    assert.equal(current.tarea_edicion_id, existing.task.id);
    assert.equal(current.editor_actual_id, 101001);
    const assignments = await fixture.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [existing.task.id]);
    assert.deepEqual(assignments, [{ usuario_id: 91003, tipo: 'colaborador' },
      { usuario_id: 101001, tipo: 'responsable' }, { usuario_id: 101003, tipo: 'colaborador' }]);
    assert.ok(!assignments.some(row => [101002, 101004].includes(row.usuario_id)),
      'Handoff must not restore removed IDs from stale names or retain inactive members');
    assert.equal(current.fecha_entrega_actual, '2026-10-25');
    assert.equal((await readVisit(first.visitId)).fecha, '2026-10-20');
    const editorial = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [existing.publication.id]);
    const patch = async (body, token = admin) => {
      const detail = ok(await api(`/tareas/${existing.task.id}?workspace=render_os`, undefined, admin, 'GET'));
      return api(`/tareas/${existing.task.id}?workspace=render_os`, { expected_revision: detail.revision, ...body }, token, 'PATCH');
    };
    const [slotBeforeScript] = await fixture.query('SELECT copy FROM cliente_objetivo_piezas WHERE id=$1', [existing.slot.id]);
    assert.equal(editorial[0].copy, 'QA slot copy');
    assert.equal(slotBeforeScript.copy, editorial[0].copy);
    const [sourceBeforeScript] = await fixture.query('SELECT guion FROM produccion_videos WHERE id=$1', [first.videoId]);
    assert.equal(sourceBeforeScript.guion, 'NOT editorial copy');
    // Match the script-only UI payload: intentionally empty script, no copy key.
    ok(await patch({ aclaraciones: 'QA script-only save', propiedades_extra: { guiones: '' } }, staff));
    const [scriptTask] = await fixture.query('SELECT aclaraciones,propiedades_extra FROM tareas WHERE id=$1', [existing.task.id]);
    assert.equal(scriptTask.aclaraciones, 'QA script-only save');
    assert.equal(scriptTask.propiedades_extra.guiones, '');
    assert.deepEqual(await fixture.query('SELECT copy FROM publicaciones WHERE id=$1', [existing.publication.id]), [{ copy: editorial[0].copy }]);
    assert.deepEqual(await fixture.query('SELECT copy FROM cliente_objetivo_piezas WHERE id=$1', [existing.slot.id]), [slotBeforeScript]);
    assert.deepEqual(await fixture.query('SELECT guion FROM produccion_videos WHERE id=$1', [first.videoId]), [sourceBeforeScript]);
    assert.ok([403, 404].includes((await patch({ aclaraciones: 'homonym must not edit' }, impostor)).status));
    ok(await patch({ estado: 'en_progreso' }, staff));
    ok(await patch({ estado: 'en_revision' }, staff));
    assert.equal((await patch({ estado: 'aprobada' }, staff)).status, 403);
    ok(await patch({ estado: 'aprobada' }));
    ok(await patch({ estado: 'finalizada' }));
    assert.deepEqual(await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [existing.publication.id]), editorial);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM cliente_objetivo_piezas WHERE tarea_id=$1', [existing.task.id]))[0].n, 1);
    const reloaded = ok(await candidates(first, await login('qa_franco')));
    assert.equal(reloaded.actual.publicacion_id, existing.publication.id);
    assert.equal(reloaded.actual.tarea_entrega_id, existing.task.id);
  });
  await t.test('ordinary task writers cannot sever the editorial tuple or delete its canonical identity', async () => {
    for (const body of [{ publicacion_id: null }, { cliente_id: other.id }]) {
      const current = ok(await api(`/tareas/${existing.task.id}?workspace=render_os`, undefined, admin, 'GET'));
      const before = await snapshot();
      assert.equal((await api(`/tareas/${existing.task.id}?workspace=render_os`, { ...body, expected_revision: current.revision }, admin, 'PATCH')).status, 409);
      assert.deepEqual(await snapshot(), before);
    }
    const before = await snapshot();
    assert.equal((await api(`/tareas/${existing.task.id}`, undefined, admin, 'DELETE')).status, 409);
    assert.deepEqual(await snapshot(), before);
    const publications = ok(await api('/publicaciones', undefined, admin, 'GET'));
    const observedPublication = publications.find(row => row.id === existing.publication.id);
    assert.ok(observedPublication);
    assert.ok(Number.isSafeInteger(observedPublication.publicacion_evidencia?.revision));
    for (const body of [{ tipo: 'carrusel' }]) {
      assert.equal((await api(`/publicaciones/${existing.publication.id}`, {
        ...body, expected_revision: observedPublication.publicacion_evidencia.revision,
      }, admin, 'PATCH')).status, 409);
      assert.deepEqual(await snapshot(), before);
    }
    assert.equal((await api(`/publicaciones/${existing.publication.id}`, undefined, admin, 'DELETE')).status, 409);
    assert.deepEqual(await snapshot(), before);
    const replacement = await seed();
    const [slot] = await fixture.query('SELECT updated_at FROM cliente_objetivo_piezas WHERE id=$1', [existing.slot.id]);
    const [task] = await fixture.query('SELECT updated_at FROM tareas WHERE id=$1', [replacement.task.id]);
    const beforeGoal = await snapshot();
    assert.equal((await api(`/cliente-objetivos/piezas/${existing.slot.id}/vincular`, {
      tarea_id: replacement.task.id, expected_tarea_updated_at: task.updated_at,
      expected_pieza_updated_at: slot.updated_at,
    })).status, 409);
    assert.deepEqual(await snapshot(), beforeGoal);
    const beforeSql = await snapshot();
    await assert.rejects(fixture.query('UPDATE publicaciones SET cliente_id=$1 WHERE id=$2', [other.id, existing.publication.id]), /foreign key constraint/i);
    await assert.rejects(fixture.query('UPDATE cliente_objetivo_piezas SET tarea_id=NULL WHERE id=$1', [existing.slot.id]));
    assert.deepEqual(await snapshot(), beforeSql);
  });
  await t.test('task copy and publication copy concurrent writers complete without deadlock or editorial/date changes', async () => {
    const target = await seed();
    const v = await video();
    ok(await api(route(v, 'vincular-pieza'), await payload(v, target)), [200, 201]);
    const [beforePiece] = await fixture.query('SELECT estado,fecha_programada,fecha_publicación_real FROM publicaciones WHERE id=$1', [target.publication.id]);
    const [beforeSlot] = await fixture.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1', [target.slot.id]);
    const detail = ok(await api(`/tareas/${target.task.id}?workspace=render_os`, undefined, admin, 'GET'));
    const publications = ok(await api('/publicaciones', undefined, admin, 'GET'));
    const observedPublication = publications.find(row => row.id === target.publication.id);
    assert.ok(observedPublication);
    assert.ok(Number.isSafeInteger(observedPublication.publicacion_evidencia?.revision));
    const results = await Promise.all([
      api(`/tareas/${target.task.id}?workspace=render_os`, { expected_revision: detail.revision,
        propiedades_extra: { copy_trabajo: 'QA task concurrent copy' } }, admin, 'PATCH'),
      api(`/publicaciones/${target.publication.id}`, { copy: 'QA publication concurrent copy',
        expected_revision: observedPublication.publicacion_evidencia.revision }, admin, 'PATCH'),
    ]);
    ok(results[0]);
    assert.ok([200,409].includes(results[1].status), JSON.stringify(results[1]));
    if (results[1].status === 409) {
      const [preserved] = await fixture.query('SELECT copy FROM publicaciones WHERE id=$1', [target.publication.id]);
      assert.equal(preserved.copy, 'QA task concurrent copy', 'rejected stale editorial intent must not overwrite the task writer');
      const freshRows = ok(await api('/publicaciones', undefined, admin, 'GET'));
      const fresh = freshRows.find(row => row.id === target.publication.id); assert.ok(fresh);
      assert.equal(fresh.copy, preserved.copy, 'reading a conflict must not replay the discarded intent');
      assert.ok(Number.isSafeInteger(fresh.publicacion_evidencia?.revision));
      assert.ok(fresh.publicacion_evidencia.revision > observedPublication.publicacion_evidencia.revision);
      // An explicit new observation and manual save, not an automatic retry/rebase.
      const manual = ok(await api(`/publicaciones/${target.publication.id}`, {
        copy: 'QA publication manually reviewed copy', expected_revision: fresh.publicacion_evidencia.revision,
      }, admin, 'PATCH'));
      assert.equal(manual.copy, 'QA publication manually reviewed copy');
    } else {
      assert.equal(results[1].body.copy, 'QA publication concurrent copy');
    }
    assert.deepEqual(await fixture.query('SELECT estado,fecha_programada,fecha_publicación_real FROM publicaciones WHERE id=$1', [target.publication.id]), [beforePiece]);
    assert.deepEqual(await fixture.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1', [target.slot.id]), [beforeSlot]);
    const [copy] = await fixture.query(`SELECT p.copy,s.copy AS slot_copy FROM publicaciones p
      JOIN cliente_objetivo_piezas s ON s.publicacion_id=p.id WHERE p.id=$1`, [target.publication.id]);
    assert.equal(copy.slot_copy, copy.copy);
    if (results[1].status === 409) assert.equal(copy.copy, 'QA publication manually reviewed copy');
    else assert.ok(['QA task concurrent copy','QA publication concurrent copy'].includes(copy.copy),
      'when both writes succeed, the last serialized writer supplies the coherent piece/slot copy');
  });
  await t.test('canonical identity is unique across editorial delivery and prior handoff columns, not globally per publication', async () => {
    const target = await seed();
    const planned = await video();
    ok(await api(route(planned, 'vincular-pieza'), await payload(planned, target)), [200, 201]);
    assert.equal((await readVisit(planned.visitId)).videos[0].tarea_edicion_id, null);
    const v = await video();
    const before = await snapshot();
    await assert.rejects(fixture.query(`UPDATE produccion_videos SET tarea_edicion_id=$1,editor_id=101001,
      fecha_entrega='2026-10-25' WHERE id=$2`, [target.task.id, v.videoId]), /unique constraint/i);
    assert.deepEqual(await snapshot(), before);
    // A different workflow task may legitimately refer to the same publication.
    const [extra] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,estado)
      VALUES ('QA independent publication workflow','QA editorial homonym',$1,$2,'diseno','pendiente') RETURNING id`, [client.id, existing.publication.id]);
    assert.ok(extra.id);
  });
  await t.test('association after an earlier handoff accepts exactly that existing task, never fuses two tasks', async () => {
    const v = await video();
    const handed = ok(await api(route(v, 'enviar-edicion'), { expected_revision: (await readVisit(v.visitId)).revision,
      editor_id: 101001, fecha_entrega: '2026-10-25' }), [201]);
    const canonicalId = handed.task.id;
    const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada)
      VALUES ($1,'video','pendiente','2026-10-29') RETURNING *`, [client.id]);
    ok(await api(`/tareas/${canonicalId}?workspace=render_os`, { publicacion_id: publication.id,
      expected_revision: handed.task.revision }, admin, 'PATCH'));
    const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo)
      VALUES ($1,'video',$2,$3,$4,'QA existing handoff goal') RETURNING *`, [goal.id, ++number, canonicalId, publication.id]);
    const target = { publication, slot, task: { id: canonicalId } };
    const wrong = await seed();
    const beforeWrong = await snapshot();
    assert.equal((await api(route(v, 'vincular-pieza'), await payload(v, wrong))).status, 409);
    assert.deepEqual(await snapshot(), beforeWrong);
    const tasks = await count('tareas');
    const linked = ok(await api(route(v, 'vincular-pieza'), await payload(v, target)), [200, 201]);
    assert.equal(linked.tarea_id, canonicalId);
    assert.equal(await count('tareas'), tasks);
    assert.equal((await readVisit(v.visitId)).videos[0].tarea_edicion_id, canonicalId);
  });
  await t.test('simultaneous association versus continuation preserves one editorial identity across the lineage', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = await video();
      ok(await api(`/producciones/${root.visitId}/videos/${root.videoId}`, {
        expected_revision: (await readVisit(root.visitId)).revision, estado: 'pendiente',
      }, admin, 'PATCH'));
      const destination = ok(await api('/producciones', { cliente_id: client.id, fecha: '2026-11-02',
        titulo: `QA concurrent continuation ${++number}`, participante_ids: [] }), [201]).visita;
      const target = await seed();
      const [association, continuation] = await Promise.all([
        api(route(root, 'vincular-pieza'), await payload(root, target)),
        api(`/producciones/${destination.id}/videos`, { expected_revision: destination.revision,
          video_origen_id: root.videoId, estado: 'pendiente' }),
      ]);
      for (const result of [association, continuation]) ok(result, [200, 201, 409]);
      assert.ok([200, 201].includes(association.status) || continuation.status === 201);
      if (continuation.status === 201) {
        const child = { visitId: destination.id, videoId: continuation.body.visita.videos[0].id };
        const next = await seed();
        const before = await snapshot();
        const linkedChild = await api(route(child, 'vincular-pieza'), await payload(child, next));
        if ([200, 201].includes(association.status)) {
          assert.equal(linkedChild.status, 409);
          assert.deepEqual(await snapshot(), before);
        } else ok(linkedChild, [200, 201]);
      }
      const rows = await fixture.query(`WITH RECURSIVE chain AS (
        SELECT id FROM produccion_videos WHERE id=$1 UNION ALL
        SELECT v.id FROM produccion_videos v JOIN chain c ON v.video_origen_id=c.id)
        SELECT v.publicacion_id FROM produccion_videos v JOIN chain c ON c.id=v.id WHERE v.publicacion_id IS NOT NULL`, [root.videoId]);
      assert.equal(rows.length, 1);
    }
  });
  await t.test('whole A-B-C lineage forbids multiple editorial associations in either winning order', async () => {
    const pending = async v => {
      ok(await api(`/producciones/${v.visitId}/videos/${v.videoId}`, {
        expected_revision: (await readVisit(v.visitId)).revision, estado: 'pendiente',
      }, admin, 'PATCH'));
    };
    const continueTo = async source => {
      const visit = ok(await api('/producciones', { cliente_id: client.id, fecha: '2026-11-02',
        titulo: `QA lineage ${++number}`, participante_ids: [] }), [201]).visita;
      const result = await api(`/producciones/${visit.id}/videos`, { expected_revision: visit.revision,
        video_origen_id: source.videoId, titulo: 'QA explicit continuation', estado: 'pendiente' });
      return { result, value: { visitId: visit.id, videoId: result.body.visita?.videos[0]?.id } };
    };
    // Association wins first: future continuation is forbidden rather than silently detaching history.
    const a = await video(); await pending(a);
    const target = await seed();
    ok(await api(route(a, 'vincular-pieza'), await payload(a, target)), [200, 201]);
    assert.equal((await continueTo(a)).result.status, 409);
    // Continuation wins first: only one member of the complete A -> B -> C chain may bind.
    const root = await video(); await pending(root);
    const b = await continueTo(root); ok(b.result, [201]);
    const c = await continueTo(b.value); ok(c.result, [201]);
    const leafTarget = await seed();
    ok(await api(route(c.value, 'vincular-pieza'), await payload(c.value, leafTarget)), [200, 201]);
    for (const ancestor of [root, b.value]) {
      const another = await seed();
      const before = await snapshot();
      assert.equal((await api(route(ancestor, 'vincular-pieza'), await payload(ancestor, another))).status, 409);
      assert.deepEqual(await snapshot(), before);
    }
  });
});
