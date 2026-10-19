const identityFields = 'id, usuario, nombre, rol, foto_perfil, activo, session_version';
const denied = (status) => Object.assign(new Error(
  status === 401 ? 'Credenciales de Google inválidas.'
    : status === 409 ? 'La vinculación de acceso cambió. Intenta nuevamente.'
      : 'Acceso no autorizado.',
), { status });

function bounded(value, max) {
  return typeof value === 'string' && value.trim().length > 0
    && Buffer.byteLength(value, 'utf8') <= max && !/\p{Cc}/u.test(value);
}

// The caller validates the password login input and checks the returned hash,
// active status and current session identity. Notification routing is not identity.
export async function findPasswordLoginIdentity(pool, identifier) {
  const result = await pool.query(
    `SELECT ${identityFields}, password_hash FROM usuarios
     WHERE lower(usuario) = lower($1) OR lower(google_email) = lower($1)
     LIMIT 2`,
    [identifier],
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

// Claims must already have passed the actual provider's token verification.
export async function resolveGoogleLoginIdentity(pool, payload) {
  if (!payload || payload.email_verified !== true
    || !bounded(payload.sub, 255) || !bounded(payload.email, 320)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(payload.email)) throw denied(401);

  const { sub, email } = payload;
  const subject = await pool.query(
    `SELECT ${identityFields} FROM usuarios WHERE google_id = $1 LIMIT 2`, [sub],
  );
  if (subject.rows.length > 1) throw denied(403);
  if (subject.rows.length === 1) {
    if (subject.rows[0].activo !== true) throw denied(403);
    return subject.rows[0];
  }

  const configured = await pool.query(
    `SELECT ${identityFields}, google_id FROM usuarios
     WHERE lower(google_email) = lower($1) LIMIT 2`, [email],
  );
  if (configured.rows.length !== 1) throw denied(403);
  const selected = configured.rows[0];
  if (selected.activo !== true || (selected.google_id != null && selected.google_id !== sub)) {
    throw denied(403);
  }

  try {
    const linked = await pool.query(
      `UPDATE usuarios SET google_id = $1
       WHERE id = $2 AND lower(google_email) = lower($3)
         AND session_version = $4 AND activo = TRUE
         AND (google_id IS NULL OR google_id = $1)
       RETURNING ${identityFields}`,
      [sub, selected.id, email, selected.session_version],
    );
    if (linked.rows.length !== 1) throw denied(409);
    return linked.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw denied(409);
    throw error;
  }
}
