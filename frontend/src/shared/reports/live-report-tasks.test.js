import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeReport, employeeTaskDetails, employeeFormatBreakdown, buildHistoricalProductionReport,
  personalEditorialReport, editorialRecords, summarizeEditorialRecords, buildProductionRegistryReport } from './production-registry-report.js';

const range = { desde: '2026-10-01', hasta: '2026-11-01' };
const user = { id: 7, nombre: 'QA', rol: 'edicion' };
const task = (id, extra = {}, fields = {}) => ({ id, asignado_a_id: 7, colaborador_ids: [], titulo: `QA ${id}`, estado: 'finalizada',
  fecha_vencimiento: '2026-10-20', tipo_tarea: 'edicion', cliente_id: 1,
  propiedades_extra: { workspace: 'render_os', ...extra }, ...fields });

const resultEvidence = patch => ({ id: '11111111-2222-4333-8444-555555555555', visita_revision: 7,
  revision_resultante: 8, registrado_at: '2026-10-29T12:34:56.123Z', parcial: true, vigente: true, ...patch });
const resultVisit = (id, fields = {}) => ({ id, tarea_origen_id: 21, cliente_id: 1, cliente_nombre: 'QA Client',
  fecha: '2026-10-20', titulo: 'QA visit', revision: 8, participante_ids: [7, 7],
  videos: [{ id: 'video-one', titulo: 'QA video', estado: 'grabado' }],
  fotos: [{ id: 'photo-one', tipo: 'QA photos', estado: 'realizada' }], ...fields });
const registry = visits => buildProductionRegistryReport({ ...range, visitas: visits }, [user], range);

test('registry visit status distinguishes current partial, complete, outdated and explicitly absent results', () => {
  for (const [ultimo_resultado, revision, expected] of [
    [resultEvidence(), 8, { label: 'Resultado parcial registrado', tone: 'partial' }],
    [resultEvidence({ parcial: false }), 8, { label: 'Resultado registrado', tone: 'complete' }],
    [resultEvidence({ vigente: false }), 9, { label: 'Resultado desactualizado', tone: 'outdated' }],
    [null, 8, { label: 'Sin resultado registrado', tone: 'pending' }],
  ]) {
    const result = registry([resultVisit('visit-one', { ultimo_resultado, revision })]);
    assert.deepEqual(result.clients[0].visits[0].resultado_estado, expected);
  }
});

test('registry missing or malformed result evidence stays unknown without claiming absence or completion', () => {
  for (const ultimo_resultado of [undefined, {}, false, resultEvidence({ vigente: false }),
    resultEvidence({ visita_revision: '7' }), resultEvidence({ revision_resultante: 9 }),
    resultEvidence({ registrado_at: '2026-02-30T12:00:00Z' }), resultEvidence({ id: 'invalid' }),
    resultEvidence({ parcial: 1 })]) {
    assert.deepEqual(registry([resultVisit('visit-one', { ultimo_resultado })]).clients[0].visits[0].resultado_estado,
      { label: 'Resultado sin verificar', tone: 'unknown' });
  }
});

test('registry outputs only fixed status label/tone, not the raw journal, receipt, revision or financial additions', () => {
  const ultimo_resultado = resultEvidence({ label: '<script>injected</script>', tone: 'private', payload_hash: 'private-hash',
    request_id: 'private-request', registrado_por_id: 7, sueldo: 999, resumen: { finanzas: 'private-summary' } });
  const source = resultVisit('visit-one', { ultimo_resultado, importe: 999 }), before = structuredClone(source);
  const row = registry([source]).clients[0].visits[0];
  assert.deepEqual(row.resultado_estado, { label: 'Resultado parcial registrado', tone: 'partial' });
  assert.deepEqual(Object.keys(row.resultado_estado), ['label', 'tone']);
  for (const key of ['ultimo_resultado', 'revision', 'payload_hash', 'request_id', 'registrado_por_id', 'sueldo', 'resumen', 'importe']) {
    assert.equal(Object.hasOwn(row, key), false);
  }
  assert.equal(JSON.stringify(row).includes('private-'), false); assert.deepEqual(source, before);
});

test('result labels leave registry counts, media/visit deduplication, participants and historical exclusion unchanged', () => {
  const first = resultVisit('visit-one', { ultimo_resultado: resultEvidence() });
  const duplicate = resultVisit('visit-one', { ultimo_resultado: null });
  const second = resultVisit('visit-two', { revision: 9, ultimo_resultado: resultEvidence({ vigente: false }) });
  const result = registry([first, duplicate, second]);
  assert.equal(result.available, true); assert.equal(result.visits, 2);
  assert.equal(result.videos, 1); assert.equal(result.recorded, 1);
  assert.equal(result.photos, 1); assert.equal(result.realizedPhotos, 1);
  assert.deepEqual([...result.normalizedSourceIds], [21]);
  assert.deepEqual(result.clients[0].visits[0].participants, [{ id: 7, nombre: 'QA' }]);
  assert.equal(result.clients[0].visits[0].resultado_estado.tone, 'partial');
  assert.equal(result.clients[0].visits[1].resultado_estado.tone, 'outdated');
  assert.deepEqual(buildHistoricalProductionReport([task(21, { produccion_registros: [{ cantidad: 9, fecha: '2026-10-20' }] })],
    result.normalizedSourceIds, range), []);
});

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
