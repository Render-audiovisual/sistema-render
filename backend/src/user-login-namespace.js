import { UserAdministrationInputError } from './user-admin-patch.js';

// Invoke only inside the shared account-authority transaction, before writing.
// Use the resolver's exact SQL LOWER semantics, not a second JS normalization.
// Grandfather unchanged historical aliases; never choose an owner for ambiguity.
export async function assertUserLoginIdentifierAvailable(db, { id = null, next, previous = null }) {
  if (next === null) return;
  if (typeof next !== 'string' || !next || (id !== null && (!Number.isSafeInteger(id) || id < 1))) {
    throw new UserAdministrationInputError('Los datos de acceso no son válidos.');
  }
  const conflict = await db.query(`SELECT id FROM usuarios
    WHERE ($1::integer IS NULL OR id<>$1)
      AND lower($2::text) IS DISTINCT FROM lower($3::text)
      AND (lower(usuario)=lower($2::text) OR lower(google_email)=lower($2::text))
    LIMIT 1`, [id, next, previous]);
  if (conflict.rows.length) {
    throw new UserAdministrationInputError('Ese usuario o email de acceso no está disponible. Elegí otro.',409,'LOGIN_IDENTIFIER_UNAVAILABLE');
  }
}
