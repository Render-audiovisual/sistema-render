import { lockClientAdministration, lockClientAgreement } from './client-agreement.js';
import { captureClientCreator, lockCurrentClientCreator } from './client-create-authority.js';
const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
const quote = value => `"${String(value).replaceAll('"', '""')}"`;

// Only genuinely empty clients can be removed. Archive/deactivate preserves
// business and financial history. Never infer emptiness from five UI sections.
export async function deleteEmptyClient(pool, rawId, expectedRevision, auth) {
  if (typeof rawId !== 'string' || rawId.trim()!==rawId || !/^[1-9]\d*$/.test(rawId) || Number(rawId) > 2147483647) {
    throw fail('Cliente inválido.', 400, 'CLIENT_INVALID');
  }
  const observed=captureClientCreator(auth),db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await lockClientAdministration(db);
    await lockCurrentClientCreator(db,observed);
    await lockClientAgreement(db, rawId, expectedRevision);
    // FK writers acquire KEY SHARE on the parent. UPDATE lock waits for
    // earlier inserts and prevents later inserts from racing this inspection.
    const current = await db.query('SELECT id,nombre FROM public.clientes WHERE id=$1 FOR UPDATE', [rawId]);
    if (!current.rowCount) throw fail('Cliente no encontrado.', 404, 'CLIENT_NOT_FOUND');
    const references = await db.query(`SELECT ns.nspname AS schema_name, child.relname AS table_name,
      a.attname AS column_name, target.attname AS target_column, cardinality(fk.conkey) AS width
      FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace
      JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1]
      JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1]
      WHERE fk.contype='f' AND fk.confrelid='public.clientes'::regclass
      ORDER BY ns.nspname,child.relname,fk.conname`);
    for (const ref of references.rows) {
      if (ref.schema_name !== 'public' || ref.width !== 1 || ref.target_column !== 'id') {
        throw fail('Este cliente requiere una revisión de sus vínculos. Podés desactivarlo sin borrar su historial.', 409, 'CLIENT_REQUIRES_REVIEW');
      }
      const linked = await db.query(`SELECT EXISTS(SELECT 1 FROM ${quote(ref.schema_name)}.${quote(ref.table_name)} WHERE ${quote(ref.column_name)}=$1) AS has_history`, [rawId]);
      if (linked.rows[0].has_history) {
        throw fail('El cliente tiene historial o registros asociados. Desactivalo para conservarlos.', 409, 'CLIENT_HAS_HISTORY');
      }
    }
    const deleted = await db.query('DELETE FROM public.clientes WHERE id=$1 RETURNING id,nombre', [rawId]);
    await db.query('COMMIT');
    return { ok: true, cliente: deleted.rows[0] };
  } catch (error) {
    await db.query('ROLLBACK').catch(error => { discard=error; });
    if (error.code === '23503') throw fail('El cliente tiene registros asociados. Desactivalo para conservar su historial.', 409, 'CLIENT_HAS_HISTORY');
    throw error;
  } finally { db.release(discard); }
}
