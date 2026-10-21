import { buildTaskAccessClause } from './task-access.js';

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const error = (status, message) => Object.assign(new Error(message), { status });
const unavailable = () => error(404, 'Tarea o referencia no disponible.');
export function moodboardTaskId(value) {
  if (typeof value === 'string') {
    const matched = /^[1-9][0-9]*$/.exec(value);
    if (!matched || matched[0] !== value) throw error(400, 'Identificador no válido.');
    value = Number(value);
  }
  if (!positive(value)) throw error(400, 'Identificador no válido.');
  return value;
}

// Match canonical task reads: exact render_os is shared; every other marker
// (including NULL) is historical and requires the existing ID-membership ACL.
// Shared board visibility is not authority to read another person's history.
export function buildMoodboardTaskReadPredicate(auth, alias = 't', placeholder = '$2') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias) || !/^\$[1-9][0-9]*$/.test(placeholder)
    || /[\r\n]/.test(alias + placeholder)) throw new TypeError('Invalid internal task SQL binding.');
  if (!positive(auth?.id) || auth.activo === false) return { sql: 'FALSE', value: null };
  const historical = buildTaskAccessClause(auth, alias, placeholder);
  if (auth.rol === 'admin') return { sql: 'TRUE', value: null };
  return {
    sql: `(${alias}.propiedades_extra->>'workspace' = 'render_os'
      OR (${alias}.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'${historical.sql}))`,
    value: historical.value,
  };
}

// Link/unlink modifies only the relation. Hold current authority and the same
// reference -> task -> board/client membership boundary through COMMIT.
export async function mutateMoodboardTaskLink(pool, auth, referenceId, taskId, { remove = false } = {}) {
  referenceId = moodboardTaskId(referenceId); taskId = moodboardTaskId(taskId);
  if (typeof remove !== 'boolean') throw new TypeError('Invalid link operation.');
  const id = auth?.id, version = auth?.session_version;
  if (!positive(id) || !positive(version)) throw error(401, 'La sesión ya no está vigente.');
  const db = await pool.connect();
  let releaseError;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const current = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [id])).rows[0];
    if (!current || current.id !== id || current.activo !== true || current.session_version !== version)
      throw error(401, 'La sesión ya no está vigente.');
    const reference = (await db.query('SELECT id,board_id FROM moodboard_references WHERE id=$1 FOR SHARE', [referenceId])).rows[0];
    if (!reference) throw unavailable();
    const task = (await db.query('SELECT t.id,t.cliente_id FROM tareas t WHERE t.id=$1 FOR SHARE OF t', [taskId])).rows[0];
    if (!task) throw unavailable();
    const membership = await db.query(`SELECT board_id,cliente_id FROM moodboard_board_clients
      WHERE board_id=$1 AND cliente_id=$2 FOR SHARE`, [reference.board_id, task.cliente_id]);
    if (!membership.rows.length) throw unavailable();
    const predicate = buildMoodboardTaskReadPredicate(current, 't', '$2');
    const allowed = await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1 AND ${predicate.sql}`,
      predicate.value === null ? [taskId] : [taskId, predicate.value]);
    if (!allowed.rows.length) throw unavailable();
    if (remove) await db.query('DELETE FROM moodboard_reference_tasks WHERE reference_id=$1 AND tarea_id=$2', [referenceId, taskId]);
    else await db.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [referenceId, taskId]);
    await db.query('COMMIT');
    return { ok: true };
  } catch (failure) {
    try { await db.query('ROLLBACK'); } catch (rollback) { releaseError = rollback; }
    throw failure;
  } finally { db.release(releaseError); }
}
