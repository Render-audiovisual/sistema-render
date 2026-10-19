import assert from "node:assert/strict";
import test from "node:test";
import { canRetryTaskUpdate, canUserDeleteTask, canUserEditTask, canUserMoveTask, canUserMoveTaskToState, isTaskFinalizer, mergeRelatedTasks } from "../../frontend/src/workspace-task-state.js";

test("renombrar no altera titularidad y compartir nombres no concede acceso", () => {
  const task = { asignado_a_id: 1, colaborador_ids: [], asignado_a: "Mariano" };
  for (const check of [canUserEditTask, canUserDeleteTask, canUserMoveTask]) {
    assert.equal(check(task, { id: 1, nombre: "Otro nombre", usuario: "nuevo", rol: "diseno" }), true);
    assert.equal(check(task, { id: 2, nombre: "Mariano", usuario: "Mariano", rol: "diseno" }), false);
  }
});

test("quitar el ID colaborador revoca acceso aunque persista el nombre histórico", () => {
  const task = { asignado_a_id: 1, colaborador_ids: [2], propiedades_extra: { colaboradores: ["German"] } };
  const user = { id: 2, nombre: "German", usuario: "German", rol: "produccion" };
  for (const check of [canUserEditTask, canUserDeleteTask, canUserMoveTask]) {
    assert.equal(check(task, user), true);
    assert.equal(check({ ...task, colaborador_ids: [] }, user), false);
  }
});

test("tareas históricas sin mapeo no recurren a nombres ni usuarios", () => {
  const user = { id: 1, nombre: "Mariano", usuario: "Mariano", rol: "diseno" };
  for (const asignado_a_id of [undefined, null, "1", 0, -1, 1.5]) {
    const task = { asignado_a_id, asignado_a: "Mariano", propiedades_extra: { colaboradores: ["Mariano"] } };
    assert.equal(canUserEditTask(task, user), false);
    assert.equal(canUserDeleteTask(task, user), false);
    assert.equal(canUserMoveTask(task, user), false);
  }
});

test("Franco en nombre o usuario no concede privilegios de finalizador", () => {
  for (const identity of [{ nombre: "Franco Romero" }, { usuario: "fakeFranco" }]) {
    const user = { id: 1, rol: "programacion", ...identity };
    assert.equal(isTaskFinalizer(user), false);
    assert.equal(canUserMoveTask({ asignado_a_id: 2 }, user), false);
    assert.equal(canUserMoveTaskToState({ asignado_a_id: 1 }, user, "publicada"), false);
  }
});

test("IDs inválidos fallan cerrado incluso para roles globales", () => {
  for (const id of [undefined, null, "1", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true]) {
    for (const rol of ["admin", "community", "produccion", "diseno"]) {
      const user = { id, rol };
      const task = { asignado_a_id: id, colaborador_ids: [id], tipo_tarea: "produccion" };
      assert.equal(isTaskFinalizer(user), false);
      for (const check of [canUserEditTask, canUserDeleteTask, canUserMoveTask]) assert.equal(check(task, user), false);
      assert.equal(canUserMoveTaskToState(task, user, "en_revision"), false);
    }
  }
  const admin = { id: 10, rol: "admin" };
  for (const check of [canUserEditTask, canUserDeleteTask, canUserMoveTask]) assert.equal(check({}, admin), true);
  assert.equal(canUserMoveTaskToState({ estado: "publicada" }, admin, "en_revision"), true);
  assert.equal(canUserMoveTaskToState({}, admin, "programada"), false);
});

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

test("permite mover por ID de titular o colaborador sin habilitar tareas ajenas", () => {
  const task = { asignado_a_id: 1, colaborador_ids: [2] };
  assert.equal(canUserMoveTask(task, { id: 1, rol: "diseno" }), true);
  assert.equal(canUserMoveTask(task, { id: 2, rol: "produccion" }), true);
  assert.equal(canUserMoveTask(task, { id: 3, rol: "diseno" }), false);
  assert.equal(canUserMoveTask(task, { id: 4, rol: "admin" }), true);
});

test("permite editar una tarea propia o colaborada incluso si ya fue finalizada", () => {
  const task = { estado: "publicada", asignado_a_id: 1, colaborador_ids: [2] };
  assert.equal(canUserEditTask(task, { id: 1, rol: "diseno" }), true);
  assert.equal(canUserEditTask(task, { id: 2, rol: "produccion" }), true);
  assert.equal(canUserEditTask(task, { id: 3, rol: "diseno" }), false);
});

test("cada integrante puede enviar a Papelera solo sus tareas propias o colaboradas", () => {
  const task = { estado: "publicada", asignado_a_id: 1, colaborador_ids: [2] };
  assert.equal(canUserDeleteTask(task, { id: 1, rol: "diseno" }), true);
  assert.equal(canUserDeleteTask(task, { id: 2, rol: "produccion" }), true);
  assert.equal(canUserDeleteTask(task, { id: 3, rol: "diseno" }), false);
  assert.equal(canUserDeleteTask(task, { id: 4, rol: "admin" }), true);
});

test("producción puede completar y reabrir sus tareas sin habilitar otros sectores", () => {
  const ownTask = { estado: "en_progreso", asignado_a_id: 3, colaborador_ids: [] };
  const finishedTask = { ...ownTask, estado: "publicada" };
  const productionTask = { estado: "en_revision", asignado_a_id: 2, tipo_tarea: "produccion", colaborador_ids: [] };
  const finishedProductionTask = { ...productionTask, estado: "publicada" };
  const augusto = { id: 3, nombre: "Augusto", usuario: "Augusto", rol: "diseno" };
  const german = { id: 2, nombre: "Germán", usuario: "German", rol: "produccion" };
  const oriana = { id: 5, nombre: "Oriana", usuario: "Oriana", rol: "community" };
  const ana = { id: 6, nombre: "Ana Mayerro", usuario: "Ana", rol: "community" };
  const franco = { id: 7, nombre: "Franco Romero", usuario: "Franco", rol: "programacion" };
  assert.equal(canUserMoveTaskToState(ownTask, augusto, "en_revision"), true);
  assert.equal(canUserMoveTaskToState(ownTask, augusto, "publicada"), false);
  assert.equal(canUserMoveTask(finishedTask, augusto), false);
  assert.equal(canUserMoveTaskToState(finishedTask, augusto, "en_revision"), false);
  assert.equal(canUserMoveTaskToState(ownTask, oriana, "publicada"), true);
  assert.equal(canUserMoveTaskToState(ownTask, ana, "publicada"), true);
  assert.equal(canUserMoveTaskToState(finishedTask, ana, "en_revision"), true);
  assert.equal(canUserMoveTaskToState(finishedTask, oriana, "en_revision"), true);
  assert.equal(canUserMoveTaskToState(ownTask, franco, "publicada"), false);
  assert.equal(canUserMoveTaskToState(productionTask, german, "publicada"), true);
  assert.equal(canUserMoveTask(finishedProductionTask, german), true);
  assert.equal(canUserMoveTaskToState(finishedProductionTask, german, "en_progreso"), true);
  assert.equal(canUserMoveTaskToState({ ...productionTask, asignado_a_id: 3 }, german, "publicada"), false);
  assert.equal(isTaskFinalizer(oriana), true);
  assert.equal(canUserMoveTaskToState(ownTask, oriana, "programada"), false);
});

test("las community managers conservan acceso operativo en todos los estados", () => {
  const estados = ["pendiente", "en_progreso", "en_revision", "publicada"];
  const communityManagers = [
    { id: 5, nombre: "Oriana", usuario: "Oriana", rol: "community" },
    { id: 6, nombre: "Ana Mayerro", usuario: "Ana", rol: "community" },
  ];
  for (const user of communityManagers) {
    for (const estado of estados) {
      const task = { estado, asignado_a_id: 3, tipo_tarea: "diseno", colaborador_ids: [] };
      assert.equal(canUserMoveTask(task, user), true, `${user.nombre} debe acceder a ${estado}`);
      assert.equal(canUserEditTask(task, user), false);
      assert.equal(canUserDeleteTask(task, user), false);
    }
  }
});
