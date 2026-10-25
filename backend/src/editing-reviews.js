import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { assertCurrentEditingApprover, normalizeExpectedEditingDelivery } from './editing-approval.js';
import { editingDeliveryDto, editingDeliveryTaskId } from './editing-deliveries.js';
import { lockTaskOperationResources } from './task-operation-receipts.js';
import { taskTransitionError } from './workflow-contract.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = n => Number.isSafeInteger(n) && n > 0;
const fields = 'id,task_id,delivery_id,actor_id,action,task_revision,notes,recorded_at';

export function editingReviewDomainConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code) && typeof error.constraint === 'string'
    && error.constraint.startsWith('task_editing_reviews_');
}

export function normalizeEditingCorrectionInput(value) {
  const keys = ['request_id', 'expected_revision', 'expected_entrega_id', 'notes'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))
    || keys.some(k => !Object.hasOwn(value, k))) throw fail('Campos de corrección inválidos.');
  const request_id = normalizeExpectedEditingDelivery(value.request_id), expected_entrega_id = normalizeExpectedEditingDelivery(value.expected_entrega_id);
  if (!request_id || !expected_entrega_id || !positive(value.expected_revision)) throw fail('Elegí la entrega y revisión observadas.');
  if (typeof value.notes !== 'string' || value.notes.includes('\0') || value.notes.length > 4000 || !value.notes.trim()) throw fail('Escribí las correcciones, hasta 4000 caracteres.');
  return { request_id, expected_revision: value.expected_revision, expected_entrega_id, notes: value.notes.trim() };
}

export function editingCorrectionPayloadHash(taskId, input) {
  return createHash('sha256').update(JSON.stringify({ task_id: taskId, expected_revision: input.expected_revision,
    expected_entrega_id: input.expected_entrega_id, notes: input.notes })).digest('hex');
}

export function editingReviewDto(row) {
  return { id: row.id, task_id: row.task_id, delivery_id: row.delivery_id, actor_id: row.actor_id,
    action: row.action, task_revision: Number(row.task_revision), notes: row.notes, recorded_at: new Date(row.recorded_at).toISOString() };
}

function available(task) {
  const p = task?.propiedades_extra;
  return task?.tipo_tarea === 'edicion' && p?.workspace === 'render_os'
    && !['archivada_render_os', 'papelera_render_os'].some(k => [true, 'true'].includes(p[k]));
}

async function readTask(db, id) {
  const task = (await db.query(`SELECT t.id,t.revision,t.estado,t.tipo_tarea,t.cliente_id,t.propiedades_extra
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
    WHERE t.id=$1 AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)`, [id])).rows[0];
  if (!task || !available(task)) throw fail('Tarea de edición no disponible.', 404);
  if (!positive(task.revision)) throw new Error('Unsupported editing review task revision.');
  return task;
}

async function latestDelivery(db, id) {
  return (await db.query(`SELECT id,task_id,actor_id,task_revision,url,notes,recorded_at FROM task_editing_deliveries
    WHERE task_id=$1 ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1`, [id])).rows[0] ?? null;
}

async function history(db, task, user) {
  const latest = await latestDelivery(db, task.id);
  const total = Number((await db.query('SELECT count(*)::int AS total FROM task_editing_reviews WHERE task_id=$1', [task.id])).rows[0].total);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Unsupported editing review count.');
  const decisions = (await db.query(`SELECT ${fields} FROM (
    SELECT ${fields} FROM task_editing_reviews WHERE task_id=$1 ORDER BY task_revision DESC,id DESC LIMIT 200
    ) recent ORDER BY task_revision,id`, [task.id])).rows.map(editingReviewDto);
  return { task: { id: task.id, revision: task.revision, estado: task.estado }, latest_delivery: latest ? editingDeliveryDto(latest) : null,
    decisions, total, truncated: total > 200,
    can_request_corrections: user.rol === 'admin' && task.estado === 'en_revision' && Boolean(latest && latest.task_id === task.id && positive(latest.task_revision) && latest.task_revision <= task.revision) };
}

// INSERT SELECT rechecks persisted post-trigger proof and relationship. It takes
// no new explicit user/task/goal/visit/advisory locks; caller already holds them.
function decisionSql(action) {
  const proof = action === 'aprobada'
    ? `t.estado='aprobada' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb
       AND t.propiedades_extra->>'revision_aprobada_entrega_id'=$4::text
       AND t.propiedades_extra->'revision_aprobada_por_id'=to_jsonb($2::int)`
    : `t.estado='en_progreso' AND t.propiedades_extra->'revision_aprobada'='false'::jsonb
       AND t.propiedades_extra->>'revision_aprobada_entrega_id' IS NULL
       AND t.propiedades_extra->>'revision_aprobada_por' IS NULL AND t.propiedades_extra->>'revision_aprobada_por_id' IS NULL
       AND t.propiedades_extra->>'revision_aprobada_at' IS NULL AND t.propiedades_extra->>'finalizada_at' IS NULL`;
  return `WITH actual AS (
    SELECT t.id,t.revision,d.id AS delivery_id FROM tareas t
    JOIN task_editing_deliveries d ON d.task_id=t.id AND d.id=$4::uuid
    JOIN usuarios u ON u.id=$2 AND u.activo IS TRUE AND u.rol='admin' AND u.session_version=$9
    WHERE t.id=$1 AND t.revision=$3 AND t.tipo_tarea='edicion' AND t.propiedades_extra->>'workspace'='render_os'
      AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
      AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
      AND (t.cliente_id IS NULL OR EXISTS(SELECT 1 FROM clientes c WHERE c.id=t.cliente_id AND c.activo IS DISTINCT FROM FALSE))
      AND d.task_revision < t.revision AND ${proof}
      AND d.id=(SELECT newest.id FROM task_editing_deliveries newest WHERE newest.task_id=t.id
        ORDER BY newest.task_revision DESC,newest.recorded_at DESC,newest.id DESC LIMIT 1)
  ), inserted AS (
    INSERT INTO task_editing_reviews(id,task_id,delivery_id,actor_id,action,task_revision,notes,request_id,payload_hash)
    SELECT $5::uuid,id,delivery_id,$2,'${action}',revision,$6,$7::uuid,$8 FROM actual
    ON CONFLICT (task_id,task_revision) DO NOTHING RETURNING id
  ) SELECT id FROM inserted
    UNION ALL SELECT r.id FROM task_editing_reviews r JOIN actual a ON a.id=r.task_id AND a.revision=r.task_revision
    WHERE r.delivery_id=$4::uuid AND r.actor_id=$2 AND r.action='${action}' AND r.notes=$6
      AND r.request_id IS NOT DISTINCT FROM $7::uuid AND r.payload_hash IS NOT DISTINCT FROM $8::text
      AND NOT EXISTS(SELECT 1 FROM inserted) LIMIT 1`;
}

async function insertDecision(db, task, user, deliveryId, action, notes = '', requestId = null, hash = null) {
  const result = await db.query(decisionSql(action), [task.id, user.id, task.revision, deliveryId, randomUUID(), notes, requestId, hash, user.session_version]);
  if (result.rows.length !== 1) throw fail('La tarea o la prueba de revisión cambió. Recargá antes de continuar.', 409);
  return result.rows[0].id;
}

/** Caller invokes only on an actual new approval, after its exact-delivery
 * assertion and task UPDATE/CAS. Returns decision UUID, null for legacy/no artifact.
 * A repeated call for the same task revision is mutation-free and returns its ID.
 */
export async function recordEditingApproval(db, task, auth, deliveryId) {
  const delivery = normalizeExpectedEditingDelivery(deliveryId);
  if (delivery === null) return null;
  if (!positive(auth?.id) || !Number.isSafeInteger(auth.session_version) || auth.activo === false) throw fail('Sesión requerida.', 401);
  if (auth.rol !== 'admin') throw fail('Solo administración puede registrar aprobaciones.', 403);
  if (!positive(task?.id) || !positive(task.revision) || !available(task) || task.estado !== 'aprobada'
    || task.propiedades_extra.revision_aprobada !== true || task.propiedades_extra.revision_aprobada_entrega_id !== delivery) {
    throw fail('La aprobación efectiva no coincide con la entrega.', 409);
  }
  return insertDecision(db, task, auth, delivery, 'aprobada');
}

async function reader(db, auth) {
  if (!positive(auth?.id) || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
  const user = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
  if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
  if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso a revisiones.', 403);
  return user;
}

export function createEditingReviewsRouter({ express, pool }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = write => async (req, res, next) => {
    let db, discard;
    try {
      const id = editingDeliveryTaskId(req.params.id);
      if (Object.keys(req.query ?? {}).length) throw fail('No se permiten parámetros de consulta.');
      const input = write ? normalizeEditingCorrectionInput(req.body) : null;
      db = await pool.connect();
      await db.query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const user = write ? await assertCurrentEditingApprover(db, req.auth) : await reader(db, req.auth);
      if (write) {
        await db.query("SELECT pg_advisory_xact_lock(hashtext('editing-review-request'),hashtext($1))", [`${user.id}:${input.request_id}`]);
        await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
        await lockTaskOperationResources(db, id);
      }
      let task = await readTask(db, id), decisionId, replayed = false;
      if (write) {
        const hash = editingCorrectionPayloadHash(id, input);
        const receipt = (await db.query('SELECT id,payload_hash FROM task_editing_reviews WHERE actor_id=$1 AND request_id=$2', [user.id, input.request_id])).rows[0];
        if (receipt) {
          if (receipt.payload_hash !== hash) throw fail('La clave ya se usó para otra corrección.', 409);
          decisionId = receipt.id; replayed = true;
        } else {
          if (task.revision !== input.expected_revision || task.estado !== 'en_revision') throw fail('La tarea cambió o ya no está para revisar.', 409);
          const delivery = await latestDelivery(db, id);
          if (!delivery || delivery.id !== input.expected_entrega_id || delivery.task_id !== id || !positive(delivery.task_revision) || delivery.task_revision > task.revision) throw fail('Elegí la última entrega observada antes de pedir correcciones.', 409);
          const transition = taskTransitionError(task, 'en_progreso', user);
          if (transition) throw fail(transition.error, transition.status);
          const updated = (await db.query(`UPDATE tareas SET estado='en_progreso',propiedades_extra=propiedades_extra || jsonb_build_object(
            'revision_aprobada',false,'revision_aprobada_por',NULL,'revision_aprobada_por_id',NULL,'revision_aprobada_at',NULL,
            'revision_aprobada_entrega_id',NULL,'finalizada_at',NULL),updated_at=clock_timestamp()
            WHERE id=$1 AND revision=$2 AND estado='en_revision' RETURNING id,revision,estado,tipo_tarea,cliente_id,propiedades_extra`, [id, input.expected_revision])).rows[0];
          if (!updated || updated.estado !== 'en_progreso' || !positive(updated.revision) || updated.revision !== task.revision + 1 || !available(updated)
            || updated.propiedades_extra.revision_aprobada !== false
            || ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'revision_aprobada_entrega_id', 'finalizada_at'].some(k => updated.propiedades_extra[k] !== null)) throw fail('La corrección no quedó en un estado válido.', 409);
          decisionId = await insertDecision(db, updated, user, delivery.id, 'correcciones', input.notes, input.request_id, hash);
          task = updated;
        }
      }
      const body = { ...(await history(db, task, user)), ...(write ? { decision_id: decisionId, replayed } : {}) };
      await db.query('COMMIT');
      res.status(write && !replayed ? 201 : 200).json(body);
    } catch (error) {
      if (db) { try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; } }
      if (error.status) res.status(error.status).json({ error: error.message });
      else if (editingReviewDomainConflict(error)) res.status(409).json({ error: 'La revisión cambió o dejó de ser compatible.' });
      else next(error);
    } finally { db?.release(discard); }
  };
  router.get('/:id/revisiones', handle(false));
  router.post('/:id/correcciones', handle(true));
  return router;
}
