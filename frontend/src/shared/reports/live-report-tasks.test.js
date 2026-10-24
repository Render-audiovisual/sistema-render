import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeReport, employeeTaskDetails, employeeFormatBreakdown, buildHistoricalProductionReport,
  personalEditorialReport, editorialRecords, summarizeEditorialRecords } from './production-registry-report.js';

const range = { desde: '2026-10-01', hasta: '2026-11-01' };
const user = { id: 7, nombre: 'QA', rol: 'edicion' };
const task = (id, extra = {}, fields = {}) => ({ id, asignado_a_id: 7, colaborador_ids: [], titulo: `QA ${id}`, estado: 'finalizada',
  fecha_vencimiento: '2026-10-20', tipo_tarea: 'edicion', cliente_id: 1,
  propiedades_extra: { workspace: 'render_os', ...extra }, ...fields });

test('employee totals, details and breakdown omit Render OS trash booleans/strings without hiding independent history', () => {
  const rows = [task(1, { finalizada_at: '2026-10-21T14:00:00.000Z' }), task(2, { papelera_render_os: true }),
    task(3, { papelera_render_os: 'true' }), task(4, { archivada_render_os: true }),
    task(5, { papelera_render_os: false }, { estado: 'pendiente' }), task(6, { workspace: 'legacy', papelera_render_os: true })];
  const before = JSON.stringify(rows);
  const person = buildEmployeeReport([user], rows, range, '2026-10-24').rows[0];
  assert.equal(person.total, 3); assert.equal(person.finalizadas, 2); assert.equal(person.pendientes, 1);
  const details = employeeTaskDetails(rows, 7, range);
  assert.deepEqual(details.map(row => row.id), [1, 5, 6]);
  assert.equal(details[0].finalizada, '2026-10-21T14:00:00.000Z');
  assert.equal(employeeFormatBreakdown(rows, 7, range).reduce((sum, row) => sum + row.total, 0), 3);
  assert.equal(JSON.stringify(rows), before);
});

test('historical production excludes trashed workspace aggregates but preserves separate historical records', () => {
  const record = { fecha: '2026-10-20', cantidad: 4 };
  const rows = [task(1, { papelera_render_os: true, produccion_registros: [record] }),
    task(2, { papelera_render_os: 'true', produccion_registros: [record] }),
    task(3, { workspace: 'legacy', produccion_registros: [record] })];
  assert.deepEqual(buildHistoricalProductionReport(rows, new Set(), range), [{ id: 1, nombre: 'Sin cliente', recorded: 4 }]);
});

test('trash cannot attribute personal editorial pieces, while independent confirmed editorial evidence remains counted', () => {
  const instant = '2026-10-20T14:00:00.000Z';
  const publication = id => ({ id, cliente_id: 1, tipo: 'video', estado: 'publicada', fecha_programada: '2026-10-20',
    'fecha_publicación_real': instant, publicacion_evidencia: { classification: 'confirmada_manualmente', revision: 1,
      confirmation: { id: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`, actor_id: 8, source: 'manual', occurred_at: instant, recorded_at: instant } } });
  const publications = [publication(21), publication(22)];
  const result = personalEditorialReport([task(1, {}, { publicacion_id: 21 }), task(2, { papelera_render_os: true }, { publicacion_id: 22 })],
    7, [], publications, range);
  assert.equal(result.linked, 1); assert.equal(result.rows.find(row => row.formato === 'reels').publicadas, 1);
  assert.equal(summarizeEditorialRecords(editorialRecords([], publications), range).find(row => row.formato === 'reels').publicadas, 2,
    'Hiding work must not withdraw or rewrite independently confirmed publications');
});
