const positiveId = value => Number.isSafeInteger(value) && value > 0;

export function canEditTaskCoordination(task, sesion) {
  const user = sesion?.usuario;
  if (!positiveId(user?.id) || !positiveId(task?.id)) return false;
  if (user.rol === 'admin') return true;
  return user.rol === 'produccion' && (task.asignado_a_id === user.id
    || (Array.isArray(task.colaborador_ids) && task.colaborador_ids.some(id => positiveId(id) && id === user.id)));
}

export function coordinateSnapshot(task) {
  const metadata = task?.propiedades_extra === undefined ? {} : task.propiedades_extra;
  const object = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata);
  const horario = object ? metadata.horario : undefined;
  const coordinada = object ? metadata.coordinada : undefined;
  const valid = positiveId(task?.id) && positiveId(task?.revision) && object
    && (horario === undefined || (typeof horario === 'string' && horario.length <= 2000))
    && (coordinada === undefined || typeof coordinada === 'boolean');
  return {
    id: task?.id, revision: task?.revision, updated_at: task?.updated_at,
    horario: typeof horario === 'string' ? horario : undefined,
    coordinada: typeof coordinada === 'boolean' ? coordinada : undefined,
    valid,
  };
}

/** Narrow metadata delta only; the backend merges it with all other metadata. */
export function buildCoordinationPatch(snapshot, draft) {
  if (!snapshot?.valid) throw new Error('El registro histórico no se puede editar con este formulario.');
  if (!draft || (draft.horario !== undefined && (typeof draft.horario !== 'string' || draft.horario.length > 2000))
    || (draft.coordinada !== undefined && typeof draft.coordinada !== 'boolean')) {
    throw new Error('Ingresá un horario de hasta 2000 caracteres y una coordinación válida.');
  }
  const changes = {};
  for (const key of ['horario', 'coordinada']) {
    if (draft[key] === undefined && snapshot[key] !== undefined) throw new Error('No se puede borrar el registro como valor ausente.');
    if (draft[key] !== snapshot[key]) changes[key] = draft[key];
  }
  return changes;
}
