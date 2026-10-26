import { createHash, randomUUID } from 'node:crypto';
import { lockFeedbackActor } from './feedback-receipts.js';
import { annotateTaskAssignments } from './task-assignments.js';
import { taskOperationalDto } from './operational-dto.js';
import { productionValueHash } from './production-history-hash.js';
import { correctLegacyProductionRegistration, observeLegacyProductionRegistrationCorrection, lockLegacyProductionCorrectionTask } from './production-registration-correction.js';

const OPERATION = 'corregir_registro_produccion_v1';
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const quantity = n => Number.isSafeInteger(n) && n > 0;
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const error = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const conflict = message => error(message, 409);

function recordId(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw error('record_id debe identificar un registro exacto.');
  return value;
}

export function normalizeProductionCorrectionIntent(input) {
  const keys = ['task_id', 'record_id', 'expected_revision', 'cantidad'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))
    || !positive(input.task_id) || !positive(input.expected_revision) || !quantity(input.cantidad)) throw error('Elegí tarea, revisión observada y cantidad entera positiva explícitas.');
  return Object.freeze({ task_id: input.task_id, record_id: recordId(input.record_id), expected_revision: input.expected_revision, cantidad: input.cantidad });
}

const sharedInput = intent => ({taskId:intent.task_id,recordId:intent.record_id,
  expectedRevision:intent.expected_revision,amount:intent.cantidad});

/** Compatibility transport wrapper. Shared mutation returns the annotated row;
 * caller still owns the transaction. Main's web route uses the shared module
 * directly, without importing any WhatsApp transport or confirmation code.
 */
export async function correctLegacyProductionRecord(db, actor, input, {beforeMutation,now = new Date()} = {}) {
  const intent = normalizeProductionCorrectionIntent(input);
  let previous;
  const saved = await correctLegacyProductionRegistration(db, actor, sharedInput(intent), {
    now, beforeMutation: async plan => {
      previous = plan.previous;
      if (beforeMutation) await beforeMutation(plan);
    },
  });
  return {task:taskOperationalDto(saved,actor),previous,amount:intent.cantidad};
}
function capture(req) {
  const subject = Object.freeze({ ...req.wilson });
  if (req.headers?.['x-wilson-signature-version'] !== '2') throw error('Wilson requiere firma versión 2.', 401);
  const scope = typeof subject.actorId === 'string' ? `private:${createHash('sha256').update(subject.actorId.replace(/^\+/, '')).digest('hex').slice(0, 16)}` : '';
  if (subject.channel !== 'whatsapp' || subject.privateChat !== true || subject.groupId !== scope
    || !positive(subject.userId) || subject.systemActor || subject.groupParticipantOnly) throw error('La corrección requiere WhatsApp privado y una identidad humana vinculada.', 403);
  return subject;
}

function requestIntent(req, confirm) {
  const body = req.body, allowed = ['expected_revision', 'cantidad', ...(confirm ? ['confirmacion_token'] : [])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw error('Campos de corrección no permitidos.');
  if (typeof req.params.id !== 'string' || !/^[1-9]\d*$/.test(req.params.id)) throw error('Tarea inválida.');
  if (confirm && !uuid(body.confirmacion_token)) throw error('Falta confirmacion_token válido.');
  return normalizeProductionCorrectionIntent({ task_id: Number(req.params.id), record_id: req.params.recordId,
    expected_revision: body.expected_revision, cantidad: body.cantidad });
}

const immutable = payload => ({ contract: OPERATION, actor_user_id: payload?.actor_user_id, intent: payload?.intent, snapshot: payload?.snapshot });
const hash = payload => productionValueHash(immutable(payload));

async function transaction(pool, subject, work) {
  let db, discard;
  try {
    if (typeof pool?.connect !== 'function') throw new TypeError('Correction requires pool.connect.');
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const actor = await lockFeedbackActor(db, subject);
    if (actor.id !== subject.userId || actor.rol !== 'admin') throw error('Solo administración actual puede corregir desde WhatsApp.', 403);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([OPERATION, subject.actorId, subject.groupId])]);
    const result = await work(db, actor);
    await db.query('COMMIT'); return result;
  } catch (e) {
    if (db) try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw e;
  } finally { db?.release(discard); }
}

/** Register AFTER signature-v2/exact-target verification + resolveWilsonUser.
 * POST /tareas/:id/produccion/registros/:recordId/previsualizar {expected_revision,cantidad}
 * PATCH /tareas/:id/produccion/registros/:recordId {expected_revision,cantidad,confirmacion_token}
 * Main owns registration/CLI/physical tests. Existing confirmation table only.
 * Receipt replay is historical evidence, not a claim that the count is still current.
 * Pending notification metadata follows web semantics; no direct notifier call.
 */
export function registerWilsonProductionCorrectionRoutes(router, { pool }) {
  const handle = fn => async (req, res, next) => {
    try { return await fn(req, res); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); return next(e); }
  };
  const path = '/tareas/:id/produccion/registros/:recordId';
  router.post(`${path}/previsualizar`, handle(async (req, res) => {
    const subject = capture(req), intent = requestIntent(req, false);
    const result = await transaction(pool, subject, async (db, actor) => {
      const plan = await observeLegacyProductionRegistrationCorrection(db, actor, sharedInput(intent));
      const token = randomUUID(), payload = { contract: OPERATION, actor_user_id: actor.id, intent, snapshot: productionValueHash(plan.task) };
      const inserted = (await db.query(`INSERT INTO integracion_confirmaciones
        (token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at,payload)
        VALUES($1,'wilson','whatsapp',$2,$3,$4,$5,$6,clock_timestamp()+interval '15 minutes',$7::jsonb) RETURNING expires_at`,
      [token, subject.actorId, subject.groupId, OPERATION, intent.task_id, hash(payload), JSON.stringify(payload)])).rows[0];
      return { ...intent, confirmacion_token: token, expires_at: inserted.expires_at, updated: false,
        summary: { task_id: intent.task_id, titulo: plan.task.titulo, record_id: intent.record_id,
          previous: plan.previous, amount: intent.cantidad, total_after: plan.recorded, planned: plan.planned, state_after: plan.nextState },
        text: `Corregir #${intent.task_id} “${String(plan.task.titulo).replace(/[\r\n\t]/g, ' ')}”, registro ${intent.record_id}: ${plan.previous} → ${intent.cantidad}. Total resultante: ${plan.recorded}; estado: ${plan.nextState}. Se recalculan adelantos posteriores y se retira aprobación/confirmación previa. No publica ni crea videos. ¿Confirmás?` };
    });
    return res.status(201).json(result);
  }));
  router.patch(path, handle(async (req, res) => {
    const subject = capture(req), intent = requestIntent(req, true), token = req.body.confirmacion_token.toLowerCase();
    const result = await transaction(pool, subject, async (db, actor) => {
      // The actor/private mutex orders preview/confirm. No token row lock is
      // held before task locks; token claim is after every domain/ACL wait.
      const saved = (await db.query(`SELECT payload,payload_hash,used_at FROM integracion_confirmaciones
        WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3
        AND operacion=$4 AND tarea_id=$5`, [token, subject.actorId, subject.groupId, OPERATION, intent.task_id])).rows[0];
      if (!saved || saved.payload?.contract !== OPERATION || saved.payload.actor_user_id !== actor.id
        || saved.payload_hash !== hash(saved.payload) || productionValueHash(saved.payload.intent) !== productionValueHash(intent)) throw conflict('La confirmación no corresponde al registro, cantidad, revisión y actor exactos. Prepará un resumen nuevo.');
      if (saved.used_at) {
        const task = await lockLegacyProductionCorrectionTask(db, actor, intent.task_id), receipt = saved.payload.receipt;
        if (!receipt || receipt.contract !== OPERATION || receipt.task_id !== intent.task_id || receipt.record_id !== intent.record_id
          || receipt.actor_user_id !== actor.id || receipt.amount !== intent.cantidad || !positive(receipt.revision)) throw conflict('La confirmación fue utilizada sin recibo compatible.');
        const [current] = await annotateTaskAssignments(db, [task]);
        return { updated: false, idempotent: true, previous: receipt.previous, amount: receipt.amount, receipt,
          // Serialization only: omit the admin free-metadata extension on this
          // operational transport. Authority was already checked/retained above.
          task: taskOperationalDto(current, { id: actor.id }), result_current: true,
          text: 'Esta corrección ya fue confirmada. El recibo es histórico; la tarea adjunta muestra su estado actual. No corregí nuevamente.' };
      }
      let claimed;
      const corrected = await correctLegacyProductionRecord(db, actor, intent, { beforeMutation: async ({ task }) => {
        if (productionValueHash(task) !== saved.payload.snapshot) throw conflict('La visita cambió respecto del resumen. Previsualizá nuevamente.');
        claimed = (await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
          WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3
          AND operacion=$4 AND tarea_id=$5 AND payload_hash=$6 AND used_at IS NULL
          AND expires_at>clock_timestamp() RETURNING used_at`,
        [token, subject.actorId, subject.groupId, OPERATION, intent.task_id, saved.payload_hash])).rows[0];
        if (!claimed) throw conflict('La confirmación venció o ya fue usada. Prepará otra.');
      } });
      const receipt = { contract: OPERATION, actor_user_id: actor.id, task_id: intent.task_id, record_id: intent.record_id,
        previous: corrected.previous, amount: corrected.amount, revision: corrected.task.revision, confirmed_at: new Date(claimed.used_at).toISOString() };
      await db.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,grupo_id,accion,tarea_id,resultado,detalles)
        VALUES('wilson','whatsapp',$1,$2,$3,'corregir_registro_produccion',$4,'ok',$5::jsonb)`,
      [subject.actorId, actor.nombre, subject.groupId, intent.task_id, JSON.stringify({ ...receipt, expected_revision: intent.expected_revision })]);
      const stored = await db.query(`UPDATE integracion_confirmaciones SET payload=jsonb_set(payload,'{receipt}',$2::jsonb,true)
        WHERE token=$1 AND operacion=$3 AND used_at IS NOT NULL RETURNING token`, [token, JSON.stringify(receipt), OPERATION]);
      if (stored.rows.length !== 1) throw conflict('No se pudo guardar el recibo.');
      return { ...corrected, task: taskOperationalDto(corrected.task, { id: actor.id }), updated: true, idempotent: false, receipt };
    });
    return res.json(result);
  }));
  return router;
}
