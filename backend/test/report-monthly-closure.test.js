import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMonthlyReportClosure, applyMonthlyClosureToPerformance } from '../../frontend/src/shared/reports/report-utils.js';
import { filterReportDataForUser } from '../src/report-access.js';

const closures = [11, 12, 13].map(usuario_id => ({ usuario_id, periodo: '2026-09', porcentaje: 100 }));
const september = { desde: '2026-09-01', hasta: '2026-10-01' };
const performance = { avanceObjetivo: 0, cumplimiento: null, estadoObjetivo: { label: 'Atrasado' }, carga: 3,
  terminadas: 0, atrasadas: [{ id: 42 }], productividad: '0.0' };
const getClosure = (id, period = 'mes_pasado', range = september, today = '2026-10-13') =>
  getMonthlyReportClosure(closures, id, period, range, today);

test('septiembre se cierra al 100% para los tres IDs autorizados sin inventar entregas', () => {
  for (const id of [11, 12, 13]) {
    const result = applyMonthlyClosureToPerformance(performance, getClosure(id));
    assert.equal(result.avanceObjetivo, 100);
    assert.equal(result.cumplimiento, 100);
    assert.equal(result.estadoObjetivo.label, 'Completado');
    assert.equal(result.carga, 0);
    assert.deepEqual(result.atrasadas, []);
    assert.equal(result.terminadas, performance.terminadas);
    assert.equal(result.productividad, performance.productividad);
    assert.equal(result.registroOriginal.carga, 3);
  }
  assert.equal(performance.carga, 3);
  assert.equal(performance.atrasadas[0].id, 42);
});

test('octubre, agosto, otras personas y los últimos 30 días permanecen exactamente iguales', () => {
  for (const closure of [
    getClosure(11, 'mes_actual', { desde: '2026-10-01', hasta: '2026-11-01' }),
    getClosure(11, 'mes_pasado', { desde: '2026-08-01', hasta: '2026-09-01' }),
    getClosure(99), getClosure(null),
    getClosure(11, 'ultimos_30'),
    getClosure(11, 'mes_pasado', { desde: '2026-10-01', hasta: '2026-11-01' }, '2026-11-13'),
    getClosure(11, 'mes_actual', september, '2026-09-15'),
    getClosure(11, 'mes_pasado', { desde: '2026-09-02', hasta: '2026-10-01' }),
    getClosure(11, 'mes_pasado', { desde: '2026-09-01', hasta: '2026-09-30' }),
  ]) {
    assert.equal(closure, null);
    assert.equal(applyMonthlyClosureToPerformance(performance, closure), performance);
  }
});

test('identifica por ID, no por nombres parecidos, y rechaza cierres inválidos', () => {
  assert.equal(getClosure('11').usuario_id, 11);
  assert.equal(getMonthlyReportClosure([{ ...closures[0], porcentaje: 90 }], 11, 'mes_pasado', september, '2026-10-13'), null);
  assert.equal(getMonthlyReportClosure([], 11, 'mes_pasado', september, '2026-10-13'), null);
});

test('el Líder ve los cierres y cada integrante únicamente el propio', () => {
  const data = { tareas: [], tareasRenderOs: [], usuarios: [], clientes: [], historias: [], publicaciones: [], cierresMensuales: closures };
  assert.equal(filterReportDataForUser(data, { rol: 'admin' }).cierresMensuales.length, 3);
  for (const role of ['community', 'diseno', 'edicion', 'produccion']) {
    assert.deepEqual(filterReportDataForUser(data, { id: '12', nombre: 'Otro', rol: role }).cierresMensuales, [closures[1]]);
    assert.deepEqual(filterReportDataForUser(data, { id: 99, nombre: 'Oriana', rol: role }).cierresMensuales, []);
    assert.deepEqual(filterReportDataForUser(data, { nombre: 'Oriana', rol: role }).cierresMensuales, []);
  }
});

test('la migración es exclusivamente un cierre de reportes de septiembre, no modifica fuentes', () => {
  const sql = readFileSync(new URL('../migrations/054_cierre_reportes_septiembre_2026.sql', import.meta.url), 'utf8');
  assert.match(sql, /DATE '2026-09-01'/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|ALTER TABLE)\s+(?:tareas|historias|publicaciones|entregas_edicion|cliente_objetivos_mensuales)/i);
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const payroll = server.slice(server.indexOf('async function loadPayrollForCollectionPeriod'), server.indexOf('async function loadPayrollForCollectionPeriod') + 4000);
  assert.doesNotMatch(payroll, /reporte_cierres_mensuales/);
});
