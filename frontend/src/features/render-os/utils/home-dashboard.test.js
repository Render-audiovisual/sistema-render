import test from "node:test";
import assert from "node:assert/strict";
import { activeTasks, belongsToUser, dashboardCharts, dashboardToday, isReelTask, isWaitingReview, orderTasks, pendingFeedback, taskPeople } from "./home-dashboard.js";

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
test("personal reel view includes editing and explicit reels without pulling in production videos", () => {
  assert.equal(isReelTask({ tipo_tarea: "edicion", titulo: "Corte corto" }), true);
  assert.equal(isReelTask({ subtipo: "reel", titulo: "Pieza social" }), true);
  assert.equal(isReelTask({ titulo: "Video institucional" }), true);
  assert.equal(isReelTask({ tipo_tarea: "produccion", titulo: "Visita para grabar 7 videos" }), false);
  assert.equal(isReelTask({ tipo_tarea: "diseno", titulo: "Carrusel" }), false);
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

test("chart stages partition records and distinguish approved reviews from published work", () => {
  const tasks = [
    { estado: "pendiente" }, { estado: "en_progreso" }, { estado: "en_revision" },
    { estado: "en_revision", propiedades_extra: { revision_aprobada: true } },
    { estado: "en_revision", propiedades_extra: { revision_aprobada: "true" } },
    { estado: "publicada" }, { estado: "desconocido" },
  ];
  const chart = dashboardCharts(tasks, "2026-10-08");
  assert.deepEqual(Object.fromEntries(chart.stages.map(({ id, count }) => [id, count])),
    { pending: 1, progress: 1, reviews: 1, ready: 2, done: 1, other: 1 });
  assert.equal(chart.stages.reduce((sum, stage) => sum + stage.count, 0), chart.total);
});

test("agenda includes today through day six and excludes closed or removed deliveries", () => {
  const chart = dashboardCharts([
    { fecha_vencimiento: "2026-10-08" }, { fecha_vencimiento: "2026-10-14" },
    { fecha_vencimiento: "2026-10-07" }, { fecha_vencimiento: "2026-10-15" }, {},
    { fecha_vencimiento: "2026-10-08", estado: "publicada" },
    { fecha_vencimiento: "2026-10-08", propiedades_extra: { archivada_render_os: true } },
    { fecha_vencimiento: "2026-10-14", propiedades_extra: { papelera_render_os: "true" } },
  ], "2026-10-08");
  assert.deepEqual(chart.agenda.map(({ date }) => date), ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.deepEqual(chart.agenda.map(({ count }) => count), [1, 0, 0, 0, 0, 0, 1]);
});

test("team loads count each open task only under its principal assignee", () => {
  const chart = dashboardCharts([
    { asignado_a: "Ana", fecha_vencimiento: "2026-10-07", propiedades_extra: { colaboradores: ["Ana", "Luis"] } },
    { asignado_a: "Ana", estado: "en_revision", propiedades_extra: { colaboradores: ["Luis"] } },
    { propiedades_extra: { colaboradores: ["Luis"] } },
    { asignado_a: "Luis", estado: "publicada" },
  ], "2026-10-08", true);
  assert.deepEqual(chart.loads, [{ name: "Ana", count: 2, late: 1, reviews: 1 }, { name: "Sin responsable principal", count: 1, late: 0, reviews: 0 }]);
  assert.equal(chart.loads.reduce((sum, entry) => sum + entry.count, 0), 3);
});

test("personal loads group open records by client including the missing-client bucket", () => {
  const chart = dashboardCharts([{ cliente_nombre: "Cliente A" }, { cliente_nombre: "Cliente A" }, {}, { cliente_nombre: "Cliente B", estado: "publicada" }], "2026-10-08");
  assert.deepEqual(chart.loads, [{ name: "Cliente A", count: 2, late: 0, reviews: 0 }, { name: "Sin cliente", count: 1, late: 0, reviews: 0 }]);
});
