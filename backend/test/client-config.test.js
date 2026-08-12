import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientConfiguration, normalizePeriod } from "../src/client-config.js";

test("normaliza una configuración mensual completa", () => {
  assert.deepEqual(normalizeClientConfiguration({
    cuota_reels: "4", cuota_carruseles: "2", abono_mensual: "350000",
    dias_historias: [5, 1, 1], disenador_responsable: "Augusto",
  }), {
    cuota_reels: 4, cuota_carruseles: 2, abono_mensual: 350000,
    dias_historias: [1, 5], disenador_responsable: "Augusto",
  });
});

test("rechaza configuraciones incompletas sin afectar el contrato legacy", () => {
  assert.throws(() => normalizeClientConfiguration({ cuota_reels: 1 }), /cuotas/i);
});

test("normaliza el período al primer día del mes", () => {
  assert.equal(normalizePeriod("2026-08"), "2026-08-01");
});
