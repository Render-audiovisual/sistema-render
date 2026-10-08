import test from "node:test";
import assert from "node:assert/strict";
import { activeTasks, belongsToUser, dashboardToday, isWaitingReview, orderTasks, pendingFeedback, taskPeople } from "./home-dashboard.js";

test("approved reviews remain actionable for the community publisher", () => {
  const approved = { estado: "en_revision", asignado_a: "Oriana", propiedades_extra: { revision_aprobada: true } };
  assert.equal(isWaitingReview(approved), false);
  assert.equal(isWaitingReview({ ...approved, propiedades_extra: { revision_aprobada: "true" } }), false);
  assert.equal(isWaitingReview({ ...approved, propiedades_extra: {} }), true);
  assert.equal(activeTasks([approved]).length, 1);
  assert.equal(belongsToUser(taskPeople(approved), { nombre: "Oriana" }), true);
});

test("personal assignment matches names and usernames, accents and collaborators", () => {
  const task = { asignado_a: "Luciano", propiedades_extra: { colaboradores: ["Germán"] } };
  assert.equal(belongsToUser(taskPeople(task), { nombre: "Otro", usuario: "german" }), true);
  assert.equal(belongsToUser(taskPeople(task), { nombre: "Lucia" }), false);
  assert.equal(belongsToUser([""], {}), false);
});
test("priorities cover overdue, today, next seven days, progress and undated tasks without mutation", () => {
  const tasks = [
    { id: 6 }, { id: 5, fecha_vencimiento: "2026-11-01" },
    { id: 4, estado: "en_progreso" }, { id: 3, fecha_vencimiento: "2026-10-15" },
    { id: 2, fecha_vencimiento: "2026-10-08" }, { id: 1, fecha_vencimiento: "2026-10-07" },
  ];
  assert.deepEqual(orderTasks(tasks, "2026-10-08").map((task) => task.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(tasks[0].id, 6);
});
test("complete, archived and deleted tasks never enter open counts", () => {
  assert.deepEqual(activeTasks([
    { id: 1, estado: "publicada" }, { id: 2, propiedades_extra: { archivada_render_os: "true" } },
    { id: 3, propiedades_extra: { papelera_render_os: true } },
    { id: 4, propiedades_extra: { archivada_render_os: "false" } },
  ]).map((task) => task.id), [4]);
});
test("feedback is personal by assignee; team excludes resolved and trashed", () => {
  const notes = [
    { id: 1, feedback: { responsable: "Germán" } },
    { id: 2, feedback: { responsables: ["German"], estado: "resuelto" } },
    { id: 3, feedback: { responsables: ["Luciano"] } },
    { id: 4, eliminado_at: "2026-10-08" },
    { id: 5, titulo: "Lista personal sin feedback" },
    { id: 6, feedback: {} },
    { id: 7, feedback: { responsable: "Germán", vigencia: "permanente" } },
  ];
  assert.deepEqual(pendingFeedback(notes, { usuario: "german" }).map((note) => note.id), [1]);
  assert.deepEqual(pendingFeedback(notes, {}, true).map((note) => note.id), [1, 3]);
  assert.deepEqual(pendingFeedback(notes, { usuario: "german" }, false, true).map((note) => note.id), [7]);
});
test("dashboard day follows Córdoba at the UTC day boundary", () => {
  assert.equal(dashboardToday(new Date("2026-10-09T01:00:00Z")), "2026-10-08");
});
