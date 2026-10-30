import { TASK_WORKSPACE_HISTORY_CUTOFF, TASK_COMPLETION_ISO_PATTERN } from '../../shared/task-workspace-history.mjs';

// Explicit read-only scope for the daily workspace. History remains available
// to reporting and direct authorized detail reads; no record is rewritten.
export function workingTaskReadClause(query = {}) {
  if (query.trabajo_pendiente === undefined) return '';
  if (query.trabajo_pendiente !== 'true' || query.workspace !== 'render_os'
    || ['papelera', 'solo_archivadas', 'incluir_archivadas'].some(key => query[key] !== undefined && query[key] !== 'false')) {
    throw Object.assign(new Error('Filtro de tareas de trabajo no válido.'), { status: 400 });
  }
  return ` AND (t.estado IN ('pendiente','en_progreso','en_revision','aprobada')
      OR (t.estado IN ('finalizada','publicada')
        AND t.propiedades_extra->>'finalizada_at' ~ '${TASK_COMPLETION_ISO_PATTERN}'
        AND t.propiedades_extra->>'finalizada_at' >= '${TASK_WORKSPACE_HISTORY_CUTOFF}'))
    AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
    AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`;
}
