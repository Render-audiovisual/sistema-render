import assert from "node:assert/strict";
import test from "node:test";

import { calculateActiveClientsCompliance, isTaskAssignedToPerson } from "../../frontend/src/shared/dashboard-stats.js";

test("el cumplimiento general no incluye clientes dados de baja", () => {
  assert.equal(calculateActiveClientsCompliance([
    { activo: true, porcentajes: { objetivo: 80 } },
    { activo: false, porcentajes: { objetivo: 0 } },
  ]), 80);
});

test("el resumen reconoce nombres completos y variantes sin acento", () => {
  assert.equal(isTaskAssignedToPerson({ asignado_a: "German López" }, "Germán"), true);
  assert.equal(isTaskAssignedToPerson({ asignado_a: "Augusto" }, "Germán"), false);
});
