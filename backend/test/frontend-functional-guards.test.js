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
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(workspaceSource, /Math\.ceil\(\(firstOffset \+ days\) \/ 7\) \* 7/);
  assert.match(workspaceSource, /day > 0 && day <= days \? day : null/);
  assert.match(workspaceSource, /key === today \? "today"/);
  assert.match(workspaceSource, /task\.cliente_nombre \|\| "Sin cliente"/);
  assert.match(workspaceStyles, /\.ros-calendar-task\.area-carruseles/);
  assert.match(workspaceSource, /ros-day-preview/);
  assert.match(workspaceSource, /Resumen del día/);
  assert.match(workspaceSource, /No hay tareas para este día/);
  assert.match(workspaceStyles, /\.ros-calendar-day\.today>\.ros-calendar-day-number/);
  assert.match(workspaceStyles, /\.ros-day-preview-backdrop/);
});

test("Tareas conserva una sola interfaz y navega en la misma pestaña", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");

  assert.match(appSource, /window\.location\.replace\("\/workspace\/tareas"\)/);
  assert.doesNotMatch(appSource, /TareasTableroPage/);
  assert.match(sidebarSource, /href=\{enlace\.href\}[\s\S]*?target="_self"/);
});

test("todo el equipo puede abrir el formulario y crear únicamente tareas RENDER OS", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.doesNotMatch(serverSource, /router\.post\("\/tareas", requireRole\("admin"\)/);
  assert.match(serverSource, /req\.auth\?\.rol !== "admin" && workspace !== "render_os"/);
  assert.match(workspaceSource, /Promise\.all\(\[apiJson\("\/api\/clientes"\), apiJson\("\/api\/usuarios"\)\]\)/);
  assert.doesNotMatch(workspaceSource, /\{isAdmin && <button className="ros-primary-button"/);
  assert.match(workspaceSource, /body: JSON\.stringify\(\{ \.\.\.draft, workspace: "render_os" \}\)/);
});

test("los dashboards personales leen y actualizan únicamente RENDER OS", () => {
  const assignedTasksSource = readFileSync(new URL("../../frontend/src/components/TareasAsignadasGenericas.jsx", import.meta.url), "utf8");
  assert.match(assignedTasksSource, /workspace: "render_os"/);
  assert.match(assignedTasksSource, /\?workspace=render_os/);
  assert.match(assignedTasksSource, /href="\/workspace\/tareas"/);
  assert.doesNotMatch(assignedTasksSource, /fetch\(`\/api\/tareas\?\$\{params\.toString\(\)\}`\)\.then\(\(response\) =>\s*response\.json/);
});

test("la navegación de empleados expone trabajo y contenido, pero no gestión sensible", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
  const utilsSource = readFileSync(new URL("../../frontend/src/utils.jsx", import.meta.url), "utf8");
  assert.match(appSource, /: \["\/perfil", "\/workspace\/tareas", "\/bloc-notas", "\/drive", "\/planificacion-historias", "\/planificacion-publicaciones"\]/);
  assert.match(sidebarSource, /planificacion: \[/);
  assert.match(sidebarSource, /gestion: esAdmin \?/);
  assert.match(sidebarSource, /href: "\/reportes-historias", label: "Reportes"/);
  assert.match(sidebarSource, /href: "\/sueldos", label: "Finanzas"/);
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  assert.match(reportesSource, /esVistaAdmin && <nav className="report-section-tabs"/);
  assert.match(reportesSource, /href="\/sueldos">Finanzas/);
  assert.doesNotMatch(appSource, /: \[[^\]]*"\/reportes-historias"/);
  assert.doesNotMatch(utilsSource, /getUsuarioKey\(sesion\?\.usuario\?\.usuario\) === "franco"/);
});

test("el reporte personal de Oriana separa carruseles, reels e historias publicadas", () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  assert.match(reportesSource, /resumenOperativo\("carruseles"\)/);
  assert.match(reportesSource, /resumenOperativo\("ediciones"\)/);
  assert.match(reportesSource, /resumenOperativo\("reels_planificados"\)/);
  assert.match(reportesSource, /resumenRenderOsPorDia/);
  assert.match(reportesSource, /etiqueta: "Carruseles entregados"/);
  assert.match(reportesSource, /etiqueta: "Reels publicados"/);
  assert.match(reportesSource, /etiqueta: "Historias publicadas"/);
  assert.match(reportesSource, /belongsToPerson\(nombrePropio, "Oriana"\)/);
});

test("el reporte se actualiza al volver a la pestaña y periódicamente", () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  assert.match(reportesSource, /fetch\("\/api\/reportes\/datos", \{ cache: "no-store" \}\)/);
  assert.match(reportesSource, /setInterval\(\(\) => cargarReporte\(true\), 30000\)/);
  assert.match(reportesSource, /window\.addEventListener\("focus", actualizarAlVolver\)/);
  assert.match(reportesSource, /document\.addEventListener\("visibilitychange", actualizarAlVolver\)/);
});

test("Reportes muestra cierre mensual y una barra de avance animada accesible", () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../../frontend/src/styles.css", import.meta.url), "utf8");
  assert.match(reportesSource, /<h2>Reporte del equipo<\/h2>/);
  assert.match(reportesSource, /Tenés tiempo de completarlo hasta el/);
  assert.match(reportesSource, /🚀/);
  assert.match(reportesSource, /formatPeriodDeadline\(rangoPeriodo\.hasta\)/);
  assert.match(reportesSource, /tarjeta\.nombre === "Luciano" \? "" : fechaLimite/);
  assert.match(stylesSource, /@keyframes report-progress-shine/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:reduce\)/);
});

test("el archivo de Tareas se presenta como una única acción secundaria", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(workspaceSource, /Ver archivadas/);
  assert.match(workspaceSource, /Volver a tareas activas/);
  assert.doesNotMatch(workspaceSource, />Activas<\/button><button[^>]*>Archivadas</);
  assert.match(workspaceStyles, /grid-template-columns:repeat\(5,minmax\(230px,1fr\)\)/);
  assert.match(workspaceStyles, /grid-template-columns:repeat\(5,82vw\)/);
  assert.match(workspaceStyles, /scroll-snap-type:x proximity/);
});

test("la revisión de videos permite al Líder entregarlos a Oriana", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /Aprobar y enviar a Oriana/);
  assert.match(workspaceSource, /\/aprobar-publicacion\?workspace=render_os/);
  assert.match(workspaceSource, /Pegá el enlace de la carpeta de Google Drive/);
});

test("el detalle de todas las tareas conserva guion, copy e indicaciones en un único espacio", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(workspaceSource, /Contenido de trabajo/);
  assert.doesNotMatch(workspaceSource, /role="tablist"/);
  assert.match(workspaceSource, /Escribí el guion, copy o las indicaciones acá/);
  assert.match(workspaceSource, /metadataField: "guiones"/);
  assert.match(workspaceSource, /metadataField: "copy_trabajo"/);
  assert.match(workspaceSource, /field: "aclaraciones"/);
  assert.match(workspaceSource, /getCanonicalTaskContentMetadata/);
  assert.match(workspaceSource, /getUnifiedTaskContent\(task\)/);
  assert.match(workspaceSource, /Los cambios se guardan únicamente al presionar/);
  assert.match(workspaceSource, /ros-task-document-properties/);
  assert.match(workspaceSource, /ros-activity-history/);
  assert.match(workspaceSource, /Ver historial/);
  assert.doesNotMatch(workspaceSource, /ros-latest-progress/);
  assert.match(workspaceSource, /Acciones de tarea/);
  assert.match(workspaceSource, /Sin material vinculado/);
  assert.doesNotMatch(workspaceSource, /Todavía no hay comentarios del equipo/);
  assert.match(workspaceStyles, /\.ros-task-main-column\{[^}]*margin:0(?: auto)?;[^}]*max-width:[^;]+;[^}]*min-height:0;[^}]*padding:/);
  assert.match(workspaceStyles, /\.ros-task-layout\{display:block;/);
  assert.match(workspaceStyles, /--ros-type-body:14px/);
  assert.match(workspaceStyles, /--ros-type-page:32px/);
  assert.match(workspaceStyles, /\.ros-task-card h3\{font-size:15px/);
  assert.match(workspaceStyles, /\.ros-content-textarea,[^}]*font-size:var\(--ros-type-body\)/);
  assert.match(workspaceStyles, /grid-template-columns:1\.05fr 1\.05fr 1\.05fr 1fr \.78fr auto/);
  assert.match(workspaceStyles, /\.ros-controls-meta>span\{[^}]*border-radius:999px/);
});

test("el frontend no fabrica sesiones y adjunta el JWT a la API", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../../frontend/src/main.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /getSesionDelPath/);
  assert.match(mainSource, /headers\.set\("Authorization", `Bearer \$\{session\.token\}`\)/);
  assert.match(mainSource, /response\.status === 401/);
});
