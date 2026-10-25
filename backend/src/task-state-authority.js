const denied = () => Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión antes de actualizar la tarea.'), { status: 401 });
const positive = value => Number.isSafeInteger(value) && value > 0;

/** Caller owns the transaction. Hold the verified actor before any domain lock
 * so revocation either precedes this write or waits for its valid COMMIT.
 * This is identity continuity, not a replacement for task role/ID permissions.
 */
export async function assertCurrentTaskWriteActor(db, captured) {
  const id = captured?.id, version = captured?.session_version, role = captured?.rol;
  if (!positive(id) || id > 2147483647 || !positive(version) || typeof role !== 'string' || !role) throw denied();
  const row = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (!row || row.id !== id || row.activo !== true || row.session_version !== version || row.rol !== role) throw denied();
  return { id:row.id, rol:row.rol, activo:true, session_version:row.session_version };
}

// Compatibility for existing state-only callers; one identity implementation.
export const assertCurrentTaskStateActor = assertCurrentTaskWriteActor;
