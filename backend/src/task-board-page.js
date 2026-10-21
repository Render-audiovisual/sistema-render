import { createHash } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const snapshotPattern = /^[0-9a-f]{64}$/;

export function parseTaskOrderRead(query = {}) {
  const sort = query.sort === undefined ? 'date' : query.sort;
  if (!['date', 'manual'].includes(sort) || typeof sort !== 'string') throw fail(400, 'Orden de tareas no válido.');
  if (sort === 'manual' && query.workspace !== 'render_os') throw fail(400, 'El orden manual corresponde al tablero compartido.');
  const snapshot = query.expected_snapshot;
  if (snapshot !== undefined && (sort !== 'manual' || typeof snapshot !== 'string' || snapshot.length !== 64 || !snapshotPattern.test(snapshot)))
    throw fail(400, 'La versión del listado no es válida. Volvé a cargar las tareas.');
  return { sort, snapshot };
}

// One SQL snapshot for version, filtered membership, page and assignment DTOs.
// This is read-only observation, not a row lock held against account revocation.
export async function readTaskBoardPage({ pool, query, params, limit, offset, expectedSnapshot, auth, serialize }) {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth.rol !== 'string') throw fail(401, 'Volvé a iniciar sesión.');
  if (offset > 0 && expectedSnapshot === undefined) throw fail(400, 'Volvé a cargar la primera página antes de continuar el orden manual.');
  const db = await pool.connect(); let releaseError;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
    if (!actor || actor.id !== auth.id || actor.activo !== true || actor.session_version !== auth.session_version || actor.rol !== auth.rol)
      throw fail(401, 'La sesión cambió. Volvé a verificar el acceso.');
    const order = (await db.query("SELECT revision::text,task_ids FROM task_board_order WHERE scope='render_os'")).rows[0];
    if (!order || typeof order.revision !== 'string' || !/^[1-9][0-9]{0,18}$/.test(order.revision) || /[\r\n]/.test(order.revision)
      || order.revision.length > 19 || BigInt(order.revision) > 9223372036854775807n
      || !Array.isArray(order.task_ids) || order.task_ids.length > 100000 || order.task_ids.some(id => !positive(id))
      || new Set(order.task_ids).size !== order.task_ids.length) throw new Error('Invalid shared task order observation');
    const summary = (await db.query(`SELECT COUNT(*)::int AS total,
      COALESCE(json_agg(json_build_array(id,revision,
        (SELECT COALESCE(json_agg(json_build_array(ta.usuario_id,ta.tipo) ORDER BY ta.usuario_id,ta.tipo)::text,'[]')
          FROM tarea_asignaciones ta WHERE ta.tarea_id=candidates.id)) ORDER BY id)::text,'[]') AS signature
      FROM (${query}) AS candidates`, params)).rows[0];
    if (!Number.isSafeInteger(summary?.total) || summary.total < 0 || typeof summary.signature !== 'string') throw new Error('Invalid task collection summary');
    // Only IDs/revisions/membership/order enter this opaque token. Never hash
    // private task metadata or serialized financial values into a public oracle.
    const snapshot = createHash('sha256').update(JSON.stringify({ actor: actor.id, role: actor.rol,
      session_version: actor.session_version, revision: order.revision, ids: order.task_ids, signature: summary.signature })).digest('hex');
    if (expectedSnapshot !== undefined && snapshot !== expectedSnapshot) throw fail(409, 'El listado cambió. Actualizá las tareas antes de seguir cargando.');
    const index = params.length + 1;
    // Expand the ordering vector once. array_position for every candidate would
    // repeatedly scan the whole vector on a large shared board.
    const result = await db.query(`WITH order_positions AS (
      SELECT task_id,position FROM unnest($${index}::integer[]) WITH ORDINALITY AS p(task_id,position)
    ), candidates AS (${query}) SELECT candidates.* FROM candidates
      LEFT JOIN order_positions p ON p.task_id=candidates.id
      ORDER BY p.position ASC NULLS LAST,candidates.fecha_vencimiento ASC NULLS LAST,candidates.id DESC
      LIMIT $${index + 1} OFFSET $${index + 2}`,
    [...params, order.task_ids, limit, offset]);
    const items = await serialize(db, result.rows.map(({ total_count, ...row }) => row));
    if (!Array.isArray(items) || items.length > limit) throw new Error('Invalid task page projection');
    await db.query('COMMIT');
    return { items, total: summary.total, orderRevision: order.revision, snapshot };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { releaseError = rollback; }
    throw error;
  } finally { db.release(releaseError); }
}
