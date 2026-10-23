import { lockClientAdministration } from './client-agreement.js';
import { captureClientCreator, lockCurrentClientCreator } from './client-create-authority.js';

export const CLIENT_STRUCTURE_UPSERT_SQL = `INSERT INTO estructura_cliente (cliente_id, dia_semana, tema, horario, cta_fijo, tipo)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (cliente_id, dia_semana) DO UPDATE SET
    tema = EXCLUDED.tema,
    horario = COALESCE(EXCLUDED.horario, estructura_cliente.horario),
    cta_fijo = COALESCE(EXCLUDED.cta_fijo, estructura_cliente.cta_fijo),
    tipo = COALESCE(EXCLUDED.tipo, estructura_cliente.tipo),
    activo = true
  RETURNING *`;

export async function saveClientStructure(pool, auth, body) {
  const captured = captureClientCreator(auth);
  const { cliente_id, dia_semana, tema, horario, cta_fijo, tipo } = body ?? {};
  if (!cliente_id || dia_semana === undefined) {
    throw Object.assign(new Error('Faltan cliente_id o dia_semana.'), { status: 400 });
  }
  const values = Object.freeze([cliente_id, dia_semana, tema || null, horario || null, cta_fijo || null, tipo || null]);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN');
    // Keep the established administration lock order; actor authority remains
    // locked through the structure commit, including waits on the target row.
    await lockClientAdministration(db);
    await lockCurrentClientCreator(db, captured);
    const result = await db.query(CLIENT_STRUCTURE_UPSERT_SQL, values);
    await db.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
