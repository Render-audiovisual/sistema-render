import { assertCurrentTaskWriteActor } from './task-state-authority.js';

const failure = (message, status) => Object.assign(new Error(message), { status });

// Compatibility endpoint only: the canonical UI uses recoverable trash.
// Retain current server authority through COMMIT, just like other task writers.
export async function deleteLegacyTask(pool, { auth, id, renderOs = false }) {
  const captured = Object.freeze({ id:auth?.id, rol:auth?.rol, session_version:auth?.session_version });
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || typeof renderOs !== 'boolean')
    throw failure('Identificador de tarea inválido.', 400);
  const db = await pool.connect();
  let transaction = false, discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED'); transaction = true;
    const actor = await assertCurrentTaskWriteActor(db, captured);
    if (actor.rol !== 'admin') throw failure('Esta acción requiere administración.', 403);
    const result = await db.query(`DELETE FROM tareas
      WHERE id=$1${renderOs ? " AND propiedades_extra->>'workspace' = 'render_os'" : ''}
      RETURNING id`, [id]);
    if (!result.rows.length) throw failure('Tarea no encontrada.', 404);
    await db.query('COMMIT'); transaction = false;
    return { ok:true };
  } catch (error) {
    if (transaction) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    }
    throw error;
  } finally { db.release(discard); }
}
