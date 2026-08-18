export function getTasksEmptyMessage({ hasFilters, query, totalTasks, archiveMode }) {
  if (query.trim() || hasFilters) return "No hay tareas con estos filtros.";
  if (archiveMode === "archived") return "No hay tareas archivadas.";
  if (archiveMode === "trash") return "La Papelera está vacía.";
  if (totalTasks === 0) return "No hay tareas todavía.";
  return "No hay tareas activas.";
}

const VALID_VIEWS = new Set(["board", "list", "calendar", "clients"]);
const VALID_ARCHIVE_MODES = new Set(["active", "archived", "trash"]);

export function getTaskViewState(search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const archiveMode = params.get("mode");
  const calendarMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "") ? params.get("month") : "";
  return {
    view: VALID_VIEWS.has(view) ? view : "board",
    archiveMode: VALID_ARCHIVE_MODES.has(archiveMode) ? archiveMode : "active",
    responsible: params.get("responsible") || "all",
    client: params.get("client") || "all",
    sector: params.get("sector") || "all",
    priority: params.get("priority") || "all",
    area: params.get("area") || "all",
    query: params.get("q") || "",
    calendarMonth,
  };
}

export function updateTaskViewUrl(currentUrl, state) {
  const url = new URL(currentUrl);
  const values = {
    view: state.view === "board" ? null : state.view,
    mode: state.archiveMode === "active" ? null : state.archiveMode,
    responsible: state.responsible === "all" ? null : state.responsible,
    client: state.client === "all" ? null : state.client,
    sector: state.sector === "all" ? null : state.sector,
    priority: state.priority === "all" ? null : state.priority,
    area: state.area === "all" ? null : state.area,
    q: state.query?.trim() ? state.query : null,
    month: state.calendarMonth || null,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });
  return url;
}

export function isNewTaskDraftDirty(draft) {
  return Boolean(
    draft.titulo?.trim()
    || draft.asignado_a
    || draft.cliente_id
    || draft.tipo_tarea
    || draft.subtipo?.trim()
    || draft.fecha_vencimiento
    || draft.resumen?.trim()
    || draft.aclaraciones?.trim()
    || draft.material_referencia?.trim()
    || draft.etiquetas?.trim()
    || draft.colaboradores?.length,
  );
}
