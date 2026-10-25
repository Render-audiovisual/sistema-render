import test from 'node:test';
import assert from 'node:assert/strict';
import { productionReportRange, loadProductionReport, loadProductionTaskContext } from '../src/production-reporting.js';
import { editorialRecords, summarizeEditorialRecords, clientQuotaReport } from '../../frontend/src/shared/reports/production-registry-report.js';

test('production reports use inclusive/exclusive calendar bounds including leap years and year rollover', () => {
  assert.deepEqual(productionReportRange({}, '2028-02-01'), { desde: '2028-02-01', hasta: '2028-03-01' });
  assert.deepEqual(productionReportRange({}, '2026-12-01'), { desde: '2026-12-01', hasta: '2027-01-01' });
  assert.deepEqual(productionReportRange({ desde: '2026-09-21', hasta: '2026-10-21' }), { desde: '2026-09-21', hasta: '2026-10-21' });
});

test('production report ranges reject malformed, missing, reversed and unbounded values', () => {
  for (const query of [{ desde: '2026-10-01' }, { desde: ['2026-10-01'], hasta: '2026-11-01' },
    { desde: '2026-02-30', hasta: '2026-03-05' }, { desde: '2026-11-01', hasta: '2026-10-01' },
    { desde: '2026-01-01', hasta: '2026-01-01' }, { desde: '2025-01-01', hasta: '2027-01-01' },
    { desde: "2026-10-01';DROP", hasta: '2026-11-01' }]) {
    assert.throws(() => productionReportRange(query, '2026-10-01'), error => error.status === 400);
  }
});

test('empty period does not load unrelated media and keeps the exact selected range', async () => {
  const queries = [];
  const range = { desde: '2026-10-01', hasta: '2026-11-01' };
  const result = await loadProductionReport({ query: async (...args) => { queries.push(args); return { rows: [] }; } }, range);
  assert.deepEqual(result, { ...range, visitas: [] });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0][1], [range.desde, range.hasta]);
  assert.match(queries[0][0], /v.fecha >= \$1::date AND v.fecha < \$2::date/);
});

test('report joins visit/media by stable IDs and never passes raw metadata or money bags', async () => {
  const calls = [];
  const poison = { importe: 99999, propiedades_extra: { sueldo: 99999 }, metadata: { ingresos: 99999 } };
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM produccion_visitas')) return { rows: [{ ...poison, id: 'visit', tarea_origen_id: 12,
      cliente_id: 3, cliente_nombre: 'Client', fecha: '2026-10-12', titulo: 'Visit', participante_ids: [4, 5, '6', null] }] };
    if (sql.includes('FROM produccion_videos')) return { rows: [{ ...poison, id: 'video', visita_id: 'visit',
      titulo: 'Video', estado: 'grabado', tarea_edicion_id: 20, tarea_estado: 'finalizada', editor_actual_id: 5, fecha_entrega_actual: '2026-10-16' },
    { id: 'unrelated', visita_id: 'other', titulo: 'Not in this visit', estado: 'grabado' }] };
    return { rows: [{ ...poison, id: 'photo', visita_id: 'visit', tipo: 'Product', estado: 'repetir' }] };
  } };
  const result = await loadProductionReport(db, { desde: '2026-10-01', hasta: '2026-11-01' });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].values, [['visit']]);
  assert.deepEqual(result.visitas[0].participante_ids, [4, 5]);
  assert.equal(result.visitas[0].videos.length, 1);
  assert.equal(result.visitas[0].videos[0].tarea_estado, 'finalizada');
  assert.equal(result.visitas[0].videos[0].estado, 'grabado', 'Finished editing does not publish or relabel source recording');
  for (const secret of ['importe', 'sueldo', 'ingresos', 'propiedades_extra', 'metadata', '99999']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('task context provides only a verified registry link and counts, not raw task or visit data', async () => {
  const db = { async query(sql, values) {
    assert.deepEqual(values, [12]);
    assert.match(sql, /v.tarea_origen_id=\$1/);
    assert.match(sql, /pv.tarea_edicion_id=\$1/);
    assert.match(sql, /source.revision AS task_revision/);
    return { rows: [{ id: 'visit', fecha: '2026-10-12', revision: 5, tipo: 'origen', task_revision: 7, previstos_raw: 3, videos_total: 3, videos_grabados: 2, fotos_total: 1, importe: 99999 }] };
  } };
  assert.deepEqual(await loadProductionTaskContext(db, 12), { vinculo: {
    id: 'visit', fecha: '2026-10-12', revision: 5, tipo: 'origen', ultimo_resultado: null, videos_total: 3, videos_grabados: 2, fotos_total: 1, usa_registro_individual: true,
    finalizacion: { task_revision: 7, previstos: 3, grabados: 2, total: 3, habilitada: false },
  } });
});

test('task context rejects non IDs and does not invent a link for legacy or absent tasks', async () => {
  const db = { query: async () => ({ rows: [] }) };
  for (const id of [null, 0, -1, '12', 1.5, Infinity]) await assert.rejects(loadProductionTaskContext(db, id), error => error.status === 400);
  assert.deepEqual(await loadProductionTaskContext(db, 12), { vinculo: null });
});

test('source readiness uses one SQL observation and editing links never project finalization', async () => {
  for (const [total, grabados, previstos, habilitada] of [[0,0,0,false],[3,2,3,false],[2,2,3,false],[3,3,3,true],[1,1,null,true]]) {
    let calls = 0;
    const result = await loadProductionTaskContext({ query: async () => {
      calls++; return { rows: [{ id: 'visit', tipo: 'origen', task_revision: 8, previstos_raw: previstos,
        videos_total: total, videos_grabados: grabados, fotos_total: 4 }] };
    } }, 12);
    assert.equal(calls, 1);
    assert.deepEqual(result.vinculo.finalizacion, { task_revision: 8, previstos: previstos ?? 0, grabados, total, habilitada });
  }
  const editing = await loadProductionTaskContext({ query: async () => ({ rows: [{ id: 'visit', tipo: 'edicion',
    task_revision: 8, previstos_raw: 3, videos_total: 3, videos_grabados: 3, fotos_total: 0 }] }) }, 12);
  assert.equal(Object.hasOwn(editing.vinculo, 'finalizacion'), false);
});

test('editorial summaries separate confirmed actual Córdoba period from dated and undated historical coverage', () => {
  const proof = { classification: 'confirmada_manualmente', revision: 1, confirmation: {
    id: '00000000-0000-4000-8000-000000000001', actor_id: 22, source: 'manual',
    occurred_at: '2026-10-01T02:00:00.000Z', recorded_at: '2026-10-02T12:00:00.000Z' } };
  const confirmed = { id: 1, cliente_id: 1, tipo: 'video', estado: 'publicada', fecha_programada: '2026-10-02',
    'fecha_publicación_real': proof.confirmation.occurred_at, publicacion_evidencia: proof };
  const legacyDated = { id: 2, cliente_id: 1, tipo: 'video', estado: 'publicada', fecha_programada: '2026-10-03', 'fecha_publicación_real': '2026-10-04T12:00:00Z' };
  const legacyUndated = { id: 3, cliente_id: 1, tipo: 'video', estado: 'publicada', fecha_programada: '2026-10-03' };
  const legacyNoPlan = { id: 4, cliente_id: 1, tipo: 'video', estado: 'publicada' };
  const records = editorialRecords([], [confirmed, confirmed, legacyDated, legacyUndated, legacyNoPlan]);
  assert.equal(records.length, 4);
  const [october] = summarizeEditorialRecords([...records, ...records], { desde: '2026-10-01', hasta: '2026-11-01' }).filter(row => row.formato === 'reels');
  assert.equal(october.programadas, 3); assert.equal(october.publicadas, 0);
  assert.equal(october.historicalFechadas, 1); assert.equal(october.legacy, 1); assert.equal(october.legacySinFecha, 1);
  const september = summarizeEditorialRecords(records, { desde: '2026-09-01', hasta: '2026-10-01' }).find(row => row.formato === 'reels');
  assert.equal(september.publicadas, 1); assert.equal(september.programadas, 0);
  const [group] = clientQuotaReport([{ id: 1, grupo_feed_id: 7, cuota_feed_reels: 4, cuota_feed_carruseles: 2 },
    { id: 2, grupo_feed_id: 7, cuota_feed_reels: 4, cuota_feed_carruseles: 2 }], records, { desde: '2026-10-01', hasta: '2026-11-01' });
  assert.equal(group.reels, 4); assert.equal(group.metrics.find(row => row.formato === 'reels').publicadas, 0);
});

test('report domain IDs remain distinct, metadata/task flags never prove publication, stale roots lose credit', () => {
  const fakeProof = { classification: 'confirmada_manualmente', revision: 1, confirmation: {
    id: '00000000-0000-4000-8000-000000000001', actor_id: 22, source: 'manual',
    occurred_at: '2026-10-05T12:00:00Z', recorded_at: '2026-10-05T13:00:00Z' } };
  const base = { id: 1, cliente_id: 1, estado: 'publicada', fecha_programada: '2026-10-05', 'fecha_publicación_real': '2026-10-05T12:00:00Z' };
  const rows = editorialRecords([{ ...base, metadata: { publicacion_evidencia: fakeProof } }], [
    { ...base, tipo: 'carrusel', publicacion_evidencia: fakeProof, 'fecha_publicación_real': '2026-10-06T12:00:00Z' }]);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].key, rows[1].key);
  const summary = summarizeEditorialRecords(rows, { desde: '2026-10-01', hasta: '2026-11-01' });
  assert.equal(summary.reduce((sum, row) => sum + row.publicadas, 0), 0);
  assert.equal(summary.reduce((sum, row) => sum + row.historicalFechadas, 0), 2);
});
