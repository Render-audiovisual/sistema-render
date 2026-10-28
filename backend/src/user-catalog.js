import { USER_ADMIN_REVISION_SQL } from './user-admin-patch.js';
import { captureOwnerProfileWriteAuthority, checkCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

export const USER_CATALOG_PUBLIC_SQL = 'SELECT id, usuario, nombre, rol, activo, foto_perfil, created_at FROM usuarios WHERE activo IS TRUE ORDER BY id';
export const USER_CATALOG_ADMIN_SQL = `SELECT id, usuario, nombre, rol, activo, email_notificaciones, google_email, foto_perfil, (whatsapp_id_hash IS NOT NULL AND whatsapp_habilitado IS TRUE) AS whatsapp_vinculado, created_at, ${USER_ADMIN_REVISION_SQL} AS admin_revision FROM usuarios ORDER BY id`;

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const stale = () => Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión.'), { status: 401 });

// Both the authorization decision and selected account fields belong to the same
// database snapshot, not the role observed by middleware before acquiring a lease.
export async function loadUserCatalogSnapshot(pool, auth) {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) throw stale();
  const observed = Object.freeze({ id: auth.id, rol: auth.rol, session_version: auth.session_version });
  const delegation=captureOwnerProfileWriteAuthority(auth);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await checkCapturedOwnerProfileAuthority(db,delegation);
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.rol !== observed.rol || actor.session_version !== observed.session_version) throw stale();
    const result = await db.query(actor.rol === 'admin' ? USER_CATALOG_ADMIN_SQL : USER_CATALOG_PUBLIC_SQL);
    await db.query('COMMIT');
    return result.rows;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
