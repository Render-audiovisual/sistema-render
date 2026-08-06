import assert from "node:assert/strict";
import test from "node:test";
import { canRetryTaskUpdate, canUserMoveTask, mergeRelatedTasks } from "../../frontend/src/workspace-task-state.js";

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

test("reintenta un movimiento si el conflicto no modificó el estado", () => {
  const previous = { id: 10, estado: "pendiente", titulo: "Video", updated_at: "antes" };
  const current = { ...previous, titulo: "Video corregido", updated_at: "después" };
  assert.equal(canRetryTaskUpdate(previous, current, { estado: "en_proceso" }), true);
});

test("no reintenta si otra persona modificó el mismo campo", () => {
  const previous = { id: 10, estado: "pendiente", propiedades_extra: { resumen: "A" } };
  const current = { id: 10, estado: "revision", propiedades_extra: { resumen: "B" } };
  assert.equal(canRetryTaskUpdate(previous, current, { estado: "en_proceso" }), false);
  assert.equal(canRetryTaskUpdate(previous, current, { propiedades_extra: { resumen: "C" } }), false);
});

test("permite mover por nombre, usuario o colaboración sin habilitar tareas ajenas", () => {
  const task = { asignado_a: "Mariano", propiedades_extra: { colaboradores: ["Germán"] } };
  assert.equal(canUserMoveTask(task, { nombre: "Mariano Meza", usuario: "Mariano", rol: "diseno" }), true);
  assert.equal(canUserMoveTask(task, { nombre: "Germán", usuario: "German", rol: "produccion" }), true);
  assert.equal(canUserMoveTask(task, { nombre: "Augusto", usuario: "Augusto", rol: "diseno" }), false);
  assert.equal(canUserMoveTask(task, { nombre: "Líder", usuario: "lider", rol: "admin" }), true);
});
