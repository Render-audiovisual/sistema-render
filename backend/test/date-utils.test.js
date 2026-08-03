import assert from "node:assert/strict";
import test from "node:test";
import { fechaISODesde, getGrillaMes, sumarDiasISO } from "../../frontend/src/shared/date/date-utils.js";

test("las utilidades de fecha conservan el contrato de calendario", () => {
  assert.equal(fechaISODesde(2026, 6, 3), "2026-07-03");
  assert.equal(sumarDiasISO("2026-07-31", 1), "2026-08-01");
  assert.deepEqual(getGrillaMes(2026, 7)[0], [null, null, null, null, null, 1, 2]);
});
