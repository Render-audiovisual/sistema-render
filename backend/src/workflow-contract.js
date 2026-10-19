import { isProductionVisitTask } from './production-visits.js';

/**
 * Principal task vocabulary. Historical aliases apply only to task reads/input.
 * Task approval, task finalization and actual editorial publication are distinct.
 * Existing writers may keep storing task `publicada` until their migration.
 */
export const TASK_STATES = Object.freeze({
  PENDING: "pendiente",
  IN_PROGRESS: "en_progreso",
  IN_REVIEW: "en_revision",
  APPROVED: "aprobada",
  FINALIZED: "finalizada",
});

export const EDITORIAL_STATES = Object.freeze({
  READY: "lista",
  PUBLISHED: "publicada",
});

// Domain-specific: never apply task aliases to editorial records.
export const LEGACY_TASK_STATE_ALIASES = Object.freeze({ publicada: TASK_STATES.FINALIZED });
export const LEGACY_TASK_FINALIZED_STATE = "publicada";

export function normalizeTaskState(state) {
  return Object.hasOwn(LEGACY_TASK_STATE_ALIASES, state)
    ? LEGACY_TASK_STATE_ALIASES[state]
    : state;
}

export function isTaskFinalized(task = {}) {
  return normalizeTaskState(task.estado) === TASK_STATES.FINALIZED;
}

export function isTaskApproved(task = {}) {
  return task.estado === TASK_STATES.APPROVED
    || (task.estado === TASK_STATES.IN_REVIEW && task.propiedades_extra?.revision_aprobada === true);
}

export function taskTransitionError(task, requested, auth) {
  const next = normalizeTaskState(requested);
  const previous = normalizeTaskState(task.estado);
  if (!Object.values(TASK_STATES).includes(next)) return { status: 400, error: 'Estado de trabajo inválido.' };
  if (next === previous) return null;
  if (next === TASK_STATES.APPROVED) {
    if (auth.rol !== 'admin') return { status: 403, error: 'Solo un administrador puede aprobar el trabajo.' };
    if (previous !== TASK_STATES.IN_REVIEW) return { status: 409, error: 'Enviá el trabajo a revisión antes de aprobarlo.' };
  }
  if (next === TASK_STATES.FINALIZED) {
    const production = isProductionVisitTask(task);
    if (!['admin', 'community'].includes(auth.rol) && !(production && auth.rol === 'produccion')) {
      return { status: 403, error: 'No tenés permiso para finalizar esta tarea.' };
    }
    if (!production && previous !== TASK_STATES.APPROVED) return { status: 409, error: 'El trabajo necesita aprobación antes de finalizarse.' };
  }
  if (previous === TASK_STATES.FINALIZED && !['admin', 'community'].includes(auth.rol)
    && !(isProductionVisitTask(task) && auth.rol === 'produccion')) {
    return { status: 403, error: 'No tenés permiso para reabrir esta tarea.' };
  }
  return null;
}

export function isPieceActuallyPublished(piece = {}) {
  return piece.estado === EDITORIAL_STATES.PUBLISHED;
}

/**
 * Compatibility policy: confirmed piece publication may finalize approved auto
 * tasks, but cannot substitute for review approval. Link/workspace checks belong
 * to the linking query. Finalized tasks must not have their timestamps rewritten.
 */
export function canFinalizeTaskOnPiecePublication(task = {}, piece = {}) {
  return isPieceActuallyPublished(piece) && isTaskApproved(task) && !isTaskFinalized(task);
}
