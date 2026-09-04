import assert from "node:assert/strict";
import test from "node:test";
import { canRetryTaskUpdate, canUserMoveTask, canUserMoveTaskToState, isTaskFinalizer, mergeRelatedTasks } from "../../frontend/src/workspace-task-state.js";

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

test("producción puede completar y reabrir sus tareas sin habilitar otros sectores", () => {
  const ownTask = { estado: "en_progreso", asignado_a: "Augusto", propiedades_extra: {} };
  const finishedTask = { ...ownTask, estado: "publicada" };
  const productionTask = { estado: "en_revision", asignado_a: "Germán", tipo_tarea: "produccion", propiedades_extra: {} };
  const finishedProductionTask = { ...productionTask, estado: "publicada" };
  const augusto = { nombre: "Augusto", usuario: "Augusto", rol: "diseno" };
  const german = { nombre: "Germán", usuario: "German", rol: "produccion" };
  const oriana = { nombre: "Oriana", usuario: "Oriana", rol: "community" };
  const franco = { nombre: "Franco Romero", usuario: "Franco", rol: "programacion" };
  assert.equal(canUserMoveTaskToState(ownTask, augusto, "en_revision"), true);
  assert.equal(canUserMoveTaskToState(ownTask, augusto, "publicada"), false);
  assert.equal(canUserMoveTask(finishedTask, augusto), false);
  assert.equal(canUserMoveTaskToState(finishedTask, augusto, "en_revision"), false);
  assert.equal(canUserMoveTaskToState(ownTask, oriana, "publicada"), true);
  assert.equal(canUserMoveTaskToState(finishedTask, oriana, "en_revision"), true);
  assert.equal(canUserMoveTaskToState(ownTask, franco, "publicada"), true);
  assert.equal(canUserMoveTaskToState(productionTask, german, "publicada"), true);
  assert.equal(canUserMoveTask(finishedProductionTask, german), true);
  assert.equal(canUserMoveTaskToState(finishedProductionTask, german, "en_progreso"), true);
  assert.equal(canUserMoveTaskToState({ ...productionTask, asignado_a: "Augusto" }, german, "publicada"), false);
  assert.equal(isTaskFinalizer(oriana), true);
  assert.equal(canUserMoveTaskToState(ownTask, oriana, "programada"), false);
});
