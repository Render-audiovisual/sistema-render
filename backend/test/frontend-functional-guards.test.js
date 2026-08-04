import assert from "node:assert/strict";
import test from "node:test";

import { getTasksEmptyMessage } from "../../frontend/src/features/render-os/utils/task-view-state.js";
import { parseJsonArrayResponse } from "../../frontend/src/shared/http/response-utils.js";

test("parseJsonArrayResponse acepta únicamente respuestas HTTP exitosas con listas", async () => {
  const items = [{ id: 1 }];
  assert.deepEqual(await parseJsonArrayResponse({ ok: true, json: async () => items }, "Error"), items);

  await assert.rejects(
    parseJsonArrayResponse({ ok: false, json: async () => [] }, "No se pudo cargar"),
    /No se pudo cargar/,
  );
  await assert.rejects(
    parseJsonArrayResponse({ ok: true, json: async () => ({ error: "falló" }) }, "Respuesta inválida"),
    /Respuesta inválida/,
  );
});

test("getTasksEmptyMessage diferencia tablero vacío, archivadas y filtros", () => {
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 0, archiveMode: "active" }), "No hay tareas todavía.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 4, archiveMode: "active" }), "No hay tareas activas.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 4, archiveMode: "archived" }), "No hay tareas archivadas.");
  assert.equal(getTasksEmptyMessage({ hasFilters: true, query: "", totalTasks: 4, archiveMode: "active" }), "No hay tareas con estos filtros.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "sin resultados", totalTasks: 4, archiveMode: "active" }), "No hay tareas con estos filtros.");
});
