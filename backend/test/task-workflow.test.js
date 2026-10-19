import assert from "node:assert/strict";
import test from "node:test";
import {
  getStateNotification,
  isTaskFinalizer,
  isTaskLeader,
  isVideoEditingTask,
  validateProductionHandoff,
} from "../src/task-workflow.js";

test("avisa a líderes al iniciar y publicar sin avisar por estados irrelevantes", () => {
  assert.deepEqual(getStateNotification({ estado: "en_progreso" }, "pendiente").recipients, ["Agustín", "Franco"]);
  assert.deepEqual(getStateNotification({ estado: "publicada" }, "programada").recipients, ["Agustín", "Franco"]);
  assert.equal(getStateNotification({ estado: "programada" }, "en_revision"), null);
  assert.equal(getStateNotification({ estado: "en_progreso" }, "en_progreso"), null);
});

test("los carruseles en revisión llegan a Oriana y a los líderes", () => {
  const event = getStateNotification({ titulo: "Carrusel 1", tipo_tarea: "diseno", estado: "en_revision" }, "en_progreso");
  assert.deepEqual(event.recipients, ["Oriana", "Agustín", "Franco"]);
});

test("los videos en revisión llegan solo a los líderes", () => {
  const task = { titulo: "Editar reel", tipo_tarea: "edicion", estado: "en_revision" };
  assert.equal(isVideoEditingTask(task), true);
  assert.deepEqual(getStateNotification(task, "en_progreso").recipients, ["Agustín", "Franco"]);
});

test("solo el rol administrador puede aprobar una revisión", () => {
  assert.equal(isTaskLeader({ rol: "programacion", nombre: "Franco Romero" }), false);
  assert.equal(isTaskLeader({ rol: "admin", nombre: "Agustín" }), true);
  assert.equal(isTaskLeader({ rol: "diseno", nombre: "Augusto" }), false);
});

test("solo community managers y administradores pueden finalizar o reabrir tareas", () => {
  assert.equal(isTaskFinalizer({ rol: "admin", nombre: "Líder", usuario: "lider" }), true);
  assert.equal(isTaskFinalizer({ rol: "programacion", nombre: "Franco Romero", usuario: "Franco" }), false);
  assert.equal(isTaskFinalizer({ rol: "community", nombre: "Oriana", usuario: "Oriana" }), true);
  assert.equal(isTaskFinalizer({ rol: "community", nombre: "Ana Mayerro", usuario: "Ana" }), true);
  assert.equal(isTaskFinalizer({ rol: "diseno", nombre: "Augusto", usuario: "Augusto" }), false);
  assert.equal(isTaskFinalizer({ rol: "produccion", nombre: "Germán", usuario: "German" }), false);
});

test("renombrar usuarios o imitar nombres de líderes no cambia su autoridad", () => {
  for (const rol of ["admin", "community", "diseno", "edicion", "produccion", "programacion", "unknown", undefined]) {
    for (const nombre of ["Persona renombrada", "Franco Romero", "Agustín", "Líder", "franco agustin lider"]) {
      const auth = { id: 42, rol, nombre, usuario: nombre };
      assert.equal(isTaskLeader(auth), rol === "admin", `${rol}/${nombre}: leader`);
      assert.equal(isTaskFinalizer(auth), rol === "admin" || rol === "community", `${rol}/${nombre}: finalizer`);
    }
  }
  assert.equal(isTaskLeader(), false);
  assert.equal(isTaskFinalizer(), false);
  assert.equal(isTaskLeader({ rol: "ADMIN", nombre: "Agustín" }), false);
  assert.equal(isTaskFinalizer({ rol: "Community", nombre: "Franco" }), false);
});

test("una visita exige completar los videos y adjuntar Drive", () => {
  const base = { titulo: "Visita producción", tipo_tarea: "produccion", propiedades_extra: { produccion_videos_previstos: 4 } };
  assert.match(validateProductionHandoff(base), /faltan 4 videos/i);
  assert.match(validateProductionHandoff({ ...base, propiedades_extra: { ...base.propiedades_extra, produccion_registros: [{ cantidad: 4 }] } }), /Google Drive/i);
  assert.equal(validateProductionHandoff({ ...base, material_referencia: "https://drive.google.com/x", propiedades_extra: { ...base.propiedades_extra, produccion_registros: [{ cantidad: 4 }] } }), null);
});
