export function getTasksEmptyMessage({ hasFilters, query, totalTasks, archiveMode }) {
  if (query.trim() || hasFilters) return "No hay tareas con estos filtros.";
  if (archiveMode === "trash") return "La Papelera está vacía.";
  if (totalTasks === 0) return "No hay tareas todavía.";
  return "No hay tareas activas.";
}

const VALID_VIEWS = new Set(["board", "list", "calendar", "clients", "responsibles"]);
const VALID_ARCHIVE_MODES = new Set(["active", "trash"]);
const VALID_TASK_STATES = new Set(['pendiente','en_progreso','en_revision','aprobada','finalizada']);
export function effectiveTaskFilterState(task) {
  if (task?.estado === 'publicada') return 'finalizada';
  return task?.estado === 'en_revision' && task.propiedades_extra?.revision_aprobada === true ? 'aprobada' : task?.estado;
}
export function taskQueryNotice({ status = 'all', reviewScope = '', archiveMode = 'active', sort = 'date' }, role) {
  if (status !== 'all' && !VALID_TASK_STATES.has(status)) return 'El filtro de estado no es válido. Elegí un estado o limpiá los filtros.';
  if (typeof reviewScope !== 'string' || reviewScope && !['personal','team'].includes(reviewScope)) return 'El alcance de revisión no es válido. Salí de la cola para continuar.';
  if (reviewScope === 'team' && role !== undefined && role !== 'admin') return 'La revisión del equipo está reservada a administración. Salí de esta cola para consultar tus tareas.';
  if (reviewScope && (status !== 'en_revision' || archiveMode !== 'active' || sort !== 'date')) return 'La cola de revisión requiere tareas activas, estado en revisión y orden por fecha. Salí de la cola o corregí los filtros.';
  return '';
}
export function taskMatchesReviewScope(task, scope, user) {
  if (!scope) return true;
  if (effectiveTaskFilterState(task) !== 'en_revision' || !Number.isSafeInteger(user?.id) || user.id < 1 || user.id > 2147483647) return false;
  if (scope === 'team') return user.rol === 'admin';
  return scope === 'personal' && (task.asignado_a_id === user.id || (Array.isArray(task.colaborador_ids) && task.colaborador_ids.includes(user.id)));
}

export function getTaskViewState(search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const archiveMode = params.get("mode");
  const calendarMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "") ? params.get("month") : "";
  const reviewScope = params.getAll('review_scope').length > 1 ? 'invalid:duplicate' : params.has('review_scope') ? params.get('review_scope') || 'invalid:empty' : '';
  const status = params.getAll('estado').length > 1 ? 'invalid:duplicate' : params.get('estado') ?? (reviewScope ? 'en_revision' : 'all');
  return {
    view: VALID_VIEWS.has(view) ? view : "board",
    status, reviewScope,
    sort: params.getAll("sort").length === 1 && params.get("sort") === "manual" ? "manual" : "date",
    archiveMode: VALID_ARCHIVE_MODES.has(archiveMode) ? archiveMode : "active",
    responsible: params.getAll("responsible").length > 1 ? "invalid:duplicate" : params.get("responsible") || "all",
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
    estado: !state.status || state.status === 'all' ? null : state.status,
    review_scope: state.reviewScope || null,
    sort: state.sort === "manual" ? "manual" : null,
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
