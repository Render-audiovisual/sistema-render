import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getTasksEmptyMessage, getTaskViewState, isNewTaskDraftDirty, updateTaskViewUrl } from "../../frontend/src/features/render-os/utils/task-view-state.js";
import { normalizeSelectionRect, selectionRectsIntersect } from "../../frontend/src/features/render-os/utils/selection-geometry.js";
import { parseJsonArrayResponse } from "../../frontend/src/shared/http/response-utils.js";
import { getNavigationGroups } from "../../frontend/src/components/navigation.js";
import { canonicalLegacyRoute } from "../../frontend/src/shared/navigation/legacy-routes.js";

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

test("getTasksEmptyMessage diferencia tablero vacío, Papelera y filtros", () => {
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 0, archiveMode: "active" }), "No hay tareas todavía.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 4, archiveMode: "active" }), "No hay tareas activas.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "", totalTasks: 4, archiveMode: "trash" }), "La Papelera está vacía.");
  assert.equal(getTasksEmptyMessage({ hasFilters: true, query: "", totalTasks: 4, archiveMode: "active" }), "No hay tareas con estos filtros.");
  assert.equal(getTasksEmptyMessage({ hasFilters: false, query: "sin resultados", totalTasks: 4, archiveMode: "active" }), "No hay tareas con estos filtros.");
});

test("la selección rectangular normaliza cualquier dirección y detecta tarjetas", () => {
  const rectangle = normalizeSelectionRect(300, 220, 100, 80);
  assert.deepEqual(rectangle, { left: 100, top: 80, right: 300, bottom: 220, width: 200, height: 140 });
  assert.equal(selectionRectsIntersect(rectangle, { left: 250, top: 170, right: 350, bottom: 260 }), true);
  assert.equal(selectionRectsIntersect(rectangle, { left: 301, top: 80, right: 380, bottom: 220 }), false);
});

test("Papelera se conserva en la URL y las URLs antiguas de Archivadas vuelven al tablero", () => {
  assert.equal(getTaskViewState("?mode=trash").archiveMode, "trash");
  assert.equal(getTaskViewState("?mode=archived").archiveMode, "active");
  const url = updateTaskViewUrl("https://sistema.rendercorrientes.com/workspace/tareas", {
    ...getTaskViewState(""), archiveMode: "trash",
  });
  assert.equal(url.searchParams.get("mode"), "trash");
});

test("el estado de Tareas se conserva en la URL sin perder el enlace directo", () => {
  const state = getTaskViewState("?task=42&view=list&mode=trash&responsible=Augusto&q=urgente&month=2026-08");
  assert.equal(state.view, "list");
  assert.equal(state.archiveMode, "trash");
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

test("el calendario editorial permite abrir y verificar sus tareas vinculadas", () => {
  const publicacionesSource = readFileSync(new URL("../../frontend/src/pages/Publicaciones.jsx", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(publicacionesSource, /\/api\/publicaciones\/\$\{piezaSel\.id\}\/tareas/);
  assert.match(publicacionesSource, /Tareas para verificar/);
  assert.match(publicacionesSource, /workspace\/tareas\?task=\$\{tarea\.id\}/);
  assert.match(serverSource, /router\.get\("\/publicaciones\/:id\/tareas"/);
  assert.match(serverSource, /buildTaskReadAccessClause\(req\.auth, "t", "\$2", "render_os"\)/);
});

test("Tareas conserva una sola interfaz y navega en la misma pestaña", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");

  assert.match(appSource, /replaceLegacyRoute\(window, legacyDestination\)/);
  assert.match(appSource, /canonicalLegacyRoute\(route\)/);
  assert.doesNotMatch(appSource, /TareasTableroPage/);
  assert.match(sidebarSource, /href=\{enlace\.href\}[\s\S]*?target="_self"/);
});

test("Inicio personal consulta datos aislados por sesión y conserva navegación SPA", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
  const quickHomeSource = readFileSync(new URL("../../frontend/src/pages/QuickHome.jsx", import.meta.url), "utf8");
  const homeHelper = readFileSync(new URL("../../frontend/src/pages/personalHome.js", import.meta.url), "utf8");

  assert.match(appSource, /React\.lazy/);
  assert.match(appSource, /path === "\/inicio"/);
  assert.match(sidebarSource, /event\.preventDefault\(\)/);
  assert.match(sidebarSource, /onNavigate\(href\)/);
  assert.match(quickHomeSource, /request = apiRequest/);
  assert.match(quickHomeSource, /identityRef\.current === identity/);
  assert.match(quickHomeSource, /result\?\.identity === identity/);
  assert.match(quickHomeSource, /loader\.dispose\(\)/);
  assert.match(quickHomeSource, /unsubscribe\(\)/);
  assert.match(homeHelper, /request\("\/api\/inicio", scoped \? sessionRequestOptions\(binding, \{ signal \}\) : \{ signal \}\)/);
  assert.match(homeHelper, /sessionBindingMatches\(binding, readSession\(\)\)/);
  assert.match(homeHelper, /parsePersonalHome\(result, observedUserId, allowTeamReview\)/);
  assert.match(homeHelper, /controller\?\.abort\(\)/);
  assert.match(homeHelper, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(homeHelper, /onNavigate\(href\)/);
});

test("todo el equipo puede abrir el formulario y crear únicamente tareas RENDER OS", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.doesNotMatch(serverSource, /router\.post\("\/tareas", requireRole\("admin"\)/);
  const taskCreateSource=readFileSync(new URL('../src/task-create-input.js',import.meta.url),'utf8');
  assert.match(taskCreateSource, /actor\?\.rol !== "admin" && workspace !== "render_os"/);
  assert.match(serverSource,/prepareTaskCreation\(db,input,assignmentNotificationActor,policy\)/);
  assert.match(workspaceSource, /const guard = captureRequest\(apiJson\)/);
  assert.match(workspaceSource, /Promise\.all\(\[guard.request\("\/api\/clientes"\), guard.request\("\/api\/usuarios"\)\]\)/);
  assert.doesNotMatch(workspaceSource, /\{isAdmin && <button className="ros-primary-button"/);
  assert.match(workspaceSource, /body:JSON.stringify\(draft\)/);
  const taskCreationSource=readFileSync(new URL('../../frontend/src/pages/taskCreationAttempt.js',import.meta.url),'utf8');
  assert.match(taskCreationSource,/request_id:requestId.toLowerCase\(\),workspace:'render_os'/);
  assert.match(workspaceSource,/creation.start\(input\)/);
});

test("las acciones masivas no aparecen en el tablero y la Papelera individual sigue disponible", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.doesNotMatch(workspaceSource, /Acciones masivas|ros-bulk-menu|normalizeSelectionRect/);
  assert.match(workspaceSource, /Acciones de tarea/);
  assert.match(serverSource, /router\.post\("\/tareas\/acciones-masivas", async/);
  assert.match(serverSource, /\["papelera", "restaurar"\]/);
  assert.doesNotMatch(serverSource, /router\.post\("\/tareas\/acciones-masivas", requireRole/);
  const bulkSource = readFileSync(new URL('../src/task-bulk-actions.js', import.meta.url), 'utf8');
  assert.match(serverSource, /await applyTaskBulkAction\(pool, \{ auth: req.auth, ids, action \}\)/);
  assert.match(bulkSource, /await assertCurrentTaskWriteActor\(db, captured\)/);
  assert.match(bulkSource, /buildTaskAccessClause\(actor, 't', '\$2'\)/);
  assert.match(bulkSource, /Solo podés eliminar o restaurar tareas propias o donde colaborás/);
  assert.match(workspaceSource, /canDeleteTask && <details/);
  assert.match(serverSource, /papelera_render_os/);
});

test("Tareas evita renders globales y mantiene los hooks en el nivel del componente", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /const TaskCard = React\.memo/);
  assert.match(workspaceSource, /const TasksByClient = React\.memo/);
  assert.match(workspaceSource, /const move = useCallback/);
  assert.doesNotMatch(workspaceSource, /refreshFeedbackCount|newFeedbackCount|\/api\/notas\/nuevas/);
  assert.doesNotMatch(workspaceSource, /const incorporateRelatedTasks = useCallback\(\(items\) => \{\s*const refreshFeedbackCount/);
});

test("el tablero móvil renderiza solo el proceso visible y conserva todos los contadores", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /useMediaQuery\("\(max-width: 1024px\)"\)/);
  assert.match(workspaceSource, /compactBoard\s*\?\s*BOARD_COLUMNS\.filter/);
  assert.match(workspaceSource, /renderedBoardColumns\.map/);
  assert.match(workspaceSource, /className="ros-mobile-board-nav"[\s\S]*BOARD_COLUMNS\.map/);
});

test("abrir una tarea no compite con el arrastre de la tarjeta", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /const canDrag = canMove \|\| Boolean\(manualControls\)/);
  assert.match(workspaceSource, /<article[^>]+draggable=\{canDrag\}/);
  assert.match(workspaceSource, /if \(!canDrag \|\| moveBlocked \|\| dragRef\.current\.blocked\)/);
  assert.match(workspaceSource, /dragRef\.current\.suppressClick/);
  assert.match(workspaceSource, /dragRef\.current\.blocked/);
  assert.match(workspaceSource, /<h3><button type="button" className="ros-card-open" onClick=\{\(\)=>onOpen\(task.id\)\}/);
  assert.doesNotMatch(workspaceSource, /<article role="button" tabIndex=\{0\} data-task-id/);
  assert.doesNotMatch(workspaceSource, /className="ros-card-drag-handle" draggable="true"/);
});

test('el tablero compacto permite soltar tarjetas sobre los botones de procesos', () => {
  const workspaceSource = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx', import.meta.url),'utf8');
  assert.match(workspaceSource,/onDrop=\{\(event\) => dropOnProcessButton\(event,column\)\}/);
  assert.match(workspaceSource,/if \(\(result === 'move' \|\| result === 'approval'\) && compactBoard && canUserMoveTaskToState\(task, sesion\?\.usuario, status\)\) selectMobileBoardColumn/);
  assert.match(workspaceSource,/if \(!canUserMoveTask\(task, sesion\?\.usuario\)\) return;\s*const result = move\(task, status\)/);
  assert.match(workspaceSource,/if\(manualReady&&canUserEditTask\(task,sesion\?\.usuario\)\)void onReorder\(task,null\)/);
  assert.match(workspaceSource,/event.dataTransfer.dropEffect = 'move'/);
  const extracted = workspaceSource.match(/const dropOnProcessButton = (\(event, column\) => \{[\s\S]*?\n  \});/);
  assert.ok(extracted, 'Exercise the actual column-drop callback');
  const moved = { id: 5, estado: 'en_revision' };
  const exercise = ({ result, type = 'text/task-id', id = '5', allowed = true, sort = 'date', status = 'aprobada' } = {}) => {
    const calls = [], deps = {
      tasksLatestRef: { current: [moved] }, sort, archiveMode: 'active', manualReady: true,
      effectiveTaskFilterState: task => task.estado, canonicalTaskState: state => state,
      sesion: { usuario: { id: 7, rol: 'admin' } }, compactBoard: true,
      setDragOver() {}, canUserEditTask: () => true, canUserMoveTask: () => allowed,
      canUserMoveTaskToState: () => allowed,
      move: (task, target) => { calls.push(['move', task.id, target]); return result; },
      onReorder: (task, before) => calls.push(['order', task.id, before]),
      selectMobileBoardColumn: column => calls.push(['column', column]),
    };
    const drop = new Function(...Object.keys(deps), `return (${extracted[1]});`)(...Object.values(deps));
    drop({ dataTransfer: { types: [type], getData: () => id }, preventDefault() {} }, { id: status });
    return calls;
  };
  assert.deepEqual(exercise({ result: 'review' }), [['move', 5, 'aprobada']], 'Opening review never advances the compact column');
  for (const result of [undefined, null, false, 'review', 'blocked']) {
    assert.deepEqual(exercise({ result }), [['move', 5, 'aprobada']], 'Only explicit admission advances the compact column');
  }
  for (const result of ['move', 'approval']) {
    assert.deepEqual(exercise({ result }), [['move', 5, 'aprobada'], ['column', 'aprobada']]);
  }
  assert.deepEqual(exercise({ type: 'text/plain' }), []);
  assert.deepEqual(exercise({ id: '999' }), []);
  assert.deepEqual(exercise({ allowed: false }), []);
  assert.deepEqual(exercise({ sort: 'manual', status: 'en_revision' }), [['order', 5, null]], 'Same-column manual drop remains order-only');
  const css = readFileSync(new URL('../../frontend/src/pages/TaskBoardMotion.css',import.meta.url),'utf8');
  assert.match(css,/\.ros-page \{ overflow:clip; \}/);
  assert.match(css,/\.ros-mobile-board-nav \{ position:sticky; top:58px/);
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
  assert.match(appSource, /: \["\/inicio", "\/perfil", "\/workspace\/tareas", "\/lista", "\/bloc-notas", "\/drive", "\/moodboards", "\/planificacion-historias", "\/planificacion-publicaciones", "\/reportes-historias", "\/clientes", \.\.\.\(canUseSharedCalendarRole\(sesion.usuario.rol\) \? \["\/calendario", "\/calendario-estructura"\] : \[\]\)\]/);
  assert.match(appSource, /React\.lazy/);
  assert.match(appSource, /QuickHomePage/);
  assert.match(sidebarSource, /getNavigationGroups/);
  assert.match(sidebarSource, /const rutaPrincipal = "\/inicio"/);
  const sharedHrefs = ["/inicio", "/calendario", "/workspace/tareas", "/proyectos", "/producciones", "/clientes", "/lista", "/feedback", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/perfil"];
  for (const role of ["diseno", "edicion", "produccion", "community", "programacion"]) {
    const links = getNavigationGroups(role).flatMap(group => group.links);
    assert.deepEqual(links.map(link => link.href).sort(), [...sharedHrefs].sort());
    for (const href of ["/sueldos", "/empleados", "/clientes?gestion=1"]) assert.equal(links.some(link => link.href === href), false, `${role} no recibe ${href}`);
    assert.equal(links.some(link => link.href === "/wilson-conversaciones" || link.href.includes("wilson=open")), false);
    assert.equal(links.some(link => ["/drive", "/moodboards"].includes(link.href)), false);
  }
  const adminLinks = getNavigationGroups("admin").flatMap(group => group.links);
  assert.equal(adminLinks.some(link => ["/drive", "/moodboards"].includes(link.href)), false);
  assert.doesNotMatch(appSource, /import\("\.\/pages\/(?:Drive|MoodboardPreview)\.jsx"\)/);
  assert.doesNotMatch(appSource, /<(?:DrivePage|MoodboardPreviewPage)\b/);
  for (const path of ["/drive", "/moodboards"]) {
    assert.equal(canonicalLegacyRoute(path), "/inicio");
    assert.equal(canonicalLegacyRoute(`${path}?task=42`), "/workspace/tareas?task=42");
  }
  for (const href of ["/sueldos", "/empleados", "/calendario"]) assert.equal(adminLinks.some(link => link.href === href), true);
  assert.doesNotMatch(sidebarSource, /label: "Conversaciones"/);
  assert.doesNotMatch(sidebarSource, /wilson=open/);
  assert.doesNotMatch(appSource, /<WilsonConversationsPage/);
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  const finanzasSource = readFileSync(new URL("../../frontend/src/pages/Sueldos.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(reportesSource, /report-section-tabs/);
  assert.doesNotMatch(finanzasSource, /report-section-tabs/);
  assert.match(appSource, /: \[[^\]]*"\/reportes-historias"/);
  assert.doesNotMatch(utilsSource, /getUsuarioKey\(sesion\?\.usuario\?\.usuario\) === "franco"/);
});

test("el abono mensual también puede configurarse en cuentas con cuota compartida", () => {
  const modalsSource = readFileSync(new URL("../../frontend/src/components/ClienteModals.jsx", import.meta.url), "utf8");
  assert.match(modalsSource, /<section className="cliente-edit-finance">/);
  assert.doesNotMatch(modalsSource, /!esFeedCompartido && <section className="cliente-edit-finance">/);
  assert.match(modalsSource, /\/abono-proximo-mes/);
  assert.doesNotMatch(modalsSource, /Number\(abonoMensual\) === Number\(cliente\.abono_mensual\)/);
});

test("Clientes muestra el abono mensual sin inventar estados de cobranza", () => {
  const pageSource = readFileSync(new URL("../../frontend/src/pages/Clientes.jsx", import.meta.url), "utf8");
  const modalsSource = readFileSync(new URL("../../frontend/src/components/ClienteModals.jsx", import.meta.url), "utf8");
  assert.match(pageSource, /Abono mensual/);
  assert.match(modalsSource, /<span>Abono mensual<\/span><strong>\{abono\}<\/strong>/);
  assert.doesNotMatch(pageSource, /Pago sin registrar/);
  assert.doesNotMatch(modalsSource, /Estado del pago|Sin registrar/);
});

test("el reporte conserva formatos y piezas personales por ID sin inferir publicación de tareas", async () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  const { employeeFormatBreakdown, personalEditorialReport } = await import('../../frontend/src/shared/reports/production-registry-report.js');
  const range = { desde: '2026-10-01', hasta: '2026-11-01' };
  const tasks = [{ id: 1, asignado_a_id: 7, publicacion_id: 8, titulo: 'Carrusel', estado: 'finalizada', fecha_vencimiento: '2026-10-04' }];
  assert.equal(employeeFormatBreakdown(tasks, 7, range).find(row => row.formato === 'carruseles').finalizadas, 1);
  const report = personalEditorialReport(tasks, 7, [], [{ id: 8, tipo: 'carrusel', estado: 'lista', fecha_programada: '2026-10-04' }], range);
  assert.equal(report.rows[0].programadas, 1);
  assert.equal(report.rows[0].publicadas, 0);
  assert.equal(personalEditorialReport(tasks, 9, [], [], range).available, false);
  assert.match(reportesSource, /employeeFormatBreakdown\(tasks, person.id, range\)/);
  assert.match(reportesSource, /personalEditorialReport\(tasks, person.id, data.historias, data.publicaciones, range\)/);
  assert.match(reportesSource, /sin atribución verificable/);
  assert.doesNotMatch(reportesSource, /belongsToPerson/);
});

test("el reporte se actualiza al volver a la pestaña y periódicamente", () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  assert.match(reportesSource, /new URLSearchParams\(\{ desde: range.desde, hasta: range.hasta/);
  assert.match(reportesSource, /createReportLoader\(\{ session, readSession: getSesion/);
  assert.match(reportesSource, /await loader.load\(query\)/);
  const reportLoaderSource = readFileSync(new URL('../../frontend/src/shared/reports/report-loader.js', import.meta.url), 'utf8');
  assert.match(reportLoaderSource, /scope.request\('\/api\/reportes\/datos\?/);
  assert.match(reportesSource, /observation\?\.context === context \? observation.data : null/);
  assert.match(reportesSource, /setInterval\(refresh, 30000\)/);
  assert.match(reportesSource, /addEventListener\(['"]focus['"], refresh\)/);
  assert.match(reportesSource, /addEventListener\(['"]visibilitychange['"], refresh\)/);
  assert.match(reportesSource, /document.visibilityState === 'visible'/);
  assert.match(reportesSource, /removeEventListener\(['"]focus['"], refresh\)/);
  assert.match(reportesSource, /popstate/);
});

test("Reportes prioriza rendimiento y conserva una barra de avance accesible", () => {
  const reportesSource = readFileSync(new URL("../../frontend/src/pages/Reportes.jsx", import.meta.url), "utf8");
  assert.match(reportesSource, /<h2 id="rpr-employees">Trabajo por persona/);
  assert.match(reportesSource, /<progress aria-label=.*max=\{format.total\} value=\{format.finalizadas\}/);
  assert.match(reportesSource, /format.total > 0/);
  assert.match(reportesSource, /aria-expanded=\{selectedPerson === person.id\}/);
  assert.match(reportesSource, /<h2 id="rpr-quotas">Cuotas por cliente y feed/);
  assert.match(reportesSource, /cuotas son referencia mensual, sin porcentaje/);
  assert.doesNotMatch(reportesSource, /OBJETIVOS_MENSUALES_EQUIPO/);
});

test("Tareas conserva únicamente Papelera como acción secundaria", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.doesNotMatch(workspaceSource, /Ver archivadas/);
  assert.doesNotMatch(workspaceSource, />Archivar</);
  assert.match(workspaceSource, /10 días/);
  assert.match(workspaceSource, /Volver a tareas activas/);
  assert.doesNotMatch(workspaceSource, />Activas<\/button><button[^>]*>Archivadas</);
  assert.match(workspaceStyles, /grid-template-columns:repeat\(5,minmax\(230px,1fr\)\)/);
  assert.match(workspaceStyles, /\.ros-board-four\{display:block;grid-template-columns:none/);
  assert.match(workspaceStyles, /scroll-snap-type:none/);
  assert.match(workspaceStyles, /\.ros-column\{display:none;margin:0;min-width:0;scroll-snap-align:none;width:100%\}/);
  assert.match(workspaceStyles, /\.ros-column\.is-mobile-active/);
  assert.match(workspaceSource, /aria-label="Estados del tablero"/);
  assert.match(workspaceSource, /selectMobileBoardColumn/);
  const taskHeaderStyles = readFileSync(new URL("../../frontend/src/pages/TaskHeader.css", import.meta.url), "utf8");
  assert.match(taskHeaderStyles, /@media \(max-width: 1024px\)[\s\S]*?\.ros-controls\s*>\s*div\.ros-primary-navigation:first-child/);
  assert.match(taskHeaderStyles, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(taskHeaderStyles, /\.ros-controls button\.active/);
  assert.match(workspaceSource, /className="ros-primary-navigation" aria-label="Vistas de tareas"/);
  assert.match(taskHeaderStyles, /\.ros-controls\s*>\s*div\.ros-primary-navigation:first-child\s*\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(taskHeaderStyles, /\.ros-view-tabs\s*\{\s*display:contents/);
  assert.match(taskHeaderStyles, /\.ros-controls \.ros-feedback-link\s*\{[\s\S]*?grid-column:1\/-1[\s\S]*?min-height:44px/);
  assert.match(taskHeaderStyles, /\.ros-mobile-board-nav\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(taskHeaderStyles, /\.ros-mobile-board-nav button\s*\{[\s\S]*?min-height:44px/);
  assert.match(taskHeaderStyles, /\.ros-task-list-head\s*\{\s*display:none/);
  assert.match(taskHeaderStyles, /\.ros-task-list\s*>\s*button\s*\{[\s\S]*?min-width:0/);
});

test("las vistas de Historias permanecen completas en celular", () => {
  const designSystemStyles = readFileSync(new URL("../../frontend/src/design-system.css", import.meta.url), "utf8");
  assert.match(designSystemStyles, /\.historias-viewport \.stories-view-switch\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(designSystemStyles, /\.historias-viewport \.stories-view-switch button:nth-child\(3\)\s*\{\s*grid-column:1\/-1/);
});

test("la revisión de videos permite al Líder entregarlos a Oriana", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  assert.match(workspaceSource, /Aprobar y enviar/);
  assert.match(workspaceSource, /selectedPublisher\.nombre/);
  assert.match(workspaceSource, /responsable_publicacion_id/);
  assert.match(workspaceSource, /\/aprobar-publicacion\?workspace=render_os/);
  assert.match(workspaceSource, /Pegá el enlace de la carpeta de Google Drive/);
});

test("Germán puede completar una visita desde el celular sin saltear la confirmación del Líder", () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");

  assert.match(workspaceSource, /Guardar y terminar visita/);
  assert.match(workspaceSource, /isAdmin \|\| canChangeTaskState/);
  assert.doesNotMatch(workspaceSource, /Completá primero la cantidad prevista de videos de la visita/);
  assert.match(workspaceSource, /onRegisterProduction\(task, Number\(productionAmount\), productionDate, finish\)/);
  assert.doesNotMatch(workspaceSource, /amount = productionProgress\.remaining/);
  assert.match(workspaceSource, /Un líder debe confirmar el registro\. Después asignará la edición de cada video desde Producciones/);
  assert.doesNotMatch(workspaceSource, /Confirmar y enviar a edición|Se creó la edición para Luciano|La edición quedó vinculada/);
  assert.match(workspaceSource, /Guardar avance/);
  assert.match(workspaceStyles, /\.ros-production-complete-action button\{[^}]*min-height:50px;[^}]*width:100%/);
});

test("el detalle conserva un único documento y selecciona indicaciones según el contexto de tarea", async () => {
  const workspaceSource = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.css", import.meta.url), "utf8");
  assert.match(workspaceSource, /Contenido de trabajo/);
  assert.doesNotMatch(workspaceSource, /role="tablist"/);
  const {getTaskContentPresentation}=await import('../../frontend/src/features/render-os/utils/task-content-presentation.js');
  assert.equal(getTaskContentPresentation({tipo_tarea:'edicion'}).placeholder,'Escribí el guion, copy o las indicaciones acá…');
  assert.equal(getTaskContentPresentation({tipo_tarea:'desarrollo'}).placeholder,'Describí qué hay que resolver, cómo comprobarlo y qué se entrega…');
  assert.match(workspaceSource, /getTaskContentPresentation\(task\)/);
  assert.match(workspaceSource, /placeholder=\{presentation.placeholder\}/);
  assert.match(workspaceSource, /setDraft\(\{ \.\.\.draft, aclaraciones: event.target.value \}\)/);
  assert.match(workspaceSource, /getCanonicalTaskContentMetadata/);
  assert.match(workspaceSource, /getUnifiedTaskContent\(task\)/);
  assert.match(workspaceSource, /Guardá antes de cerrar la tarea/);
  assert.match(workspaceSource, /ros-task-document-properties/);
  assert.doesNotMatch(workspaceSource, /ros-activity-history/);
  assert.doesNotMatch(workspaceSource, /Ver historial/);
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
  assert.match(workspaceStyles, /grid-template-columns:1fr 1fr 1\.12fr \.96fr \.72fr auto/);
  assert.match(workspaceStyles, /\.ros-controls-meta>span\{[^}]*font-weight:500/);
});

test("el frontend no fabrica sesiones y usa el runtime browser; adaptador bearer conserva su contrato externo", () => {
  const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../../frontend/src/main.jsx", import.meta.url), "utf8");
  const transportSource = readFileSync(new URL("../../frontend/src/shared/session/api-fetch.js", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /getSesionDelPath/);
  assert.match(mainSource, /const applicationSession = createApplicationSession\(\{ mode: 'browser', fetchImpl: fetchOriginal/);
  assert.match(mainSource, /window.fetch = applicationSession.fetch/);
  assert.match(transportSource, /!headers.has\('Authorization'\)&&captured/);
  assert.match(transportSource, /headers.set\('Authorization',`Bearer \$\{captured.token\}`\)/);
  assert.match(transportSource, /response.status!==401/);
  assert.match(transportSource, /current\?\.token===bound.token&&current.usuario.id===bound.usuario.id/);
});
