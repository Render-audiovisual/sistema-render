import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const marker = 'QA_REPORT_PRIVATE_FINANCE_55602';
const amount = 789654.32;
const privateBag = { importe: amount, future_money: { nested: [{ marker }] } };

test('shared production reporting and task context: stable IDs, privacy and range reload', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55602 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-report fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  const users = [];
  for (const [id, rol] of [[99001, 'edicion'], [99002, 'edicion'], [99003, 'community'], [99004, 'qa_unknown']]) {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_report_${id}`, id <= 99002 ? 'QA Report Shared' : `QA Report ${id}`, rol]);
    users.push({ id, token: await login(`qa_report_${id}`), rol });
  }
  const admin = await login('qa_franco');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA reporting client') RETURNING id");
  const taskDetail = async id => {
    const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const patchTask = async (id, token, body) => {
    const current = await taskDetail(id);
    return api(`/tareas/${id}?workspace=render_os`, { token, method: 'PATCH',
      body: { expected_revision: current.revision, expected_updated_at: current.updated_at, ...body } });
  };
  const created = await api('/tareas', { token: admin, method: 'POST', body: {
    titulo: 'QA visita reporting source', workspace: 'render_os', asignado_a_id: 99001, colaborador_ids: [],
    cliente_id: client.id, fecha_vencimiento: '2026-10-20', tipo_tarea: 'produccion', subtipo: 'visita',
    produccion_videos_previstos: 3,
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sourceId = created.body.id;
  const [link] = await fixture.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [sourceId]);
  assert.ok(link);
  const visitId = link.id;
  const readVisit = async () => {
    const result = await api(`/producciones/${visitId}`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.visita;
  };
  const videoIds = [];
  for (let number = 0; number < 3; number++) {
    const current = await readVisit();
    const result = await api(`/producciones/${visitId}/videos`, { token: users[2].token, method: 'POST', body: {
      expected_revision: current.revision, titulo: `QA reporting video ${number}`, guion: `QA private working script ${number}`,
      estado: number < 2 ? 'grabado' : 'pendiente', material_url: 'https://example.invalid/qa-report-material',
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    videoIds.push(result.body.visita.videos.find(video => video.titulo === `QA reporting video ${number}`).id);
  }
  const photo = await api(`/producciones/${visitId}/fotos`, { token: users[3].token, method: 'POST', body: {
    expected_revision: (await readVisit()).revision, tipo: 'QA reporting product photo', estado: 'realizada',
  } });
  assert.equal(photo.status, 201, JSON.stringify(photo.body));
  const photoId = photo.body.visita.fotos[0].id;
  const sent = await api(`/producciones/${visitId}/videos/${videoIds[0]}/enviar-edicion`, { token: admin, method: 'POST', body: {
    expected_revision: (await readVisit()).revision, editor_id: 99001, fecha_entrega: '2026-10-28',
  } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const editingId = sent.body.task.id;
  const fixtures = {};
  for (const workspace of ['historical', 'render_os']) {
    fixtures[workspace] = [];
    for (const ownerId of [99001, 99002, null]) {
      const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
        VALUES ($1,'QA Report Shared',$2,'pendiente','edicion','video','2026-10-22',$3::jsonb) RETURNING id`,
      [`QA ${workspace} report ${ownerId ?? 'unmapped'}`, client.id, JSON.stringify({
        ...(workspace === 'render_os' ? { workspace: 'render_os' } : {}), ...privateBag,
        edicion_responsable: { ...privateBag, marker }, colaboradores: ['QA Report Shared'],
        produccion_registros: [{ cantidad: 1, fecha: '2026-10-20', ...privateBag }],
      })]);
      if (ownerId) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, ownerId]);
      fixtures[workspace].push({ id: task.id, ownerId });
    }
  }
  // Financial poison is actual persisted data, not a fake serialized object.
  for (const id of [sourceId, editingId]) await fixture.query('UPDATE tareas SET propiedades_extra=propiedades_extra || $2::jsonb WHERE id=$1',
    [id, JSON.stringify({ ...privateBag, resumen: { marker, importe: amount } })]);
  const [unlinked] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,propiedades_extra)
    VALUES ('QA unlinked spoofed registry metadata','QA Report Shared',$1::jsonb) RETURNING id`,
  [JSON.stringify({ workspace: 'render_os', produccion_visita_id: visitId, origen_produccion_video_id: videoIds[0], ...privateBag })]);
  await fixture.query(`INSERT INTO entregas_edicion(editor_clave,fecha_entrega,cliente_etiqueta,categoria,importe,fuente,fuente_item,confirmado_por)
    VALUES ('QA Report Shared','2026-10-20','QA report financial control','A',$1,'qa-report-fixture',55602,'QA admin')`, [amount]);
  const noPrivate = body => {
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(marker), 'Nested financial marker leaked');
    assert.ok(!serialized.includes(String(amount)), 'Financial amount leaked');
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        assert.ok(!['metadata', 'importe', 'future_money'].includes(key), `Unallowed structured key: ${key}`);
        walk(nested);
      }
    };
    walk(body);
  };
  const report = async (token, desde = '2026-10-01', hasta = '2026-11-01') => {
    const result = await api(`/reportes/datos?mes_configuracion=2026-10&desde=${desde}&hasta=${hasta}`, { token });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const context = async (taskId, token = admin) => {
    const result = await api(`/producciones/tareas/${taskId}`, { token });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    noPrivate(result.body);
    return result.body.vinculo;
  };
  const exactKeys = (value, allowed) => assert.deepEqual(Object.keys(value).sort(), [...allowed].sort());
  const scopedSummary = body => {
    const expected = {};
    for (const task of body.tareasRenderOs) {
      if (task.tipo_tarea !== 'edicion' || task.propiedades_extra?.archivada_render_os === true) continue;
      const day = String(task.fecha_vencimiento || task.updated_at || '').slice(0, 10);
      expected[day] ??= {};
      expected[day].ediciones ??= { total: 0, publicadas: 0 };
      expected[day].ediciones.total++;
      if (['finalizada', 'publicada'].includes(task.estado)) expected[day].ediciones.publicadas++;
    }
    assert.deepEqual(body.resumenRenderOsPorDia, expected, 'Daily summary must derive from returned ID-scoped tasks, never the global task set');
  };

  await t.test('shared report uses stable registry/media IDs and explicit fields for every active role', async () => {
    let expected;
    for (const token of [admin, ...users.map(user => user.token)]) {
      const body = await report(token);
      const shared = body.producciones;
      assert.ok(shared);
      exactKeys(shared, ['desde', 'hasta', 'visitas']);
      assert.equal(shared.desde, '2026-10-01');
      assert.equal(shared.hasta, '2026-11-01');
      const visit = shared.visitas.find(row => row.id === visitId);
      assert.ok(visit);
      exactKeys(visit, ['id', 'tarea_origen_id', 'cliente_id', 'cliente_nombre', 'fecha', 'titulo', 'participante_ids', 'videos', 'fotos']);
      assert.equal(visit.tarea_origen_id, sourceId);
      assert.deepEqual(visit.participante_ids, [99001]);
      assert.equal(visit.videos.length, 3);
      assert.equal(visit.videos.filter(video => video.estado === 'grabado').length, 2);
      assert.deepEqual(visit.videos.map(video => video.id).sort(), [...videoIds].sort());
      for (const video of visit.videos) exactKeys(video, ['id', 'titulo', 'estado', 'tarea_edicion_id', 'tarea_estado', 'editor_actual_id', 'fecha_entrega_actual']);
      assert.equal(visit.fotos.length, 1);
      exactKeys(visit.fotos[0], ['id', 'tipo', 'estado']);
      assert.equal(visit.fotos[0].id, photoId);
      noPrivate(shared);
      if (expected) assert.deepEqual(shared, expected, 'Shared registry must not be filtered by personal role/name');
      else expected = shared;
    }
  });
  await t.test('non-admin ordinary resources and own users are ID-scoped despite exact homonyms and stale JSON names', async () => {
    for (const user of users) {
      const body = await report(user.token);
      noPrivate(body);
      scopedSummary(body);
      assert.deepEqual(body.usuarios.map(row => row.id), [user.id]);
      assert.deepEqual(body.entregasEdicion, [], 'Legacy deliveries without editor ID cannot be inferred from matching names');
      for (const [workspace, key] of [['historical', 'tareas'], ['render_os', 'tareasRenderOs']]) {
        const rows = body[key];
        for (const task of fixtures[workspace]) {
          if (task.ownerId === user.id) assert.ok(rows.some(row => row.id === task.id), `Missing own ${workspace} ID`);
          else assert.ok(!rows.some(row => row.id === task.id), `Foreign/unmapped ${workspace} task leaked by name`);
        }
      }
      if (user.id === 99001) assert.ok(body.tareasRenderOs.some(row => row.id === editingId));
      else assert.ok(!body.tareasRenderOs.some(row => row.id === editingId));
    }
    const raw = await report(admin);
    assert.ok(raw.entregasEdicion.some(row => row.fuente === 'qa-report-fixture' && Number(row.importe) === amount),
      'Admin financial control must remain nonempty');
  });
  await t.test('source/editing context is a small relation DTO, not task metadata or financial data', async () => {
    for (const user of users) for (const [id, tipo] of [[sourceId, 'origen'], [editingId, 'edicion']]) {
      const relation = await context(id, user.token);
      exactKeys(relation, ['id', 'fecha', 'revision', 'tipo', 'videos_total', 'videos_grabados', 'fotos_total', 'usa_registro_individual']);
      assert.equal(relation.id, visitId);
      assert.equal(relation.tipo, tipo);
      assert.equal(relation.fecha, '2026-10-20');
      assert.ok(Number.isSafeInteger(relation.revision));
      assert.equal(relation.videos_total, 3);
      assert.equal(relation.videos_grabados, 2);
      assert.equal(relation.fotos_total, 1);
      assert.equal(relation.usa_registro_individual, true);
    }
    assert.equal(await context(unlinked.id, users[1].token), null, 'Spoofed JSON cannot manufacture a registry relation');
    assert.equal(await context(2147483646, users[3].token), null);
    for (const id of ['0', '-1', '1.5', 'not-an-id'])
      assert.equal((await api(`/producciones/tareas/${id}`, { token: users[0].token })).status, 400);
  });
  await t.test('editing task transitions join live report state without inventing actual publication', async () => {
    const before = await fixture.query('SELECT * FROM publicaciones ORDER BY id');
    for (const [estado, token] of [['en_progreso', users[0].token], ['en_revision', users[0].token], ['aprobada', admin], ['finalizada', admin]]) {
      const result = await patchTask(editingId, token, { estado });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const body = await report(users[1].token);
      const video = body.producciones.visitas.find(row => row.id === visitId).videos.find(row => row.id === videoIds[0]);
      assert.equal(video.tarea_edicion_id, editingId);
      assert.equal(video.tarea_estado, estado);
      assert.equal(video.estado, 'grabado');
      assert.equal(video.editor_actual_id, 99001);
      assert.equal(video.fecha_entrega_actual, '2026-10-28');
      noPrivate(body);
    }
    assert.deepEqual(await fixture.query('SELECT * FROM publicaciones ORDER BY id'), before);
  });
  await t.test('manual visit postponement changes range membership after reload/new login but preserves stable IDs and editing due date', async () => {
    const current = await readVisit();
    const moved = await api(`/producciones/${visitId}`, { token: admin, method: 'PATCH', body: {
      expected_revision: current.revision, fecha: '2026-11-10',
    } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const token = await login('qa_report_99003');
    assert.ok(!(await report(token)).producciones.visitas.some(row => row.id === visitId));
    const november = await report(token, '2026-11-01', '2026-12-01');
    const visit = november.producciones.visitas.find(row => row.id === visitId);
    assert.ok(visit);
    assert.equal(visit.fecha, '2026-11-10');
    assert.deepEqual(visit.videos.map(video => video.id).sort(), [...videoIds].sort());
    assert.equal(visit.fotos[0].id, photoId);
    assert.equal((await context(sourceId, token)).fecha, '2026-11-10');
    assert.equal((await taskDetail(sourceId)).fecha_vencimiento, '2026-11-10');
    assert.equal((await taskDetail(editingId)).fecha_vencimiento, '2026-10-28');
    noPrivate(november);
    // Visit filtering cannot make the still-returned source look like an old
    // aggregate visit: this SQL-computed relation flag is range-independent.
    const ownerOctober = await report(users[0].token);
    const source = ownerOctober.tareasRenderOs.find(row => row.id === sourceId);
    assert.ok(source);
    assert.equal(source.produccion_registro_individual, true);
    assert.equal(typeof source.produccion_registro_individual, 'boolean');
    assert.ok(!ownerOctober.producciones.visitas.some(row => row.id === visitId));
    const legacyCandidates = ownerOctober.tareasRenderOs.filter(row => row.tipo_tarea === 'produccion' && row.produccion_registro_individual !== true);
    assert.ok(!legacyCandidates.some(row => row.id === sourceId), 'Frontend legacy-dedupe predicate must exclude normalized source outside current range');
    const regular = ownerOctober.tareasRenderOs.find(row => row.id === fixtures.render_os[0].id);
    assert.equal(regular.produccion_registro_individual, false);
    scopedSummary(ownerOctober);
  });
  await t.test('report dates require complete valid bounded ranges; default uses the selected calendar month', async () => {
    const valid = await api('/reportes/datos?mes_configuracion=2026-10', { token: users[3].token });
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.equal(valid.body.producciones.desde, '2026-10-01');
    assert.equal(valid.body.producciones.hasta, '2026-11-01');
    for (const query of ['desde=2026-10-01', 'desde=2026-02-30&hasta=2026-03-01',
      'desde=2026-10-01&hasta=2026-10-01', 'desde=2026-11-01&hasta=2026-10-01', 'desde=2026-01-01&hasta=2027-01-03'])
      assert.equal((await api(`/reportes/datos?${query}`, { token: users[0].token })).status, 400);
  });
});
