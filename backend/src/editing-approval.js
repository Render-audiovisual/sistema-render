const fail = (message, status) => Object.assign(new Error(message), { status });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positive = value => Number.isSafeInteger(value) && value > 0;

export function normalizeExpectedEditingDelivery(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('expected_entrega_id debe ser un UUID válido.', 400);
  return value.toLowerCase();
}

/** Caller owns the transaction and invokes this BEFORE any task UPDATE/lock. */
export async function assertCurrentEditingApprover(db, auth) {
  if (!positive(auth?.id) || auth.id > 2147483647 || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
  const user = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [auth.id])).rows[0];
  if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
  if (user.rol !== 'admin') throw fail('Solo administración puede aprobar una entrega.', 403);
  return { id: user.id, rol: user.rol, activo: true, session_version: user.session_version };
}

/** AFTER the caller's task UPDATE/CAS, while that task row remains locked.
 * Read deliveries regardless of the updated scope: changing sector/workspace
 * cannot turn an existing artifact history into a legacy approval bypass.
 * No writes or new task/goal/visit/advisory locks belong in this helper.
 */
export async function assertEditingApprovalDelivery(db, task, expectedID) {
  const expected = normalizeExpectedEditingDelivery(expectedID);
  if (!positive(task?.id) || task.id > 2147483647 || !positive(task.revision)) throw fail('La tarea aprobada no tiene una revisión válida.', 409);
  const latest = (await db.query(`SELECT id,task_id,task_revision FROM task_editing_deliveries
    WHERE task_id=$1 ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1`, [task.id])).rows[0] ?? null;
  const props = task.propiedades_extra;
  if (task.estado !== 'aprobada' || !props || typeof props !== 'object' || Array.isArray(props) || props.revision_aprobada !== true) {
    throw fail('La aprobación fue invalidada. Revisá el contenido y volvé a aprobar explícitamente.', 409);
  }
  if (!latest) {
    if (expected !== null || (props.revision_aprobada_entrega_id ?? null) !== null) throw fail('La tarea no tiene la entrega esperada.', 409);
    return null;
  }
  if (task.tipo_tarea !== 'edicion' || props.workspace !== 'render_os'
    || ['archivada_render_os', 'papelera_render_os'].some(key => [true, 'true'].includes(props[key]))) {
    throw fail('La tarea con entregas ya no pertenece al ámbito de edición disponible.', 409);
  }
  if (expected === null || typeof latest.id !== 'string' || !UUID.test(latest.id)
    || latest.id.toLowerCase() !== expected || latest.task_id !== task.id
    || !positive(latest.task_revision) || latest.task_revision >= task.revision
    || props.revision_aprobada_entrega_id !== expected) {
    throw fail('La entrega cambió o no coincide con la aprobación. Actualizá y elegí la versión explícitamente.', 409);
  }
  return expected;
}
