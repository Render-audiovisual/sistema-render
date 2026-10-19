import { getUnifiedTaskContent } from '../features/render-os/utils/task-content.js';
import { canonicalTaskState } from '../features/render-os/constants.js';

// Compare editable data only: background revisions and read-only labels are not drafts.
export function isTaskDraftDirty(task, draft) {
  if (!task) return false;
  const fields = ['titulo', 'cliente_id', 'fecha_vencimiento', 'prioridad', 'tipo_tarea', 'subtipo', 'material_referencia'];
  if (fields.some(field => String(draft[field] ?? '') !== String(task[field] ?? ''))) return true;
  if (canonicalTaskState(draft.estado) !== canonicalTaskState(task.estado)) return true;
  if (String(draft.aclaraciones || '').trim() !== getUnifiedTaskContent(task).trim()) return true;
  const metadata = task.propiedades_extra || {};
  if (draft.resumen !== undefined && String(draft.resumen).trim() !== String(metadata.resumen || '').trim()) return true;
  if (draft.etiquetas !== undefined && JSON.stringify(String(draft.etiquetas).split(',').map(tag => tag.trim()).filter(Boolean)) !== JSON.stringify(metadata.etiquetas || [])) return true;
  return draft.produccion_videos_previstos !== undefined
    && Number(draft.produccion_videos_previstos || 0) !== Number(metadata.produccion_videos_previstos || 0);
}

export function keepsTaskOpen(destination, taskId) {
  if (!destination) return false;
  const url = new URL(destination, 'http://render.local');
  return url.pathname === '/workspace/tareas' && url.searchParams.get('task') === String(taskId);
}
