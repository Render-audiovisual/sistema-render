import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';
import { buildEmployeeReport, employeeTaskDetails, employeeFormatBreakdown } from '../../frontend/src/shared/reports/production-registry-report.js';

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

// Real PostgreSQL -> principal cookie HTTP -> real frontend report models.
// Historical stored flags are synthetic fixtures, never fabricated approvals,
// editing deliveries or publication events. No external provider/device claim.
test('report approval projection preserves strict historical booleans and stored rows for admin and editor cookies', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55965, f = await startLocalHarness({ port, browserSessions: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA373 owned fixture cleanup ENOENT: ${f.root}; PostgreSQL port55965`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: 'postgresql://render2_fixture@127.0.0.1:55965/render2_local_test', identity });
  const base = new URL(f.base);
  assert.equal(base.protocol, 'http:'); assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.pathname, '/'); assert.equal(base.search, ''); assert.equal(base.hash, '');

  const cases = [
    { label: 'boolean true', stored: 'en_revision', extra: { revision_aprobada: true }, effective: 'aprobada' },
    { label: 'string true', stored: 'en_revision', extra: { revision_aprobada: 'true' }, effective: 'en_revision' },
    { label: 'boolean false', stored: 'en_revision', extra: { revision_aprobada: false }, effective: 'en_revision' },
    { label: 'missing flag', stored: 'en_revision', extra: {}, effective: 'en_revision' },
    { label: 'explicit approval', stored: 'aprobada', extra: {}, effective: 'aprobada' },
    { label: 'legacy completion', stored: 'publicada', extra: {}, effective: 'finalizada' },
  ];
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA375 shared effective-state client',true) RETURNING id");
  for (const item of cases) {
    const [task] = await f.query(`INSERT INTO tareas
      (titulo,asignado_a,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra,cliente_id)
      VALUES($1,'QA373 label is not identity',$2,'edicion','video','2026-10-20',$3::jsonb,$4) RETURNING id`,
    [`QA373 ${item.label}`, item.stored, JSON.stringify({ workspace: 'render_os', ...item.extra }), client.id]);
    item.id = task.id;
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [item.id]);
  }
  const actors = [
    { id: 91001, role: 'admin', username: 'qa_franco' },
    { id: 91003, role: 'edicion', username: 'qa_luciano' },
  ];
  for (const actor of actors) {
    actor.session = await loginProductionCookieSession(f.base, actor.username, fixturePassword);
    assert.equal(actor.session.user.id, actor.id); assert.equal(actor.session.user.rol, actor.role);
  }
  assert.notEqual(actors[0].session.cookie, actors[1].session.cookie, 'Independent cookie sessions');
  // Setup-only principal POST, before ALL read-only baselines. Project links
  // are synthetic SQL relationships, not an approval or publication workflow.
  const created = await productionCookieRequest(f.base, '/api/proyectos', {
    session: actors[0].session, method: 'POST', body: {
      request_id: randomUUID(), titulo: 'QA375 effective task-state project', cliente_id: client.id,
      responsable_id: 91003, miembro_ids: [], tipo: 'web', descripcion: 'Historical read-projection fixture',
      fecha_inicio: null, fecha_entrega: null,
    },
  });
  assert.equal(created.status, 201, 'Setup project must commit before read-only baseline');
  const projectId = created.body.proyecto.id;
  assert.match(projectId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  const ids = cases.map(item => item.id);
  await f.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id) SELECT $1,unnest($2::integer[])', [projectId, ids]);
  // Separate VALID domain cohort: project tasks cannot also belong to a
  // production video. Never disable guards or claim these are the same IDs.
  const [productionClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA376 production approval projection',true) RETURNING id");
  const visitId = randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'2026-10-20','QA376 synthetic historical visit',91001,91001)`, [visitId, productionClient.id]);
  await f.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) VALUES($1,91003)', [visitId]);
  const productionCases = [];
  for (const original of cases) {
    const [task] = await f.query(`INSERT INTO tareas
      (titulo,asignado_a,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra,cliente_id)
      VALUES($1,'QA376 label is not identity',$2,'edicion','video','2026-10-20',$3::jsonb,$4) RETURNING id`,
    [`QA376 ${original.label}`, original.stored, JSON.stringify({ workspace: 'render_os', ...original.extra }), productionClient.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [task.id]);
    const videoId = randomUUID();
    await f.query(`INSERT INTO produccion_videos
      (id,visita_id,titulo,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
      VALUES($1,$2,$3,'grabado',$4,91003,'2026-10-20',91001,91001)`,
    [videoId, visitId, `QA376 video ${original.label}`, task.id]);
    productionCases.push({ ...original, id: task.id, videoId });
  }
  const unlinkedVideoId = randomUUID();
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA376 unlinked LEFT JOIN remains null','planificado',91001,91001)`, [unlinkedVideoId, visitId]);
  const productionIds = productionCases.map(item => item.id), allIds = [...ids, ...productionIds];
  assert.equal(new Set(allIds).size, 12, 'Two disjoint six-task cohorts with no domain-guard bypass');
  assert.deepEqual(await f.query('SELECT tarea_id FROM proyecto_tareas WHERE tarea_id=ANY($1::integer[])', [productionIds]), []);
  const productionOracle = await f.query(`SELECT id,estado AS stored,
    CASE WHEN estado='en_revision' AND propiedades_extra->'revision_aprobada'='true'::jsonb
      THEN 'aprobada' ELSE estado END AS effective
    FROM tareas WHERE id=ANY($1::integer[]) ORDER BY id`, [productionIds]);
  assert.deepEqual(productionOracle, productionCases.map(item => ({ id: item.id, stored: item.stored,
    effective: item.stored === 'publicada' ? 'publicada' : item.effective })));
  // Independent SQL oracle: JSON boolean equality, never ->> text coercion.
  const oracle = await f.query(`SELECT id,estado AS stored,
    CASE WHEN estado='en_revision' AND propiedades_extra->'revision_aprobada'='true'::jsonb
      THEN 'aprobada' ELSE estado END AS effective
    FROM tareas WHERE id=ANY($1::integer[]) ORDER BY id`, [ids]);
  assert.deepEqual(oracle, cases.map(item => ({ id: item.id, stored: item.stored,
    effective: item.stored === 'publicada' ? 'publicada' : item.effective })));
  // Calendar/client/project read DTOs retain the legacy publicada value;
  // employee report models intentionally normalize only its presentation.
  const expectedStates = oracle.map(row => ({ id: row.id, estado: row.effective }));
  const expectedCounts = { pendiente: 0, en_progreso: 0, en_revision: 3, aprobada: 2, finalizada: 1, otros: 0 };
  const rawTasks = () => f.query(`SELECT id,estado,propiedades_extra,revision,xmin::text AS xmin,ctid::text AS ctid
    FROM tareas WHERE id=ANY($1::integer[]) ORDER BY id`, [allIds]);
  const rawBefore = await rawTasks();

  // Baseline only AFTER fixture setup and both logins. Hash ALL public tables,
  // including auth, events and deliveries; return opaque digests, not financial
  // fields or credentials. xmin/ctid also catch identical-value row UPDATEs.
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row => row.tablename);
  async function snapshot() {
    const hashes = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  const before = await snapshot();
  const range = Object.freeze({ desde: '2026-10-01', hasta: '2026-11-01' });
  const reportPath = '/api/reportes/datos?mes_configuracion=2026-10&desde=2026-10-01&hasta=2026-10-31';
  for (const actor of actors) await t.test(`${actor.role}: effective approval is not review, finalization or publication`, async () => {
    const response = await productionCookieRequest(f.base, reportPath, { session: actor.session });
    assert.equal(response.status, 200, 'Expected report HTTP success without printing session/body');
    const data = response.body, original = structuredClone(data);
    freezeTree(data);
    const allTasks = [...data.tareas, ...data.tareasRenderOs];
    assert.deepEqual(allTasks.map(task => task.id).sort((a, b) => a - b), [...allIds].sort((a, b) => a - b));
    const wholeEditor = buildEmployeeReport(data.usuarios, allTasks, range, '2026-10-25').rows.find(row => row.id === 91003);
    assert.deepEqual({ total: wholeEditor.total, enRevision: wholeEditor.enRevision, aprobadas: wholeEditor.aprobadas,
      finalizadas: wholeEditor.finalizadas, pendientes: wholeEditor.pendientes },
    { total: 12, enRevision: 6, aprobadas: 4, finalizadas: 2, pendientes: 10 });
    const productionTasks = allTasks.filter(task => productionIds.includes(task.id));
    assert.equal(productionTasks.length, 6);
    for (const item of productionCases) {
      const task = productionTasks.find(row => row.id === item.id);
      assert.equal(task.estado, item.stored, 'Raw Reportes task DTO remains historical');
      assert.deepEqual(task.propiedades_extra, { workspace: 'render_os', ...item.extra });
    }
    assert.deepEqual(employeeTaskDetails(productionTasks, 91003, range).map(row => ({ id: row.id,
      estado: row.estado, estado_almacenado: row.estado_almacenado })).sort((a, b) => a.id - b.id),
    productionCases.map(item => ({ id: item.id, estado: item.effective, estado_almacenado: item.stored })));
    const tasks = allTasks.filter(task => ids.includes(task.id));
    assert.equal(tasks.length, cases.length);
    for (const item of cases) {
      const task = tasks.find(row => row.id === item.id);
      assert.ok(task, item.label); assert.equal(task.estado, item.stored);
      assert.equal(task.asignado_a_id, 91003);
      assert.deepEqual(task.propiedades_extra, { workspace: 'render_os', ...item.extra });
      assert.equal(task.historia_id, null); assert.equal(task.publicacion_id, null);
    }
    const report = buildEmployeeReport(data.usuarios, tasks, range, '2026-10-25');
    const editor = report.rows.find(row => row.id === 91003);
    assert.deepEqual({ total: editor.total, enRevision: editor.enRevision, aprobadas: editor.aprobadas,
      finalizadas: editor.finalizadas, pendientes: editor.pendientes },
    { total: 6, enRevision: 3, aprobadas: 2, finalizadas: 1, pendientes: 5 });
    assert.equal(report.uniqueTasks, 6); assert.equal(report.unattributed, 0);
    assert.equal(report.rows.find(row => row.id === 91001).total, 0, 'Viewer identity does not acquire editor credit');
    const details = employeeTaskDetails(tasks, 91003, range);
    assert.equal(details.length, cases.length);
    for (const item of cases) {
      const detail = details.find(row => row.id === item.id);
      assert.equal(detail.estado, item.effective, item.label);
      assert.equal(detail.estado_almacenado, item.stored, item.label);
      assert.equal(detail.formato, 'reels');
      assert.equal(detail.finalizada, '', 'Approval cannot invent a completion timestamp');
      assert.equal(detail.href, `/workspace/tareas?task=${item.id}`);
    }
    assert.deepEqual(employeeTaskDetails(tasks, 91001, range), []);
    assert.deepEqual(employeeFormatBreakdown(tasks, 91003, range), [
      { formato: 'carruseles', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
      { formato: 'reels', total: 6, finalizadas: 1, enRevision: 3, aprobadas: 2 },
      { formato: 'historias', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
      { formato: 'otros', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
    ]);
    assert.deepEqual(data, original, 'Real report models preserve the deeply frozen HTTP DTO');
    assert.deepEqual(await snapshot(), before, 'Report HTTP/model reads preserve every stored row and physical tuple');
  });
  const expectedVideos = productionCases.map((item, index) => ({ id: item.videoId, tarea_edicion_id: item.id,
    tarea_estado: productionOracle[index].effective, editor_actual_id: 91003, fecha_entrega_actual: '2026-10-20', estado: 'grabado' }))
    .sort((a, b) => a.tarea_edicion_id - b.tarea_edicion_id);
  for (const actor of actors) for (const consumer of ['registry detail', 'registry list', 'Reportes producciones'])
    await t.test(`${actor.role}: ${consumer} projects production editing task approval without rewriting raw history`, async () => {
      const path = consumer === 'registry detail' ? `/api/producciones/${visitId}`
        : consumer === 'registry list' ? `/api/producciones?mes=2026-10&cliente_id=${productionClient.id}` : reportPath;
      const result = await productionCookieRequest(f.base, path, { session: actor.session });
      assert.equal(result.status, 200, 'Expected production read success without printing cookie/body');
      const visits = consumer === 'registry detail' ? [result.body.visita]
        : consumer === 'registry list' ? result.body.visitas : result.body.producciones.visitas;
      assert.equal(visits.length, 1);
      const visit = visits[0];
      assert.equal(visit.id, visitId); assert.equal(visit.cliente_id, productionClient.id);
      assert.equal(visit.fecha, '2026-10-20'); assert.equal(visit.tarea_origen_id, null);
      assert.deepEqual(visit.participante_ids, [91003]); assert.deepEqual(visit.fotos, []);
      assert.equal(visit.videos.length, 7);
      const unlinked = visit.videos.find(video => video.id === unlinkedVideoId);
      assert.ok(unlinked, 'Seventh video has no editing-task binding');
      assert.equal(unlinked.tarea_edicion_id, null); assert.equal(unlinked.tarea_estado, null);
      assert.equal(unlinked.editor_actual_id, null); assert.equal(unlinked.fecha_entrega_actual, null);
      assert.equal(unlinked.estado, 'planificado');
      const actualVideos = visit.videos.filter(video => video.id !== unlinkedVideoId).map(video => Object.fromEntries(
        ['id', 'tarea_edicion_id', 'tarea_estado', 'editor_actual_id', 'fecha_entrega_actual', 'estado'].map(key => [key, video[key]])))
        .sort((a, b) => a.tarea_edicion_id - b.tarea_edicion_id);
      // Read projections must preserve all raw historical tuples, including
      // the unlinked video's NULL task state from the LEFT JOIN.
      assert.deepEqual(await rawTasks(), rawBefore);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(actualVideos, expectedVideos, 'Only boolean true projects approved; string true stays review and legacy publicada stays publicada');
    });
  const sortedStates = rows => rows.map(row => ({ id: row.id, estado: row.estado })).sort((a, b) => a.id - b.id);
  for (const actor of actors) await t.test(`${actor.role}: Calendar, client operation and project detail agree on the same six stored tasks`, async () => {
    const get = async path => {
      const result = await productionCookieRequest(f.base, path, { session: actor.session });
      assert.equal(result.status, 200, 'Expected operational read success without printing credentials/body');
      return result.body;
    };
    const query = new URLSearchParams({ ...range, scope: 'team', kind: 'all', cliente_id: String(client.id) });
    const calendar = await get(`/api/calendario?${query}`);
    assert.deepEqual(calendar.range, range); assert.equal(calendar.truncated, false);
    assert.equal(calendar.events.length, cases.length, 'No fabricated visit/milestone/editorial events');
    assert.deepEqual(sortedStates(calendar.events.map(event => ({ id: event.source_id, estado: event.estado }))), expectedStates);
    for (const event of calendar.events) {
      assert.equal(event.kind, 'tarea'); assert.equal(event.source, 'tarea');
      assert.equal(event.evidence, null); assert.equal(event.date, '2026-10-20');
      assert.equal(event.cliente_id, client.id); assert.deepEqual(event.responsable_ids, [91003]);
      assert.equal(event.href, `/workspace/tareas?task=${event.source_id}`);
    }
    assert.deepEqual(await snapshot(), before, 'Calendar reads do not rewrite stored approval');
    const operation = await get(`/api/clientes/${client.id}/operacion?periodo=2026-10`);
    assert.equal(operation.cliente.id, client.id); assert.equal(operation.tareas.total, 6);
    assert.equal(operation.tareas.has_more, false);
    assert.deepEqual(operation.tareas.counts, expectedCounts, 'Only boolean true leaves review; legacy publicada counts as finalized');
    assert.deepEqual(sortedStates(operation.tareas.items), expectedStates);
    for (const item of operation.tareas.items) assert.equal(item.href, `/workspace/tareas?task=${item.id}`);
    assert.deepEqual(await snapshot(), before, 'Client-operation summaries remain read-only');
    const { proyecto: project } = await get(`/api/proyectos/${projectId}`);
    assert.equal(project.id, projectId); assert.equal(project.cliente.id, client.id);
    assert.equal(project.tareas_no_disponibles, 0);
    assert.deepEqual(project.counts, { tareas: 6, finalizadas: 1, hitos: 0, entregables: 0 });
    assert.deepEqual(sortedStates(project.tareas), expectedStates);
    for (const item of project.tareas) {
      assert.equal(item.fecha_vencimiento, '2026-10-20');
      assert.equal(item.href, `/workspace/tareas?task=${item.id}`);
    }
    assert.deepEqual(await rawTasks(), rawBefore, 'Operational consumers preserve raw state/metadata/revision/xmin/ctid');
    assert.deepEqual(await snapshot(), before, 'Project detail preserves every public table');
  });
  for(const table of ['historias','publicaciones','editorial_publicacion_eventos','task_editing_deliveries','task_editing_reviews'])
    assert.equal((await f.query(`SELECT count(*)::int n FROM ${table}`))[0].n,0,
      'Read-only approval projection cannot manufacture editorial pieces, publication evidence or artifact decisions');
  assert.deepEqual(await rawTasks(), rawBefore);
  assert.deepEqual(await snapshot(), before);
  t.diagnostic(`QA375 all ${tables.length} public-table JSON/xmin/ctid hashes unchanged after both cookie actors and all readers`);
});
