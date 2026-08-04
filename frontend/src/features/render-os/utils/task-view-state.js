export function getTasksEmptyMessage({ hasFilters, query, totalTasks, archiveMode }) {
  if (query.trim() || hasFilters) return "No hay tareas con estos filtros.";
  if (archiveMode === "archived") return "No hay tareas archivadas.";
  if (totalTasks === 0) return "No hay tareas todavía.";
  return "No hay tareas activas.";
}
