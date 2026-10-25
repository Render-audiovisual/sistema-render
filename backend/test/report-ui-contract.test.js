import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildEmployeeReport, buildHistoricalProductionReport, buildProductionRegistryReport, historicalUnassignedEditingCount, inReportRange, reportTaskPeople, uniqueReportTasks, employeeTaskDetails, employeeFormatBreakdown, editorialRecords, summarizeEditorialRecords, personalEditorialReport, clientQuotaReport } from '../../frontend/src/shared/reports/production-registry-report.js';

const range = { desde: '2026-10-01', hasta: '2026-11-01' };
const users = [{ id: 1, nombre: 'Alex', rol: 'produccion' }, { id: 2, nombre: 'Alex', rol: 'edicion' }];
const task = (id, extra = {}) => ({ id, estado: 'pendiente', fecha_vencimiento: '2026-10-10', ...extra });
const visit = (id, extra = {}) => ({ id, cliente_id: 4, cliente_nombre: 'Cliente', fecha: '2026-10-10', participante_ids: [1, 2, 1], videos: [], fotos: [], ...extra });
const payload = visitas => ({ ...range, visitas });

test('employee attribution uses IDs only: same names, renames and legacy names never merge people', () => {
  const tasks = [task(1, { asignado_a_id: 1, asignado_a: 'Old name' }), task(2, { asignado_a_id: 2 }), task(3, { asignado_a: 'Alex' }), task(4, { asignado_a_id: '1' })];
  const result = buildEmployeeReport(users, tasks, range, '2026-10-19');
  assert.deepEqual(result.rows.map(row => [row.id, row.total]), [[1, 1], [2, 1]]);
  assert.equal(result.unattributed, 2);
  assert.equal(result.uniqueTasks, 4);
  const renamed = buildEmployeeReport([{ ...users[0], nombre: 'Renamed' }, users[1]], tasks, range, '2026-10-19');
  assert.equal(renamed.rows[0].total, 1);
  assert.equal(renamed.rows[0].nombre, 'Renamed');
});

test('collaborators deduplicate per person, task IDs deduplicate sources, no title/name heuristics', () => {
  const shared = task(1, { asignado_a_id: 1, colaborador_ids: [1, 2, 2, null, '2'], estado: 'en_revision' });
  assert.deepEqual(reportTaskPeople(shared), [1, 2]);
  assert.equal(uniqueReportTasks([shared], [{ ...shared, estado: 'aprobada' }]).length, 1);
  assert.equal(uniqueReportTasks([shared, { ...shared, id: 2 }]).length, 2);
  const report = buildEmployeeReport(users, [shared, shared], range, '2026-10-19');
  assert.equal(report.uniqueTasks, 1);
  assert.deepEqual(report.rows.map(row => row.enRevision), [1, 1]);
  assert.deepEqual(report.rows.map(row => row.finalizadas), [0, 0]);
});

test('review, approval, finalization aliases and overdue are distinct; no invented capacity', () => {
  const tasks = ['en_revision', 'aprobada', 'finalizada', 'publicada', 'pendiente'].map((estado, i) => task(i + 1, { estado, asignado_a_id: 1 }));
  const result = buildEmployeeReport(users, tasks, range, '2026-10-19');
  assert.deepEqual(result.rows[0], { id: 1, nombre: 'Alex', rol: 'produccion', total: 5, enRevision: 1, aprobadas: 1, finalizadas: 2, pendientes: 3, vencidas: 3 });
  assert.equal(result.rows[1].total, 0);
});

test('date scope is inclusive/exclusive and archived work does not enter employee rows', () => {
  assert.equal(inReportRange('2026-10-01', range), true);
  assert.equal(inReportRange('2026-11-01', range), false);
  assert.equal(inReportRange(undefined, range), false);
  const tasks = [task(1, { fecha_vencimiento: '2026-10-01' }), task(2, { fecha_vencimiento: '2026-11-01' }), task(3, { propiedades_extra: { archivada_render_os: true } })];
  assert.equal(buildEmployeeReport(users, tasks, range, '2026-10-19').uniqueTasks, 1);
});

test('production shows dynamic clients and visit-day contents, deduplicating global media IDs', () => {
  const report = buildProductionRegistryReport(payload([
    visit('visit-a', { videos: [{ id: 'v1', titulo: 'Video', estado: 'grabado' }], fotos: [{ id: 'p1', tipo: 'Producto', estado: 'realizada' }] }),
    visit('visit-b', { cliente_id: 5, cliente_nombre: 'Otro', videos: [{ id: 'v1', estado: 'grabado' }, { id: 'v2', estado: 'repetir' }] }),
    visit('visit-a'), visit('out', { fecha: '2026-11-01', videos: [{ id: 'excluded' }] }),
  ]), users, range);
  assert.equal(report.visits, 2);
  assert.equal(report.videos, 2);
  assert.equal(report.recorded, 1);
  assert.equal(report.photos, 1);
  assert.equal(report.realizedPhotos, 1);
  assert.equal(report.clients.flatMap(client => client.visits).flatMap(row => row.videos).length, 2);
  assert.deepEqual(report.clients[0].visits[0].participants, [{ id: 1, nombre: 'Alex' }, { id: 2, nombre: 'Alex' }]);
});

test('empty visits and unknown participant IDs stay visible without fabricated authorship', () => {
  const report = buildProductionRegistryReport(payload([visit('v', { participante_ids: [999], videos: [{ id: 'x', estado: 'unknown' }] }), visit('empty')]), [], range);
  assert.deepEqual(report.clients[0].visits[0].participants, [{ id: 999, nombre: 'Usuario #999' }]);
  assert.equal(report.visits, 2);
  assert.equal(report.recorded, 0);
  assert.equal(report.videos, 1);
});

test('historical aggregate excludes ANY normalized media source, including photos and outside-range visits', () => {
  const production = buildProductionRegistryReport(payload([
    visit('photo', { tarea_origen_id: 1, fotos: [{ id: 'p' }] }),
    visit('outside', { tarea_origen_id: 2, fecha: '2026-09-30', videos: [{ id: 'v' }] }),
    visit('empty', { tarea_origen_id: 3 }),
  ]), users, range);
  const tasks = [1, 2, 3].map(id => task(id, { cliente_id: 4, cliente_nombre: 'Cliente', propiedades_extra: { produccion_registros: [{ fecha: '2026-10-05', cantidad: 5 }] } }));
  assert.deepEqual([...production.normalizedSourceIds], [1, 2]);
  const historical = buildHistoricalProductionReport([...tasks, tasks[2]], production.normalizedSourceIds, range);
  assert.deepEqual(historical, [{ id: 4, nombre: 'Cliente', recorded: 5 }]);
  assert.equal(production.videos, 0);
});

test('historical allocations preserve month amounts, never infer individual videos or rolling-day allocation', () => {
  const tasks = [task(1, { cliente_id: 4, propiedades_extra: { produccion_registros: [
    { fecha: '2026-10-06', periodo_objetivo: '2026-10', cantidad: 8, cantidad_mes_actual: 5, periodo_adelanto: '2026-11', cantidad_adelanto: 3 },
    { fecha: '2026-10-12', cantidad: -4 },
  ] } })];
  assert.equal(buildHistoricalProductionReport(tasks, new Set(), range)[0].recorded, 5);
  assert.equal(buildHistoricalProductionReport(tasks, new Set(), { desde: '2026-11-01', hasta: '2026-12-01' })[0].recorded, 3);
  assert.deepEqual(buildHistoricalProductionReport(tasks, new Set(), { desde: '2026-10-02', hasta: '2026-11-01' }), []);
});

test('DB-global individual flag excludes rescheduled sources absent from current month visits', () => {
  const source = task(1, { produccion_registro_individual: true, propiedades_extra: { produccion_registros: [{ fecha: '2026-10-03', cantidad: 9 }] } });
  const production = buildProductionRegistryReport(payload([]), users, range);
  assert.deepEqual(buildHistoricalProductionReport([source], production.normalizedSourceIds, range), []);
  assert.equal(buildHistoricalProductionReport([{ ...source, produccion_registro_individual: false }], new Set(), range)[0].recorded, 9);
});

test('legacy editing names never resolve to employees; unassigned history deduplicates delivery IDs', () => {
  const rows = [{ id: 1, fecha_entrega: '2026-10-04', editor_clave: 'Alex' }, { id: 1, fecha_entrega: '2026-10-04' }, { id: 2, fecha_entrega: '2026-10-04', editor_id: 1 }, { id: 3, fecha_entrega: '2026-11-01' }];
  assert.equal(historicalUnassignedEditingCount(rows, range), 1);
  assert.equal(buildEmployeeReport(users, [], range, '2026-10-19').rows[0].finalizadas, 0);
});

test('missing/mismatched normalized DTO is unavailable, not a fabricated zero registry', () => {
  assert.equal(buildProductionRegistryReport(undefined, users, range).available, false);
  assert.equal(buildProductionRegistryReport({ ...range, hasta: '2026-10-31', visitas: [] }, users, range).available, false);
  assert.equal(buildProductionRegistryReport(payload([]), users, range).available, true);
});

test('report projections omit raw metadata and financial extras', () => {
  const secret = 'FINANCIAL_SENTINEL';
  const report = buildProductionRegistryReport(payload([visit('v', { metadata: { salary: secret }, videos: [{ id: 'x', titulo: 'Video', estado: 'grabado', financial: secret }] })]), users, range);
  const employees = buildEmployeeReport(users, [task(1, { asignado_a_id: 1, financial: secret, propiedades_extra: { salary: secret } })], range, '2026-10-19');
  assert.equal(JSON.stringify([report, employees]).includes(secret), false);
});

test('UI requests bounded report DTO and does not use local identities, name matching or estimated quotas', () => {
  const source = readFileSync(new URL('../../frontend/src/pages/Reportes.jsx', import.meta.url), 'utf8');
  assert.match(source, /new URLSearchParams\(\{ desde: range.desde, hasta: range.hasta/);
  assert.match(source, /data\?\.producciones/);
  assert.match(source, /Histórico · Filmaciones agregadas/);
  assert.doesNotMatch(source, /belongsToPerson|nombrePropio|OBJETIVOS_MENSUALES_EQUIPO|getDesignerCarouselTaskSummary|groupProductionByClient|mergeReportTaskSources/);
  assert.match(source, /useSessionView\(getSesion\(\)\)/);
  assert.match(source, /createReportLoader\(\{ session, readSession: getSesion/);
  assert.match(source, /loader.current\(\) && payload/);
  assert.doesNotMatch(source, /data\?\.(finance|sueldos|contratos)|\/api\/(sueldos|contratos)/);
});

const confirmedEditorial = (item, occurred_at) => ({ ...item, cliente_id: item.cliente_id || 1, estado: 'publicada',
  'fecha_publicación_real': occurred_at, publicacion_evidencia: { classification: 'confirmada_manualmente', revision: 1,
    confirmation: { id: `34349ff1-15c7-4d7b-9c14-${String(item.id).padStart(12, '0')}`, actor_id: 1, source: 'manual', occurred_at, recorded_at: occurred_at } } });

test('editorial actual-date counts require explicit manual evidence, separate from schedule and legacy', () => {
  const records = editorialRecords([confirmedEditorial({ id: 1, fecha_programada: '2026-09-15' }, '2026-10-02T12:00:00Z')], [
    { id: 1, tipo: 'carrusel', estado: 'publicada', fecha_programada: '2026-10-10' },
    confirmedEditorial({ id: 2, tipo: 'video', fecha_programada: '2026-10-11' }, '2026-11-01T03:00:00Z'),
    { id: 3, tipo: 'video', estado: 'lista', fecha_programada: '2026-10-12', 'fecha_publicación_real': '2026-10-12' },
    { id: 4, tipo: 'video', estado: 'publicada', 'fecha_publicación_real': '2026-02-30' },
  ]);
  const rows = summarizeEditorialRecords(records, range);
  assert.equal(rows.find(row => row.formato === 'historias').publicadas, 1);
  assert.equal(rows.find(row => row.formato === 'historias').programadas, 0);
  assert.equal(rows.find(row => row.formato === 'carruseles').legacy, 1);
  assert.equal(rows.find(row => row.formato === 'reels').publicadas, 0);
  assert.equal(rows.find(row => row.formato === 'reels').programadas, 2);
  assert.equal(rows.find(row => row.formato === 'reels').legacySinFecha, 1);
  assert.deepEqual(rows.find(row => row.formato === 'reels').estados, [{ estado: 'publicada', total: 1 }, { estado: 'lista', total: 1 }]);
  assert.equal(records.length, 5); // IDs are domain-scoped.
});

test('personal editorial follows exact own task-piece links only, deduplicates and reports unavailable records', () => {
  const tasks = [task(1, { asignado_a_id: 1, publicacion_id: 8, estado: 'finalizada' }), task(2, { colaborador_ids: [1], publicacion_id: 8 }), task(3, { asignado_a_id: 1, historia_id: 99 }), task(4, { asignado_a: 'Alex', publicacion_id: 9 })];
  const publications = [{ id: 8, tipo: 'carrusel', estado: 'lista', fecha_programada: '2026-10-03' }, { id: 9, tipo: 'video', estado: 'publicada', fecha_programada: '2026-10-04', 'fecha_publicación_real': '2026-10-04' }];
  const result = personalEditorialReport(tasks, 1, [], publications, range);
  assert.equal(result.linked, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.rows[0].programadas, 1);
  assert.equal(result.rows[0].publicadas, 0); // Finished task is not published editorial.
  assert.equal(result.rows[1].publicadas, 0); // Names do not grant ownership.
  assert.equal(personalEditorialReport(tasks, 2, [], publications, range).available, false);
  assert.equal(personalEditorialReport(tasks, 1, [], [], range).missing, 2);
});

test('task drilldown keeps actual IDs, dates, domain-safe links and format/state breakdowns', () => {
  const tasks = [task(1, { asignado_a_id: 1, titulo: 'Carrusel', estado: 'finalizada', propiedades_extra: { workspace: 'render_os', finalizada_at: '2026-10-11' } }), task(2, { asignado_a_id: 1, titulo: 'Reel', estado: 'aprobada' }), task(3, { asignado_a_id: 1, historia_id: 5, estado: 'en_revision' }), task(4, { asignado_a: 'Alex', titulo: 'Reel' })];
  const details = employeeTaskDetails(tasks, 1, range);
  assert.deepEqual(details.map(row => row.id), [1, 2, 3]);
  assert.equal(details[0].href, '/workspace/tareas?task=1');
  assert.equal(details[0].finalizada, '2026-10-11');
  assert.equal(details[1].href, null); // No fake workspace for historical rows.
  const rows = employeeFormatBreakdown(tasks, 1, range);
  assert.equal(rows[0].finalizadas, 1);
  assert.equal(rows[1].aprobadas, 1);
  assert.equal(rows[2].enRevision, 1);
});

test('explicit client/feed quota dedup preserves zero, missing and conflicting values without division', () => {
  const clients = [{ id: 1, nombre: 'A', grupo_feed_id: 7, cuota_feed_carruseles: 8, cuota_feed_reels: 4 }, { id: 2, nombre: 'B', grupo_feed_id: 7, cuota_feed_carruseles: 8, cuota_feed_reels: 4 }, { id: 3, nombre: 'C', cuota_carruseles: 0 }, { id: 4, nombre: 'Inactive', activo: false, cuota_carruseles: 30 }];
  const records = editorialRecords([], [confirmedEditorial({ id: 1, cliente_id: 1, tipo: 'carrusel' }, '2026-10-05T12:00:00Z'), confirmedEditorial({ id: 2, cliente_id: 2, tipo: 'carrusel' }, '2026-10-05T12:00:00Z')]);
  const rows = clientQuotaReport(clients, records, range);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].carruseles, 8);
  assert.equal(rows[0].reels, 4);
  assert.equal(rows[0].metrics[0].publicadas, 2);
  assert.equal(rows[1].carruseles, 0);
  assert.equal(rows[1].reels, null);
  assert.equal(clientQuotaReport([clients[0], { ...clients[1], cuota_feed_carruseles: 9 }], [], range)[0].carruseles, null);
});

test('quota publication cells describe shared manual confirmations in the real range, including zero', () => {
  const source = readFileSync(new URL('../../frontend/src/pages/Reportes.jsx', import.meta.url), 'utf8');
  assert.match(source, /Carruseles confirmados en el período real/);
  assert.match(source, /Reels confirmados en el período real/);
  assert.match(source, /Confirmaciones manuales de todo el equipo en el rango real\. No incluye registros archivados\./);
  assert.match(source, /formato === 'carruseles'\)\.publicadas\} confirmadas/);
  assert.match(source, /formato === 'reels'\)\.publicadas\} confirmadas/);
  const rows = clientQuotaReport([{ id: 1, cuota_carruseles: 8, cuota_reels: 4 }], [], range);
  assert.equal(rows[0].metrics[0].publicadas, 0);
  assert.equal(rows[0].metrics[1].publicadas, 0);
});

test('verified editing credit survives handoff but is not inferred from names or used for unrelated tasks', () => {
  const credit = task(1, { asignado_a_id: 2, tipo_tarea: 'edicion', propiedades_extra: { edicion_responsable_id: 1 } });
  assert.deepEqual(reportTaskPeople(credit), [2, 1]);
  assert.equal(buildEmployeeReport(users, [credit], range, '2026-10-19').rows[0].total, 1);
  assert.deepEqual(reportTaskPeople({ ...credit, tipo_tarea: 'produccion' }), [2]);
  assert.deepEqual(reportTaskPeople({ ...credit, propiedades_extra: { edicion_responsable_id: '1', edicion_responsable: 'Alex' } }), [2]);
});
