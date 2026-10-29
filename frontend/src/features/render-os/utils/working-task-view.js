import { WORKING_BOARD_COLUMNS } from '../constants.js';
import { getTaskViewState } from './task-view-state.js';

export function getWorkingTaskViewState(search = '') {
  const state = getTaskViewState(search);
  return { ...state, archiveMode: 'active',
    status: ['finalizada', 'publicada'].includes(state.status) ? 'all' : state.status,
    boardColumn: WORKING_BOARD_COLUMNS.some(column => column.id === state.boardColumn) ? state.boardColumn : 'pendiente' };
}

export function isWorkingTask(task) {
  const flags = task?.propiedades_extra;
  return ['pendiente', 'en_progreso', 'en_revision', 'aprobada'].includes(task?.estado)
    && ![true, 'true'].includes(flags?.archivada_render_os)
    && ![true, 'true'].includes(flags?.papelera_render_os);
}
