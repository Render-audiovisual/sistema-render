/**
 * Additive phase-1 vocabulary, not a storage migration or an authorization layer.
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
    || task.propiedades_extra?.revision_aprobada === true;
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
