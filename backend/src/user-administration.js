import { expectedUserAdministrationVersion, userAdministrationConflict, UserAdministrationInputError } from './user-admin-patch.js';
import { captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

export class UserAdministrationAuthorityError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'UserAdministrationAuthorityError';
    this.status = status;
    this.code = code;
  }
}

function observedActor(actor) {
  if (!Number.isSafeInteger(actor?.id) || actor.id < 1
    || !Number.isSafeInteger(actor?.session_version) || actor.session_version < 1) {
    throw new UserAdministrationAuthorityError(401, 'Volvé a iniciar sesión para verificar tu identidad.', 'USER_ADMIN_SESSION_REVOKED');
  }
  return { id: actor.id, version: actor.session_version };
}

// All database-backed account administration shares this ordering: mutex,
// delegated principals, current actor (held against revocation), then target. Middleware authority
// may have become stale while waiting; never fall back to its cached role.
async function withAccountAuthority(pool, actor, mutate, requireAdmin) {
  const observed = observedActor(actor);
  // Keep the existing {id,version} observation private contract. Capture the
  // opaque delegation from original auth before waiting for a connection.
  const delegation = captureOwnerProfileWriteAuthority(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SELECT pg_advisory_xact_lock(20261019, 1)");
    // Account mutations can update principal rows: avoid SHARE -> UPDATE upgrades.
    await retainCapturedOwnerProfileAuthority(client, delegation, { lockMode: 'update' });
    const current = (await client.query(`SELECT id,rol,activo,session_version,usuario,google_email FROM usuarios WHERE id=$1 ${requireAdmin ? 'FOR SHARE' : 'FOR UPDATE'}`, [observed.id])).rows[0];
    if (!current || current.activo !== true || current.session_version !== observed.version) {
      throw new UserAdministrationAuthorityError(401, 'La sesión fue revocada o el usuario está inactivo.', 'USER_ADMIN_SESSION_REVOKED');
    }
    if (requireAdmin && current.rol !== 'admin') {
      throw new UserAdministrationAuthorityError(403, 'No tenés permiso para administrar usuarios.', 'USER_ADMIN_ROLE_CHANGED');
    }
    const result = await mutate(client,current);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export function withUserAdministration(pool, actor, mutate) {
  return withAccountAuthority(pool,actor,mutate,true);
}

// Self-service rename shares the global alias ordering but never requires or
// grants an administrator role. The actor's active epoch is rechecked on-row.
export function withSelfIdentityChange(pool, actor, mutate) {
  return withAccountAuthority(pool,actor,mutate,false);
}

// Serializes owner-changing operations so concurrent requests cannot remove
// the final active administrator. No inferred identity or name-based grants.
export async function administerUser(pool, id, next, mutate, actor) {
  return withUserAdministration(pool, actor, async client => {
    const { rows } = await client.query("SELECT id,rol,activo,user_admin_version,usuario,google_email FROM usuarios WHERE id=$1 FOR UPDATE", [id]);
    const target = rows[0];
    if (!target) throw new UserAdministrationInputError('Usuario no encontrado.',404,'USER_ADMIN_NOT_FOUND');
    const expected = expectedUserAdministrationVersion(next.expected_revision,Number(id));
    if (target.user_admin_version !== expected) throw userAdministrationConflict();
    const removesOwner = next.delete === true || next.activo === false
      || (next.rol !== undefined && next.rol !== "admin");
    if (target.rol === "admin" && target.activo && removesOwner) {
      const remaining = await client.query("SELECT count(*)::int AS count FROM usuarios WHERE rol='admin' AND activo=TRUE");
      if (remaining.rows[0].count <= 1) {
        const error = new Error("Debe quedar al menos un administrador activo."); error.status = 409; throw error;
      }
    }
    return mutate(client,target);
  });
}
