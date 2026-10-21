const denied = (status, code) => Object.assign(new Error(status === 401
  ? 'La sesión ya no está autorizada. Volvé a iniciar sesión.'
  : 'Solo administración puede gestionar clientes.'), { status, code });
const sessionInvalid = () => denied(401, 'CLIENT_CREATOR_SESSION_INVALID');

// Reused by client creation and identity-only client edits; export names remain
// stable. Call synchronously with req.auth BEFORE awaiting a pool lease. Cached names,
// roles, mutable request objects and caller-supplied fields confer no authority.
export function captureClientCreator(auth) {
  const id = auth?.id, session_version = auth?.session_version;
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647
    || !Number.isSafeInteger(session_version) || session_version < 1 || session_version > 2147483647) {
    throw sessionInvalid();
  }
  return Object.freeze({ id, session_version });
}

// Caller order: BEGIN -> lockClientAdministration (advisory 8142,1) -> this
// actor SHARE lock -> domain locks/DML -> COMMIT. The scheduler uses that same
// order; holding a user while waiting for its mutex can create a lock cycle.
// Caller owns transaction cleanup/release. Revalidate after the mutex wait and
// keep actor SHARE through the whole client/configuration/fee commit.
// This helper acquires no advisory or domain locks itself.
export async function lockCurrentClientCreator(db, captured) {
  const { id, session_version } = captureClientCreator(captured);
  const current = (await db.query(
    'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [id],
  )).rows[0];
  if (!current || current.id !== id || current.activo !== true || current.session_version !== session_version) {
    throw sessionInvalid();
  }
  if (current.rol !== 'admin') throw denied(403, 'CLIENT_CREATOR_FORBIDDEN');
  // Explicit projection: no raw user record, credentials, body labels or cached
  // aliases can accidentally become audit data or escape via a rejection.
  return Object.freeze({ id: current.id, rol: current.rol, activo: true, session_version: current.session_version,
    nombre: typeof current.nombre === 'string' ? current.nombre : null,
    usuario: typeof current.usuario === 'string' ? current.usuario : null });
}
