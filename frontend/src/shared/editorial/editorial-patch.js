const refreshMessage = 'La versión de la pieza no es válida. Recargá la lista antes de guardar.';

export function editorialRevision(row) {
  const revision = row?.publicacion_evidencia?.revision;
  if (!Number.isSafeInteger(row?.id) || row.id <= 0 || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(refreshMessage);
  }
  return revision;
}

// Capture the observation before entering a write queue. Never look up a newer
// revision at dispatch time or substitute zero for absent evidence.
export function editorialPatchBody(row, fields) {
  if (fields?.estado === 'publicada') throw new Error('Usá la confirmación explícita de publicación.');
  return JSON.stringify({ ...fields, expected_revision: editorialRevision(row) });
}

export function editorialPatchAck(row, saved) {
  if (saved?.id !== row?.id || editorialRevision(saved) <= editorialRevision(row)) {
    throw new Error('No se pudo confirmar la versión guardada. Recargá la lista antes de continuar.');
  }
  return saved;
}

// ACKs advance only the server-owned observation, not inputs edited meanwhile.
export function mergeEditorialPatchEvidence(row, saved) {
  if (row.id !== saved.id || editorialRevision(row) > editorialRevision(saved)) return row;
  return { ...row, publicacion_evidencia: saved.publicacion_evidencia };
}

export function editorialPatchError(error) {
  return error?.status === 409
    ? 'La pieza cambió. Tus cambios no se reenviaron. Recargá la lista y revisalos antes de guardar.'
    : error?.message || 'No se pudo confirmar el cambio. Recargá la lista antes de guardar de nuevo.';
}
