import assert from "node:assert/strict";
import test from "node:test";
import { mergeRelatedTasks } from "../../frontend/src/workspace-task-state.js";

test("incorpora tareas por ID sin duplicarlas y conserva datos locales", () => {
  const current = [{ id: 10, titulo: "Anterior", cliente_nombre: "Cliente QA" }];
  const result = mergeRelatedTasks(current, [
    { id: 10, titulo: "Actualizada" },
    { id: 11, titulo: "Dependencia externa al lote" },
    { id: 11, titulo: "Dependencia actualizada" },
  ]);

  assert.equal(result.filter((task) => task.id === 10).length, 1);
  assert.equal(result.find((task) => task.id === 10).titulo, "Actualizada");
  assert.equal(result.find((task) => task.id === 10).cliente_nombre, "Cliente QA");
  assert.equal(result.filter((task) => task.id === 11).length, 1);
  assert.equal(result.find((task) => task.id === 11).titulo, "Dependencia actualizada");
  assert.equal(result.find((task) => task.id === 11).__renderOsDirectOnly, true);
});
