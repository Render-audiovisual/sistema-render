const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const invalid = () => { throw new Error('No pudimos verificar las subtareas de esta tarea. Volvé a consultarlas.'); };

export function requireTaskSubtaskParentId(id) {
  if (!positiveId(id)) invalid();
  return id;
}

// Verify the complete response before publishing any row into the shared task
// collection. No coercion, filtering or rewriting of historical text/states.
export function verifyTaskSubtasks(items, parentId) {
  requireTaskSubtaskParentId(parentId);
  if (!Array.isArray(items)) invalid();
  const seen = new Set();
  for (const row of items) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !positiveId(row.id) || row.id === parentId || seen.has(row.id)
      || !positiveId(row.revision) || row.tarea_padre_id !== parentId
      || typeof row.titulo !== 'string' || typeof row.estado !== 'string') invalid();
    seen.add(row.id);
  }
  return items;
}
