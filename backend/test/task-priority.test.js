import test from "node:test";
import assert from "node:assert/strict";
import { rankTaskPriorities, scoreTaskPriority } from "../src/task-priority.js";

const today = "2026-08-20";

test("prioriza una tarea vencida sobre una futura", () => {
  const result = rankTaskPriorities([
    { id: 1, titulo: "Futura", estado: "pendiente", prioridad: "alta", fecha_vencimiento: "2026-08-27", created_at: "2026-08-20", updated_at: "2026-08-20", propiedades_extra: {} },
    { id: 2, titulo: "Vencida", estado: "pendiente", prioridad: "media", fecha_vencimiento: "2026-08-19", created_at: "2026-08-18", updated_at: "2026-08-18", propiedades_extra: {} },
  ], { today });
  assert.equal(result.recommendations[0].id, 2);
  assert.equal(result.recommendations[0].dynamic_priority, "P0");
});

test("la antigüedad aumenta la atención de una tarea pendiente", () => {
  const recent = scoreTaskPriority({ estado: "pendiente", prioridad: "baja", created_at: "2026-08-20", updated_at: "2026-08-20", propiedades_extra: {} }, { today });
  const old = scoreTaskPriority({ estado: "pendiente", prioridad: "baja", created_at: "2026-08-15", updated_at: "2026-08-15", propiedades_extra: {} }, { today });
  assert.ok(old.priority_score > recent.priority_score);
  assert.match(old.priority_reasons.join(" "), /Lleva 5 días pendiente/);
});

test("una tarea bloqueada no desplaza a una tarea accionable", () => {
  const result = rankTaskPriorities([
    { id: 1, estado: "pendiente", prioridad: "alta", fecha_vencimiento: "2026-08-19", created_at: "2026-08-15", updated_at: "2026-08-15", propiedades_extra: { bloqueada: true } },
    { id: 2, estado: "pendiente", prioridad: "media", fecha_vencimiento: "2026-08-21", created_at: "2026-08-20", updated_at: "2026-08-20", propiedades_extra: {} },
  ], { today });
  assert.equal(result.recommendations[0].id, 2);
  assert.equal(result.summary.blocked, 1);
});

test("excluye tareas finalizadas y en papelera", () => {
  const result = rankTaskPriorities([
    { id: 1, estado: "publicada", propiedades_extra: {} },
    { id: 2, estado: "pendiente", propiedades_extra: { papelera_render_os: true } },
  ], { today });
  assert.equal(result.summary.total, 0);
});

test("las bloqueadas o en revisión no inflan el contador de críticas accionables", () => {
  const result = rankTaskPriorities([
    { id: 1, titulo: "Bloqueada", estado: "pendiente", prioridad: "alta", fecha_vencimiento: "2026-08-01", created_at: "2026-08-01", updated_at: "2026-08-01", propiedades_extra: { bloqueada: true } },
    { id: 2, titulo: "En revisión", estado: "en_revision", prioridad: "alta", fecha_vencimiento: "2026-08-01", created_at: "2026-08-01", updated_at: "2026-08-01", propiedades_extra: {} },
  ], { today });
  assert.equal(result.summary.critical, 0);
});

test("una urgente de hoy va antes que una vencida alta", () => {
  const result = rankTaskPriorities([
    { id: 1, titulo: "Vencida", estado: "pendiente", prioridad: "alta", fecha_vencimiento: "2026-08-19", created_at: "2026-08-18", updated_at: "2026-08-18", propiedades_extra: {} },
    { id: 2, titulo: "Urgente hoy", estado: "pendiente", prioridad: "alta", fecha_vencimiento: "2026-08-20", created_at: "2026-08-20", updated_at: "2026-08-20", propiedades_extra: {} },
  ], { today });
  assert.equal(result.recommendations[0].id, 2);
});

test("entre vencidas de igual prioridad va primero la más antigua", () => {
  const result = rankTaskPriorities([
    { id: 1, estado: "pendiente", prioridad: "media", fecha_vencimiento: "2026-08-19", created_at: "2026-08-18", updated_at: "2026-08-18", propiedades_extra: {} },
    { id: 2, estado: "pendiente", prioridad: "media", fecha_vencimiento: "2026-08-18", created_at: "2026-08-10", updated_at: "2026-08-18", propiedades_extra: {} },
  ], { today });
  assert.equal(result.recommendations[0].id, 2);
});
