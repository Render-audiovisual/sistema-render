import { createHash } from 'node:crypto';
import { buildTaskAccessClause } from './task-access.js';
import { normalizeTaskState, TASK_STATES } from './workflow-contract.js';
import { bindCapturedOwnerProfileAuthority, captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

export const TASK_BOARD_ORDER_SCOPE = 'render_os';
export const TASK_BOARD_ORDER_LIMIT = 100000;
export const TASK_BOARD_ELIGIBILITY_SQL = `t.propiedades_extra->>'workspace' = 'render_os'
  AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`;
const MAX_REVISION = 9223372036854775807n;
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const fail = (status, message) => Object.assign(new Error(message), { status });
const invalid = () => fail(400, 'Los datos del movimiento no son válidos.');
const stale = () => fail(409, 'El tablero cambió. Actualizá el orden antes de volver a mover la tarea.');
const unavailable = () => fail(404, 'La tarea o la posición no está disponible.');
const uuid = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function revision(value) {
  if (typeof value !== 'string' || value.length > 19 || !/^[1-9][0-9]*$/.test(value)
    || /[\r\n]/.test(value) || BigInt(value) > MAX_REVISION) throw invalid();
  return value;
}

export function parseTaskBoardOrderInput(body) {
  const fields = ['request_id','task_id','expected_revision','before_id','expected_before_revision','expected_order_revision'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length
    || Object.keys(body).some(key => !fields.includes(key)) || !uuid(body.request_id)
    || !positive(body.task_id) || !positive(body.expected_revision)
    || body.before_id !== null && (!positive(body.before_id) || body.before_id === body.task_id)
    || (body.before_id === null ? body.expected_before_revision !== null : !positive(body.expected_before_revision))) throw invalid();
  return { request_id: body.request_id.toLowerCase(), task_id: body.task_id, expected_revision: body.expected_revision,
    before_id: body.before_id, expected_before_revision: body.expected_before_revision,
    expected_order_revision: revision(body.expected_order_revision) };
}
function intentHash(input) {
  // parseTaskBoardOrderInput produces a closed, stable field order. Exclude the
  // UUID itself: it selects the actor-scoped receipt, not business intent.
  const { request_id: _key, ...intent } = input;
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}
const eligible = task => task?.propiedades_extra?.workspace === TASK_BOARD_ORDER_SCOPE
  && ![true,'true'].includes(task.propiedades_extra.archivada_render_os)
  && ![true,'true'].includes(task.propiedades_extra.papelera_render_os);
function column(task) {
  const state = normalizeTaskState(task.estado);
  return Object.values(TASK_STATES).includes(state) ? state : null;
}

// Eligible rows must already be in canonical due-date ASC NULLS LAST/id DESC
// order. Not ACL-filtered: normalization never discards another person's task.
export function normalizeTaskBoardOrder(stored, eligibleRows) {
  if (!Array.isArray(stored) || stored.length > TASK_BOARD_ORDER_LIMIT || stored.some(id => !positive(id))
    || new Set(stored).size !== stored.length) throw new Error('Invalid stored task board order.');
  if (!Array.isArray(eligibleRows) || eligibleRows.length > TASK_BOARD_ORDER_LIMIT)
    throw fail(413, 'El tablero supera el límite de ordenación. No se aplicaron cambios.');
  const ids = eligibleRows.map(row => row.id);
  if (ids.some(id => !positive(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid eligible task board IDs.');
  const membership = new Set(ids), seen = new Set();
  const result = stored.filter(id => membership.has(id));
  for (const id of result) seen.add(id);
  for (const id of ids) if (!seen.has(id)) { result.push(id); seen.add(id); }
  return result;
}
export function moveTaskBoardOrder(order, taskId, beforeId) {
  if (!positive(taskId) || beforeId !== null && (!positive(beforeId) || beforeId === taskId)) throw invalid();
  if (!order.includes(taskId) || beforeId !== null && !order.includes(beforeId)) throw unavailable();
  const result = order.filter(id => id !== taskId);
  result.splice(beforeId === null ? result.length : result.indexOf(beforeId), 0, taskId);
  return result;
}

export async function reorderTaskBoard(pool, observed, rawInput) {
  const input = parseTaskBoardOrderInput(rawInput);
  const actorId = observed?.id, epoch = observed?.session_version;
  if (!positive(actorId) || !positive(epoch)) throw fail(401, 'La sesión ya no está vigente.');
  const captured = bindCapturedOwnerProfileAuthority(observed, Object.freeze({ id: actorId,
    session_version: epoch, rol: observed?.rol }));
  const authority = captureOwnerProfileWriteAuthority(captured);
  const hash = intentHash(input), db = await pool.connect();
  let releaseError;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await retainCapturedOwnerProfileAuthority(db, authority, { lockMode: 'share' });
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [actorId])).rows[0];
    if (!actor || actor.id !== actorId || actor.activo !== true || actor.session_version !== epoch)
      throw fail(401, 'La sesión ya no está vigente.');
    const meta = (await db.query(`SELECT revision::text AS revision,task_ids FROM task_board_order
      WHERE scope=$1 FOR UPDATE`, [TASK_BOARD_ORDER_SCOPE])).rows[0];
    if (!meta) throw fail(503, 'El orden compartido no está disponible.');
    revision(meta.revision);
    const receipt = (await db.query(`SELECT payload_hash,task_id,before_id,order_revision::text AS order_revision,changed
      FROM task_board_order_receipts WHERE actor_user_id=$1 AND request_id=$2`, [actorId,input.request_id])).rows[0];
    // A replay needs only its moved task's present authority. Old anchors may
    // have disappeared; old task/order versions must not erase committed proof.
    const ids = [...new Set([input.task_id,...(!receipt && input.before_id !== null ? [input.before_id] : [])])].sort((a,b)=>a-b);
    const locked = (await db.query(`SELECT t.id,t.revision,t.estado,t.propiedades_extra FROM tareas t
      WHERE t.id=ANY($1::integer[]) ORDER BY t.id FOR SHARE OF t`, [ids])).rows;
    const task = locked.find(row => row.id === input.task_id);
    if (!task || !eligible(task) || !column(task)) throw unavailable();
    const access = buildTaskAccessClause(actor,'t','$2');
    const allowed = await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1${access.sql}`,
      access.value === null ? [input.task_id] : [input.task_id,access.value]);
    if (!allowed.rows.length) throw unavailable();
    if (receipt) {
      if (receipt.payload_hash !== hash) throw fail(409, 'Ese intento ya se usó con otro movimiento. Actualizá el tablero.');
      const result = { task_id: receipt.task_id, before_id: receipt.before_id, order_revision: receipt.order_revision,
        replayed: true, changed: receipt.changed };
      await db.query('COMMIT'); return result;
    }
    if (meta.revision !== input.expected_order_revision || task.revision !== input.expected_revision) throw stale();
    if (input.before_id !== null) {
      const anchor = locked.find(row => row.id === input.before_id);
      if (!anchor || !eligible(anchor)) throw unavailable();
      if (anchor.revision !== input.expected_before_revision || column(anchor) !== column(task)) throw stale();
    }
    const rows = (await db.query(`SELECT t.id FROM tareas t WHERE ${TASK_BOARD_ELIGIBILITY_SQL}
      ORDER BY t.fecha_vencimiento ASC NULLS LAST,t.id DESC LIMIT 100001`)).rows;
    const current = normalizeTaskBoardOrder(meta.task_ids, rows);
    const next = moveTaskBoardOrder(current,input.task_id,input.before_id);
    const changed = current.some((id,index) => id !== next[index]);
    let orderRevision = meta.revision;
    if (changed) {
      if (BigInt(meta.revision) === MAX_REVISION) throw stale();
      orderRevision = (await db.query(`UPDATE task_board_order SET task_ids=$2,revision=revision+1
        WHERE scope=$1 RETURNING revision::text AS revision`, [TASK_BOARD_ORDER_SCOPE,next])).rows[0]?.revision;
      if (!orderRevision) throw new Error('Task board order update was not confirmed.');
    }
    await db.query(`INSERT INTO task_board_order_receipts
      (actor_user_id,request_id,payload_hash,task_id,before_id,order_revision,changed)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actorId,input.request_id,hash,input.task_id,input.before_id,orderRevision,changed]);
    await db.query('COMMIT');
    return { task_id: input.task_id, before_id: input.before_id, order_revision: orderRevision, replayed: false, changed };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { releaseError = rollback; }
    throw error;
  } finally { db.release(releaseError); }
}

export function createTaskBoardOrderRouter({ express, pool }) {
  const router = express.Router();
  router.post('/', async (req,res,next) => {
    try { return res.json(await reorderTaskBoard(pool,req.auth,req.body)); }
    catch (error) { if (error.status) return res.status(error.status).json({error:error.message}); return next(error); }
  });
  return router;
}
