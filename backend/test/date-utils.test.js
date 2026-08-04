import assert from "node:assert/strict";
import test from "node:test";
import { esDelMesActual, fechaISODesde, getGrillaMes, getMesActualISO, sumarDiasISO } from "../../frontend/src/shared/date/date-utils.js";

test("las utilidades de fecha conservan el contrato de calendario", () => {
  assert.equal(fechaISODesde(2026, 6, 3), "2026-07-03");
  assert.equal(sumarDiasISO("2026-07-31", 1), "2026-08-01");
  assert.deepEqual(getGrillaMes(2026, 7)[0], [null, null, null, null, null, 1, 2]);
});

test("los indicadores mensuales excluyen publicaciones de meses anteriores", () => {
  const mesActual = getMesActualISO();
  const inicioMesActual = `${mesActual}-01`;
  const inicioMesAnterior = new Date(`${inicioMesActual}T12:00:00`);
  inicioMesAnterior.setMonth(inicioMesAnterior.getMonth() - 1);
  const mesAnterior = `${inicioMesAnterior.getFullYear()}-${String(inicioMesAnterior.getMonth() + 1).padStart(2, "0")}-15`;

  assert.equal(esDelMesActual(inicioMesActual), true);
  assert.equal(esDelMesActual(mesAnterior), false);
});
