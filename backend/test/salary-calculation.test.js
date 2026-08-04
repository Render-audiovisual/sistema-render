import test from "node:test";
import assert from "node:assert/strict";
import { calculateSalaryDashboard, isValidSalaryPeriod, normalizePerson } from "../src/salary-calculation.js";

const task = (id, assigned, state, subtype, extra = {}) => ({
  id, titulo: subtype, asignado_a: assigned, estado: state, tipo_tarea: extra.type || "diseno",
  subtipo: subtype, fecha_vencimiento: "2026-08-10", propiedades_extra: extra.properties || {},
});

test("valida período y normaliza nombres con acentos", () => {
  assert.equal(isValidSalaryPeriod("2026-08"), true);
  assert.equal(isValidSalaryPeriod("2026-13"), false);
  assert.equal(normalizePerson(" Germán "), "german");
});

test("Augusto devenga 30% al completar 3 de 10 carruseles", () => {
  const tasks = Array.from({ length: 3 }, (_, index) => task(index + 1, "Augusto", "publicada", "carrusel"));
  const result = calculateSalaryDashboard({ period: "2026-08", tasks });
  const augusto = result.employees.find((employee) => employee.name === "Augusto");
  assert.equal(augusto.target, 10);
  assert.equal(augusto.completed, 3);
  assert.equal(augusto.percentage, 30);
  assert.equal(augusto.earned, 150000);
  assert.equal(augusto.remainingAmount, 350000);
});

test("Oriana combina historias y publicaciones del mes sin contar otros períodos", () => {
  const histories = [{ id: 1, estado: "publicada", fecha_programada: "2026-08-05" }, { id: 2, estado: "pendiente", fecha_programada: "2026-08-06" }];
  const publications = [{ id: 1, estado: "publicada", fecha_programada: "2026-08-07" }, { id: 2, estado: "publicada", fecha_programada: "2026-07-07" }];
  const result = calculateSalaryDashboard({ period: "2026-08", histories, publications });
  const oriana = result.employees.find((employee) => employee.name === "Oriana");
  assert.equal(oriana.target, 3);
  assert.equal(oriana.completed, 2);
  assert.equal(oriana.earned, 233333);
});

test("reconoce alias de Mariano y Germán y separa cada especialidad", () => {
  const tasks = [
    task(1, "Mariano Meza", "publicada", "diseñar", { type: "diseno" }),
    task(2, "German", "publicada", "filmar", { type: "produccion" }),
  ];
  const result = calculateSalaryDashboard({ period: "2026-08", tasks });
  assert.equal(result.employees.find((employee) => employee.name === "Mariano").completed, 1);
  assert.equal(result.employees.find((employee) => employee.name === "Germán").completed, 1);
});

test("Luciano no recibe un importe inventado si falta el valor por video", () => {
  const result = calculateSalaryDashboard({ period: "2026-08", tasks: [task(1, "Luciano", "publicada", "editar video", { type: "edicion" })] });
  const luciano = result.employees.find((employee) => employee.name === "Luciano");
  assert.equal(luciano.completed, 1);
  assert.equal(luciano.earned, null);
  assert.equal(luciano.configurationPending, true);
});

test("prioriza el lote importado de ClickUp para evitar duplicar reportes", () => {
  const tasks = [
    task(1, "Augusto", "publicada", "carrusel"),
    task(2, "Augusto", "publicada", "carrusel", { properties: { reporte_fuente: "clickup", reporte_periodo: "2026-08" } }),
  ];
  const result = calculateSalaryDashboard({ period: "2026-08", tasks });
  assert.equal(result.employees.find((employee) => employee.name === "Augusto").completed, 1);
});
