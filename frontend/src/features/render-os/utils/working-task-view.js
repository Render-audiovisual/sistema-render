import { WORKING_BOARD_COLUMNS } from '../constants.js';
import { getTaskViewState } from './task-view-state.js';
import { hasCurrentWorkspaceCompletion } from '../../../../../shared/task-workspace-history.mjs';

// UI-only identity: never serialized, persisted or used as closure evidence.
const pendingUpdates = new WeakSet();
export function projectPendingTaskUpdate(task, changes) {
  const projected = { ...task, ...changes };
  pendingUpdates.add(projected);
  return projected;
}
export function isTaskUpdatePending(task) { return pendingUpdates.has(task); }

export function getWorkingTaskViewState(search = '') {
  const state = getTaskViewState(search);
  return { ...state, archiveMode: 'active',
    status: state.status,
    boardColumn: WORKING_BOARD_COLUMNS.some(column => column.id === state.boardColumn) ? state.boardColumn : 'pendiente' };
}

export function isWorkingTask(task) {
  const flags = task?.propiedades_extra;
  return (['pendiente', 'en_progreso', 'en_revision', 'aprobada'].includes(task?.estado)
      || ['finalizada', 'publicada'].includes(task?.estado) && (hasCurrentWorkspaceCompletion(task) || isTaskUpdatePending(task)))
    && ![true, 'true'].includes(flags?.archivada_render_os)
    && ![true, 'true'].includes(flags?.papelera_render_os);
}
