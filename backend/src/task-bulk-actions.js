import { assertCurrentTaskWriteActor } from './task-state-authority.js';
import { buildTaskAccessClause, getTaskActor } from './task-access.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const denied = () => fail('Solo podés eliminar o restaurar tareas propias o donde colaborás.', 403);

export async function applyTaskBulkAction(pool, { auth, ids, action }) {
  // Capture identity and intent before acquiring a connection. Never reuse a
  // mutable request object after a concurrent authorization change.
  const captured = Object.freeze({ id: auth?.id, rol: auth?.rol, session_version: auth?.session_version });
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 250 ||
      ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length ||
      !['papelera', 'restaurar'].includes(action)) throw fail('Acción masiva inválida.', 400);
  const selected = Object.freeze([...ids].sort((a, b) => a - b));
  const db = await pool.connect();
  let transaction = false, discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED'); transaction = true;
    const actor = await assertCurrentTaskWriteActor(db, captured);
    // All membership writers lock their task first. Lock rows in stable order,
    // then authorize using a fresh READ COMMITTED statement after any wait.
    const locked = await db.query(`SELECT id FROM tareas WHERE id = ANY($1::bigint[])
      ORDER BY id FOR UPDATE`, [selected]);
    if (locked.rowCount !== selected.length) throw denied();
    const access = buildTaskAccessClause(actor, 't', '$2');
    const params = [selected];
    if (access.value) params.push(access.value);
    const allowed = await db.query(`SELECT t.id FROM tareas t WHERE t.id = ANY($1::bigint[])
      AND t.propiedades_extra->>'workspace' = 'render_os'${access.sql}`, params);
    if (allowed.rowCount !== selected.length) throw denied();
    const identity = (await db.query('SELECT nombre,usuario FROM usuarios WHERE id=$1', [actor.id])).rows[0];
    const label = getTaskActor(identity) || 'Equipo RENDER';
    const timestamp = new Date().toISOString();
    const metadata = action === 'papelera'
      ? { archivada_render_os: true, papelera_render_os: true, papelera_por: label, papelera_at: timestamp }
      : { archivada_render_os: false, papelera_render_os: false, restaurada_por: label, restaurada_at: timestamp };
    const result = await db.query(`UPDATE tareas SET propiedades_extra = propiedades_extra || $2::jsonb,
      updated_at = now() WHERE id = ANY($1::bigint[] ) RETURNING id`, [selected, JSON.stringify(metadata)]);
    if (result.rowCount !== selected.length) throw denied();
    await db.query('COMMIT'); transaction = false;
    return { ok: true, accion: action, ids: result.rows.map(row => Number(row.id)), cantidad: result.rowCount };
  } catch (error) {
    if (transaction) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    }
    throw error;
  } finally { db.release(discard); }
}
