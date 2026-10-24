const fail = () => Object.assign(new Error('Elegí una persona de Community o un Líder para publicar.'), { status: 400 });

/** Caller owns the transaction and invokes this before locking/updating tasks.
 * This validates a recipient, never the caller's authentication or authority.
 */
export async function assertCurrentPublicationRecipient(db, publisherId) {
  if (!Number.isSafeInteger(publisherId) || publisherId < 1 || publisherId > 2147483647) throw fail();
  const { rows } = await db.query(
    'SELECT id,nombre,rol,activo FROM usuarios WHERE id=$1 FOR SHARE', [publisherId],
  );
  const user = rows[0];
  if (rows.length !== 1 || user.id !== publisherId || user.activo !== true || !['admin', 'community'].includes(user.rol)) throw fail();
  return Object.freeze({ id: user.id, nombre: user.nombre });
}
