// Vinculación explícita cuenta de Instagram ↔ cliente. La expone la Fase 2
// (solo Líder); la sincronización nunca adivina a qué cliente pertenece una cuenta.

export async function listInstagramAccounts(db) {
  const { rows } = await db.query(`SELECT a.ig_user_id, a.username, a.activa, a.cliente_id,
      c.nombre AS cliente_nombre, a.sincronizada_at,
      (SELECT s.seguidores FROM instagram_cuenta_seguidores s WHERE s.ig_user_id=a.ig_user_id
        ORDER BY s.fecha DESC LIMIT 1) AS seguidores
    FROM instagram_cuentas a LEFT JOIN clientes c ON c.id=a.cliente_id
    ORDER BY a.activa DESC, c.nombre NULLS LAST, a.username`);
  return rows;
}

// clienteId null desvincula. Al cambiar de cliente, los vínculos de piezas de
// esa cuenta vuelven a 'pendiente' para recalcularse con el cliente correcto.
export function validateAccountLink(igUserId, clienteId) {
  if (typeof igUserId !== 'string' || !/^\d{1,32}$/.test(igUserId)) throw Object.assign(new Error('Cuenta inválida'), { status: 400 });
  if (clienteId !== null && !(Number.isSafeInteger(clienteId) && clienteId > 0 && clienteId <= 2147483647))
    throw Object.assign(new Error('Cliente inválido'), { status: 400 });
}

// Dentro de una transacción ya abierta (y autorizada) por quien llama.
export async function linkInstagramAccountInTransaction(db, igUserId, clienteId) {
  validateAccountLink(igUserId, clienteId);
  const account = await db.query('SELECT cliente_id FROM instagram_cuentas WHERE ig_user_id=$1 FOR UPDATE', [igUserId]);
  if (!account.rows.length) throw Object.assign(new Error('Cuenta no encontrada'), { status: 404 });
  if (clienteId !== null) {
    const client = await db.query('SELECT 1 FROM clientes WHERE id=$1', [clienteId]);
    if (!client.rows.length) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
    const taken = await db.query('SELECT 1 FROM instagram_cuentas WHERE cliente_id=$1 AND ig_user_id<>$2', [clienteId, igUserId]);
    if (taken.rows.length) throw Object.assign(new Error('Ese cliente ya tiene una cuenta vinculada'), { status: 409 });
  }
  const changed = account.rows[0].cliente_id !== clienteId;
  if (changed) {
    await db.query('UPDATE instagram_cuentas SET cliente_id=$2 WHERE ig_user_id=$1', [igUserId, clienteId]);
    await db.query(`UPDATE instagram_media SET cliente_id=$2, publicacion_id=NULL, vinculo='pendiente',
      actualizada_at=clock_timestamp() WHERE ig_user_id=$1`, [igUserId, clienteId]);
  }
  return { changed };
}

export async function linkInstagramAccount(pool, igUserId, clienteId) {
  validateAccountLink(igUserId, clienteId);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await linkInstagramAccountInTransaction(db, igUserId, clienteId);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
