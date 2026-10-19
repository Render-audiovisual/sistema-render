import test from 'node:test';
import assert from 'node:assert/strict';
import { productionReportRange, loadProductionReport, loadProductionTaskContext } from '../src/production-reporting.js';

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
    return { rows: [{ id: 'visit', fecha: '2026-10-12', revision: 5, tipo: 'origen', videos_total: 3, videos_grabados: 2, fotos_total: 1, importe: 99999 }] };
  } };
  assert.deepEqual(await loadProductionTaskContext(db, 12), { vinculo: {
    id: 'visit', fecha: '2026-10-12', revision: 5, tipo: 'origen', videos_total: 3, videos_grabados: 2, fotos_total: 1, usa_registro_individual: true,
  } });
});

test('task context rejects non IDs and does not invent a link for legacy or absent tasks', async () => {
  const db = { query: async () => ({ rows: [] }) };
  for (const id of [null, 0, -1, '12', 1.5, Infinity]) await assert.rejects(loadProductionTaskContext(db, id), error => error.status === 400);
  assert.deepEqual(await loadProductionTaskContext(db, 12), { vinculo: null });
});
