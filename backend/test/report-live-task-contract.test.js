import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReportSnapshot } from '../src/report-snapshot.js';
import { filterReportDataForUser } from '../src/report-access.js';

test('actual report snapshot excludes archived and trashed Render OS tasks in its SQL read', async () => {
  const calls = [];
  const db = { async query(sql, values) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, values });
    if (compact === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1') {
      assert.deepEqual(values, [7]);
      return { rows: [{ id: 7, rol: 'edicion', activo: true, session_version: 3 }] };
    }
    if (['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(compact)
      || compact.startsWith('SELECT t.id,t.cliente_id')
      || compact.startsWith('SELECT id,cliente_id,estado')
      || compact.startsWith('SELECT id,cliente_id,tipo,estado')
      || compact.startsWith('SELECT c.id,c.nombre,c.activo')
      || compact === 'SELECT id,usuario,nombre,rol FROM usuarios ORDER BY id'
      || compact.startsWith('SELECT id,editor_clave')
      || compact.startsWith('SELECT v.id,v.tarea_origen_id')) return { rows: [] };
    assert.fail(`Unexpected query: ${compact}`);
  }, release(error) { calls.push({ sql: 'RELEASE', error }); } };
  const pool = { async connect() { return db; }, query() { assert.fail('Read escaped the leased transaction'); } };
  await loadReportSnapshot(pool, { id: 7, rol: 'edicion', session_version: 3 }, {
    mes_configuracion: '2026-10', desde: '2026-10-01', hasta: '2026-11-01',
  });
  const workspaceReads = calls.filter(call => call.sql.includes("WHERE t.propiedades_extra->>'workspace'='render_os'"));
  assert.equal(workspaceReads.length, 1);
  assert.match(workspaceReads[0].sql, /AND t\.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'/);
  assert.match(workspaceReads[0].sql, /AND t\.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'/);
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(calls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
});

const secret = 'QA241_PRIVATE_FINANCE';
function report(value, present = true) {
  const task = { id: 1, asignado_a_id: 7, colaborador_ids: [], titulo: 'Completed work', estado: 'finalizada',
    tipo_tarea: 'edicion', fecha_vencimiento: '2026-10-20', importe: secret,
    propiedades_extra: { workspace: 'render_os', importe: secret, salary: { amount: secret },
      ...(present ? { finalizada_at: value } : {}) } };
  return { tareas: [task], tareasRenderOs: [task], usuarios: [{ id: 7, nombre: 'QA', importe: secret }],
    historias: [], publicaciones: [], clientes: [], entregasEdicion: [], finance: { amount: secret } };
}
const auth = { id: 7, rol: 'edicion' };

test('staff task DTO retains canonical server completion timestamp without widening its financial allowlist', () => {
  const instant = '2026-10-20T14:32:12.123Z';
  const input = report(instant), before = structuredClone(input);
  const result = filterReportDataForUser(input, auth);
  for (const key of ['tareas', 'tareasRenderOs']) {
    assert.equal(result[key].length, 1);
    assert.deepEqual(result[key][0].propiedades_extra, { workspace: 'render_os', finalizada_at: instant });
    assert.equal(Object.hasOwn(result[key][0], 'importe'), false);
  }
  assert.equal(Object.hasOwn(result, 'finance'), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(input, before);
  result.tareas[0].propiedades_extra.finalizada_at = 'local mutation';
  assert.deepEqual(input, before);
});

test('staff completion metadata rejects noncanonical or invalid timestamps rather than reinterpreting legacy values', () => {
  for (const value of [undefined, null, 1792500000000, true, {}, [], { importe: secret },
    new Date('2026-10-20T14:32:12.123Z'), '', '2026-10-20', '2026-10-20 14:32:12',
    '2026-10-20T14:32:12.123', '2026-02-30T14:32:12.123Z', '0000-10-20T14:32:12.123Z',
    '2026-10-20T25:32:12.123Z', '2026-10-20T14:32:12.123Z\n']) {
    const input = report(value), before = structuredClone(input);
    const result = filterReportDataForUser(input, auth);
    for (const key of ['tareas', 'tareasRenderOs']) assert.equal(Object.hasOwn(result[key][0].propiedades_extra, 'finalizada_at'), false,
      'Only a valid canonical server timestamp may cross the staff DTO');
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.deepEqual(input, before);
  }
  const missing = filterReportDataForUser(report(undefined, false), auth);
  assert.equal(Object.hasOwn(missing.tareas[0].propiedades_extra, 'finalizada_at'), false);
});
