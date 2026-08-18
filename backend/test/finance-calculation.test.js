import test from "node:test";
import assert from "node:assert/strict";
import { applyCompensations, employeeKey, nextPeriod } from "../src/finance-calculation.js";
import { buildAutomaticFinanceSummary, calculateBillingForWorkPeriod, calculateFixedExpenses, previousPeriod } from "../src/automatic-finance.js";
import { roundExchangeRateUp } from "../src/exchange-rate.js";
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
  assert.match(source, /router\.get\("\/sueldos", requireRole\("admin"\)/);
  assert.doesNotMatch(source, /router\.(post|put)\("\/finanzas\//);
  assert.match(source, /router\.post\("\/clientes\/:id\/abono-proximo-mes", requireRole\("admin"\)/);
  assert.match(source, /req\.auth\.rol === "admin"[\s\S]*abono_mensual, abono_vigente_desde/);
});

test("la facturación automática queda separada de los abonos operativos de Clientes", () => {
  const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const financeRoute = source.slice(source.indexOf('router.get("/sueldos"'), source.indexOf('router.post("/clientes/:id/abono-proximo-mes'));
  assert.match(financeRoute, /contratos_financieros/);
  assert.doesNotMatch(financeRoute, /cliente_abonos|cliente_configuraciones/);
  assert.match(
    source,
    /router\.post\("\/clientes\/:id\/configuraciones"[\s\S]*INSERT INTO cliente_abonos[\s\S]*ON CONFLICT \(cliente_id, vigente_desde\) DO UPDATE/,
  );
});

test("Finanzas expone el cálculo automático a mes vencido", () => {
  const backend = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const frontend = readFileSync(new URL("../../frontend/src/pages/Sueldos.jsx", import.meta.url), "utf8");
  assert.match(backend, /buildAutomaticFinanceSummary/);
  assert.match(frontend, /FACTURACIÓN A COBRAR/);
  assert.match(frontend, /Mes vencido/);
  assert.match(frontend, /Gastos fijos/);
  assert.match(frontend, /Dólar usado/);
  assert.doesNotMatch(frontend, /Equipo \+ Franco programador|Herramientas USD|Herramientas ARS/);
  assert.match(backend, /getCardDollarRate/);
  assert.match(frontend, /Sin cargas manuales/);
  assert.doesNotMatch(frontend, /Guardar cierre mensual/);
});

test("septiembre cobra agosto y prorratea Óptica desde el día 19", () => {
  assert.equal(previousPeriod("2026-09"), "2026-08");
  const billing = calculateBillingForWorkPeriod([
    { nombre: "Cliente completo", importe_mensual: 310000, inicia_el: "2026-08-01" },
    { nombre: "Óptica", importe_mensual: 620000, inicia_el: "2026-08-19" },
    { nombre: "Pope", importe_mensual: 550000, inicia_el: "2026-09-01" },
  ], "2026-08");
  assert.deepEqual(billing.items.map((item) => [item.nombre, item.importe]), [
    ["Cliente completo", 310000],
    ["Óptica", 260000],
  ]);
  assert.equal(billing.total, 570000);
});

test("la cartera informada factura 9.172.581 pesos en septiembre", () => {
  const amounts = [950000, 600000, 500000, 680000, 900000, 550000, 1200000, 1800000, 390000, 780000, 550000];
  const contracts = amounts.map((importe_mensual, index) => ({ nombre: `Cliente ${index}`, importe_mensual, inicia_el: "2026-08-01" }));
  contracts.push({ nombre: "Óptica Occhiali", importe_mensual: 650000, inicia_el: "2026-08-19" });
  contracts.push({ nombre: "Pope Burger", importe_mensual: 550000, inicia_el: "2026-09-01" });
  assert.equal(calculateBillingForWorkPeriod(contracts, "2026-08").total, 9172581);
  assert.equal(calculateBillingForWorkPeriod(contracts, "2026-09").total, 10100000);
});

test("Adobe e impuestos no se duplican y los dólares se convierten a pesos", () => {
  const expenses = calculateFixedExpenses([
    { nombre: "Adobe — 2 cuentas", categoria: "herramientas", moneda: "ARS", importe: 36000, dia_pago: 3, inicia_el: "2026-08-01" },
    { nombre: "ChatGPT", categoria: "herramientas", moneda: "USD", importe: 100, dia_pago: 1, inicia_el: "2026-08-01" },
    { nombre: "Contabo", categoria: "herramientas", moneda: "USD", importe: 10, dia_pago: 5, inicia_el: "2026-08-01" },
    { nombre: "Impuestos", categoria: "impuestos", moneda: "ARS", importe: 95000, dia_pago: 20, inicia_el: "2026-08-01" },
    { nombre: "Franco", categoria: "sueldos", moneda: "ARS", importe: 75000, dia_pago: 1, inicia_el: "2026-08-01" },
  ], "2026-09");
  assert.equal(expenses.herramientasARS, 36000);
  assert.equal(expenses.herramientasUSD, 110);
  assert.equal(expenses.impuestosARS, 95000);
  const summary = buildAutomaticFinanceSummary({
    period: "2026-09",
    contracts: [{ nombre: "Cliente", importe_mensual: 1000000, inicia_el: "2026-08-01" }],
    expenses: expenses.items.map((item) => ({ ...item, inicia_el: "2026-08-01", dia_pago: item.diaPago })),
    payrollARS: 500000,
    exchangeRateARS: 1500,
  });
  assert.equal(summary.sueldos, 575000);
  assert.equal(summary.herramientasUSDEnARS, 165000);
  assert.equal(summary.gastosFijosARS, 296000);
  assert.equal(summary.resultadoARS, 129000);
  assert.equal(summary.herramientasUSD, 110);
});

test("la cotización se redondea hacia arriba al próximo múltiplo de cien", () => {
  assert.equal(roundExchangeRateUp(1490), 1500);
  assert.equal(roundExchangeRateUp(1500), 1500);
  assert.equal(roundExchangeRateUp(1963), 2000);
});
