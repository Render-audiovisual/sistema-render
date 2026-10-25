import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { lockTaskOperationResources } from './task-operation-receipts.js';
import { taskTransitionError } from './workflow-contract.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const ALLOWED_STATES = ['pendiente', 'en_progreso', 'en_revision', 'aprobada'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function editingDeliveryTaskId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw fail('Tarea inválida.');
  return Number(value);
}

export function normalizeEditingDeliveryInput(input) {
  const fields = ['request_id', 'expected_revision', 'url', 'notes'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(input, k))) throw fail('Campos de entrega inválidos.');
  if (typeof input.request_id !== 'string' || !UUID.test(input.request_id)) throw fail('request_id inválido.');
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) throw fail('Revisión inválida.');
  if (typeof input.url !== 'string' || /[\u0000-\u001f\u007f]/.test(input.url)) throw fail('URL inválida.');
  const url = input.url.trim();
  if (!url || url.length > 2000 || /\s|\\/.test(url) || !/^https?:\/\//i.test(url)) throw fail('URL inválida.');
  let parsed;
  try { parsed = new URL(url); } catch { throw fail('URL inválida.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw fail('Usá una URL HTTP(S) sin credenciales.');
  if (typeof input.notes !== 'string' || input.notes.includes('\0') || input.notes.length > 4000) throw fail('Notas inválidas.');
  const notes = input.notes.trim();
  if (notes.length > 4000) throw fail('Las notas superan 4000 caracteres.');
  if (parsed.href.length > 2000) throw fail('URL inválida.');
  return { request_id: input.request_id.toLowerCase(), expected_revision: input.expected_revision, url: parsed.href, notes };
}

export function editingDeliveryPayloadHash(taskId, normalized) {
  return createHash('sha256').update(JSON.stringify({ task_id: taskId, expected_revision: normalized.expected_revision,
    url: normalized.url, notes: normalized.notes })).digest('hex');
}

export function editingDeliveryDto(row) {
  return { id: row.id, task_id: row.task_id, actor_id: row.actor_id, task_revision: Number(row.task_revision),
    url: row.url, notes: row.notes, recorded_at: new Date(row.recorded_at).toISOString() };
}

async function actor(db, auth, write) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1 || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
  const user = (await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1${write ? ' FOR SHARE' : ''}`, [auth.id])).rows[0];
  if (!user || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
  if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso a entregas.', 403);
  return user;
}

async function readTask(db, id, user) {
  const task = (await db.query(`SELECT t.id,t.revision,t.estado,t.tipo_tarea,t.propiedades_extra->>'workspace' AS workspace,
    COALESCE(t.propiedades_extra->>'archivada_render_os','false') AS archived,
    COALESCE(t.propiedades_extra->>'papelera_render_os','false') AS trashed,
    EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$2) AS assigned
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
    WHERE t.id=$1 AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)`, [id, user.id])).rows[0];
  if (!task || task.workspace !== 'render_os' || task.tipo_tarea !== 'edicion' || task.archived === 'true' || task.trashed === 'true') throw fail('Tarea de edición no disponible.', 404);
  if (!Number.isSafeInteger(Number(task.revision)) || Number(task.revision) < 1) throw new Error('Unsupported editing task revision.');
  return task;
}

const mayWrite = (task, user) => user.rol === 'admin' || task.assigned === true;
async function currentDto(db, task, user) {
  const deliveries = (await db.query(`SELECT id,task_id,actor_id,task_revision,url,notes,recorded_at
    FROM task_editing_deliveries WHERE task_id=$1 ORDER BY recorded_at DESC,id DESC`, [task.id])).rows.map(editingDeliveryDto);
  return { task: { id: task.id, revision: Number(task.revision), estado: task.estado }, deliveries,
    can_deliver: mayWrite(task, user) && ALLOWED_STATES.includes(task.estado) };
}

function domainConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code) && typeof error.constraint === 'string'
    && error.constraint.startsWith('task_editing_deliveries_');
}

/** Mount at /api/tareas-edicion. No task/production/editorial duplication. */
export function createEditingDeliveriesRouter({ express, pool }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = write => async (req, res, next) => {
    let db, discard;
    try {
      const id = editingDeliveryTaskId(req.params.id);
      if (Object.keys(req.query ?? {}).length) throw fail('No se permiten parámetros de consulta.');
      const input = write ? normalizeEditingDeliveryInput(req.body) : null;
      db = await pool.connect();
      await db.query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const user = await actor(db, req.auth, write);
      if (write) {
        await db.query("SELECT pg_advisory_xact_lock(hashtext('editing-delivery-request'),hashtext($1))", [`${user.id}:${input.request_id}`]);
        await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
        await lockTaskOperationResources(db, id);
      }
      let task = await readTask(db, id, user);
      let deliveryId, replayed = false;
      if (write) {
        if (!mayWrite(task, user)) throw fail('No estás asignado a esta tarea.', 403);
        const hash = editingDeliveryPayloadHash(id, input);
        const receipt = (await db.query('SELECT id,payload_hash FROM task_editing_deliveries WHERE actor_id=$1 AND request_id=$2', [user.id, input.request_id])).rows[0];
        if (receipt) {
          if (receipt.payload_hash !== hash) throw fail('La clave ya se usó para otra entrega.', 409);
          deliveryId = receipt.id;
          replayed = true;
        } else {
          if (Number(task.revision) !== input.expected_revision) throw fail('La tarea cambió. Actualizá antes de reintentar.', 409);
          if (!ALLOWED_STATES.includes(task.estado)) throw fail('Esta tarea ya no acepta nuevas entregas.', 409);
          const transition = taskTransitionError(task, 'en_revision', user);
          if (transition) throw fail(transition.error, transition.status);
          const updated = (await db.query(`UPDATE tareas SET estado='en_revision',
            propiedades_extra=propiedades_extra || jsonb_build_object('revision_aprobada',false,
              'revision_aprobada_por',NULL,'revision_aprobada_por_id',NULL,'revision_aprobada_at',NULL,'finalizada_at',NULL,'revision_aprobada_entrega_id',NULL),
            updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING id,revision,estado`, [id, input.expected_revision])).rows[0];
          if (!updated) throw fail('La tarea cambió. Actualizá antes de reintentar.', 409);
          deliveryId = randomUUID();
          await db.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [deliveryId, id, user.id, input.request_id, hash, updated.revision, input.url, input.notes]);
          task = { ...task, ...updated };
        }
      }
      const body = { ...(await currentDto(db, task, user)), ...(write ? { delivery_id: deliveryId, replayed } : {}) };
      await db.query('COMMIT');
      res.status(write && !replayed ? 201 : 200).json(body);
    } catch (error) {
      if (db) { try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; } }
      if (error.status) res.status(error.status).json({ error: error.message });
      else if (domainConflict(error)) res.status(409).json({ error: 'La entrega cambió o dejó de ser compatible.' });
      else next(error);
    } finally { db?.release(discard); }
  };
  router.get('/:id/entregas', handle(false));
  router.post('/:id/entregas', handle(true));
  return router;
}
