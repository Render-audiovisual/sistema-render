import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getTasksEmptyMessage, getTaskViewState, isNewTaskDraftDirty, updateTaskViewUrl } from "../../frontend/src/features/render-os/utils/task-view-state.js";
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

test("el estado de Tareas se conserva en la URL sin perder el enlace directo", () => {
  const state = getTaskViewState("?task=42&view=list&mode=archived&responsible=Augusto&q=urgente&month=2026-08");
  assert.equal(state.view, "list");
  assert.equal(state.archiveMode, "archived");
  assert.equal(state.responsible, "Augusto");
  assert.equal(state.query, "urgente");
  assert.equal(state.calendarMonth, "2026-08");

  const url = updateTaskViewUrl("https://sistema.rendercorrientes.com/workspace/tareas?task=42", {
    ...state,
    area: "diseno",
  });
  assert.equal(url.searchParams.get("task"), "42");
  assert.equal(url.searchParams.get("view"), "list");
  assert.equal(url.searchParams.get("area"), "diseno");
  assert.equal(url.searchParams.get("month"), "2026-08");
  assert.equal(getTaskViewState("?month=2026-99").calendarMonth, "");
});

test("solo advierte al cerrar una tarea nueva cuando hay contenido", () => {
  assert.equal(isNewTaskDraftDirty({ titulo: "", asignado_a: "", colaboradores: [] }), false);
  assert.equal(isNewTaskDraftDirty({ titulo: "Preparar carrusel", asignado_a: "", colaboradores: [] }), true);
});

test("el calendario completa la última semana para conservar toda la cuadrícula", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /Math\.ceil\(\(firstOffset \+ days\) \/ 7\) \* 7/);
  assert.match(workspaceSource, /day > 0 && day <= days \? day : null/);
});

test("Tareas conserva una sola interfaz y navega en la misma pestaña", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");

  assert.match(appSource, /window\.location\.replace\("\/workspace\/tareas"\)/);
  assert.doesNotMatch(appSource, /TareasTableroPage/);
  assert.match(sidebarSource, /href=\{enlace\.href\}[\s\S]*?target="_self"/);
});

test("el archivo de Tareas se presenta como una única acción secundaria", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /Ver archivadas/);
  assert.match(workspaceSource, /Volver a tareas activas/);
  assert.doesNotMatch(workspaceSource, />Activas<\/button><button[^>]*>Archivadas</);
});

test("el frontend no fabrica sesiones y adjunta el JWT a la API", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../../frontend/src/main.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /getSesionDelPath/);
  assert.match(mainSource, /headers\.set\("Authorization", `Bearer \$\{session\.token\}`\)/);
  assert.match(mainSource, /response\.status === 401/);
});
