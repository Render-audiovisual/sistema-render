const fail = message => Object.assign(new Error(message), { status: 400 });
const present = (object, key) => Object.hasOwn(object, key) && object[key] !== undefined;
function positiveId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw fail('ID de asignación inválido.');
  return value;
}

/** Write-boundary resolver only. IDs win over supplied (possibly stale) labels.
 * Missing collaborators => hasCollaborators:false; [] => explicit clear.
 * Caller must merge partial updates using existing IDs, never historical labels.
 */
export async function resolveTaskAssignments(db, input = {}, { requireOwner = true } = {}) {
  const ownerById = present(input, 'asignado_a_id');
  const ownerPresent = ownerById || present(input, 'asignado_a');
  const collaboratorsById = present(input, 'colaborador_ids');
  const hasCollaborators = collaboratorsById || present(input, 'colaboradores');
  const owner = ownerById ? positiveId(input.asignado_a_id) : input.asignado_a;
  const collaborators = hasCollaborators
    ? (collaboratorsById ? input.colaborador_ids : input.colaboradores) : [];
  if (!Array.isArray(collaborators)) throw fail('Los colaboradores deben ser una lista.');
  if (requireOwner && !ownerPresent) throw fail('Elegí un responsable.');
  const ids = [], names = [];
  function collect(value, byId) {
    if (byId || typeof value === 'number') ids.push(positiveId(value));
    else {
      if (typeof value !== 'string' || !value.trim()) throw fail('Nombre de asignación inválido.');
      names.push(value.trim());
    }
  }
  if (ownerPresent) collect(owner, ownerById);
  collaborators.forEach(value => collect(value, collaboratorsById));
  const users = ids.length || names.length ? (await db.query(
    'SELECT id, nombre, activo FROM usuarios WHERE id = ANY($1::int[]) OR nombre = ANY($2::text[]) FOR SHARE',
    [[...new Set(ids)], [...new Set(names)]]
  )).rows : [];
  function resolve(value, byId) {
    const matches = users.filter(user => byId || typeof value === 'number'
      ? Number(user.id) === value : user.nombre === value.trim());
    if (matches.length !== 1 || matches[0].activo !== true) {
      throw fail('Asignación desconocida, inactiva o ambigua.');
    }
    return { id: Number(matches[0].id), name: matches[0].nombre };
  }
  const selectedOwner = ownerPresent ? resolve(owner, ownerById) : null;
  const unique = new Map();
  for (const value of collaborators) {
    const user = resolve(value, collaboratorsById);
    // One user has one role per task; owner role takes precedence.
    if (user.id !== selectedOwner?.id) unique.set(user.id, user.name);
  }
  return { ownerId: selectedOwner?.id ?? null, ownerName: selectedOwner?.name ?? null,
    collaboratorIds: [...unique.keys()], collaboratorNames: [...unique.values()], hasCollaborators };
}

/** Full replacement, not a patch. Pass an already merged, resolved assignment.
 * Uses caller's transaction client; never BEGIN/COMMIT here. Does not write labels.
 */
export async function replaceTaskAssignments(db, taskId, assignment) {
  positiveId(taskId);
  const ownerId = assignment.ownerId == null ? null : positiveId(assignment.ownerId);
  if (!Array.isArray(assignment.collaboratorIds)) throw fail('Faltan colaboradores resueltos.');
  const collaborators = [...new Set(assignment.collaboratorIds.map(positiveId))]
    .filter(id => id !== ownerId);
  const ids = ownerId === null ? collaborators : [ownerId, ...collaborators];
  const types = ids.map(id => id === ownerId ? 'responsable' : 'colaborador');
  await db.query('DELETE FROM tarea_asignaciones WHERE tarea_id = $1', [taskId]);
  if (ids.length) await db.query(`INSERT INTO tarea_asignaciones (tarea_id, usuario_id, tipo)
    SELECT $1, usuario_id, tipo FROM unnest($2::int[], $3::text[]) AS assignments(usuario_id, tipo)`,
  [taskId, ids, types]);
}

/** One batch query, no name lookup/backfill. Returns copies preserving display fields. */
export async function annotateTaskAssignments(db, rows) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(row => positiveId(Number(row.id))))];
  const assignments = (await db.query(`SELECT tarea_id, usuario_id, tipo FROM tarea_asignaciones
    WHERE tarea_id = ANY($1::int[]) ORDER BY tarea_id, usuario_id`, [ids])).rows;
  const byTask = new Map();
  for (const assignment of assignments) {
    const id = Number(assignment.tarea_id);
    if (!byTask.has(id)) byTask.set(id, { asignado_a_id: null, colaborador_ids: [] });
    const value = byTask.get(id);
    if (assignment.tipo === 'responsable') value.asignado_a_id = Number(assignment.usuario_id);
    else if (assignment.tipo === 'colaborador') value.colaborador_ids.push(Number(assignment.usuario_id));
  }
  return rows.map(row => {
    const value = byTask.get(Number(row.id));
    return { ...row, asignado_a_id: value?.asignado_a_id ?? null,
      colaborador_ids: [...(value?.colaborador_ids ?? [])] };
  });
}
