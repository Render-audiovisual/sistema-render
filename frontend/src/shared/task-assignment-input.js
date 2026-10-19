function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Only stable IDs belong in the assignment payload; labels are display-only.
export function buildTaskAssignmentInput({ ownerId, collaboratorIds }) {
  if (ownerId !== null && !isPositiveId(ownerId)) {
    throw new TypeError("ownerId must be a positive safe integer or null");
  }
  if (!Array.isArray(collaboratorIds) || !Array.from(collaboratorIds).every(isPositiveId)) {
    throw new TypeError("collaboratorIds must be an array of positive safe integers");
  }
  return { asignado_a_id: ownerId, colaborador_ids: [...collaboratorIds] };
}
