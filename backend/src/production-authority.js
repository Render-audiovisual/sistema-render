const denied = (status, message) => Object.assign(new Error(message), { status });

// Capture the authenticated observation before waiting for a pool slot. Names
// and cached roles never supply authority for a production write.
export async function withProductionAuthority(pool, auth, requireAdmin, mutate) {
  if (typeof requireAdmin !== 'boolean') throw new TypeError('Production authority requires an explicit role policy.');
  const id = auth?.id, version = auth?.session_version;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(version) || version <= 0) {
    throw denied(401, 'Volvé a iniciar sesión para registrar la producción.');
  }
  const db = await pool.connect();
  let releaseError;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Acquire before any visit/task/piece locks; keep revocation ordered after
    // a valid commit, or observe it before permitting any domain side effects.
    const current = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [id])).rows[0];
    if (!current || current.id !== id || current.activo !== true || current.session_version !== version) {
      throw denied(401, 'La sesión cambió. Volvé a iniciar sesión antes de registrar la producción.');
    }
    if (requireAdmin && current.rol !== 'admin') {
      throw denied(403, 'Solo líderes autorizados pueden realizar esta acción de producción.');
    }
    const result = await mutate(db, current);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); }
    catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { db.release(releaseError); }
}
