import test from "node:test";
import assert from "node:assert/strict";
import { applyCompensations, employeeKey, nextPeriod } from "../src/finance-calculation.js";
import { readFileSync } from "node:fs";

test("calcula el mes siguiente incluso al cambiar de año", () => {
  assert.equal(nextPeriod("2026-08"), "2026-09");
  assert.equal(nextPeriod("2026-12"), "2027-01");
});

test("Milton y Luciano representan a una única persona", () => {
  assert.equal(employeeKey("Milton Luciano"), "luciano");
});

test("el pago final reemplaza la estimación sin borrar el avance", () => {
  const dashboard = { employees: [{ name: "Augusto", model: "fixed", percentage: 50, total: 500000, earned: 250000, remainingAmount: 250000, configurationPending: false, items: [] }], summary: {} };
  const result = applyCompensations(dashboard, [{ empleado_clave: "augusto", modalidad: "mensual", sueldo_base: 560000 }], [{ empleado_clave: "augusto", importe_final: 300000 }]);
  assert.equal(result.employees[0].earned, 280000);
  assert.equal(result.employees[0].payable, 300000);
  assert.equal(result.employees[0].percentage, 50);
});

test("Luciano conserva como pendiente el trabajo todavía no clasificado", () => {
  const dashboard = { employees: [{ name: "Luciano", model: "per_unit", percentage: 100, completed: 1, total: null, earned: null, remainingAmount: null, configurationPending: true, items: [{ complete: true, difficulty: "" }] }], summary: {} };
  const result = applyCompensations(dashboard, [{ empleado_clave: "luciano", modalidad: "por_pieza", tarifa_facil: 5000, tarifa_intermedia: 10000 }]);
  assert.equal(result.employees[0].earned, 0);
  assert.equal(result.employees[0].configurationPending, true);
});

test("los endpoints financieros exigen Líder y clientes oculta abonos a empleados", () => {
  const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/finanzas\/compensaciones\/:empleado", requireRole\("admin"\)/);
  assert.match(source, /router\.put\("\/finanzas\/pagos\/:periodo\/:empleado", requireRole\("admin"\)/);
  assert.match(source, /router\.post\("\/clientes\/:id\/abono-proximo-mes", requireRole\("admin"\)/);
  assert.match(source, /req\.auth\.rol === "admin"[\s\S]*abono_mensual, abono_vigente_desde/);
});

test("el abono mensual de Clientes alimenta Finanzas desde una única edición", () => {
  const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /SELECT cc\.abono_mensual, cc\.vigente_desde/);
  assert.match(source, /COALESCE\(abono\.importe, cfg\.abono_mensual\) AS abono_mensual/);
  assert.match(
    source,
    /router\.post\("\/clientes\/:id\/configuraciones"[\s\S]*INSERT INTO cliente_abonos[\s\S]*ON CONFLICT \(cliente_id, vigente_desde\) DO UPDATE/,
  );
});
