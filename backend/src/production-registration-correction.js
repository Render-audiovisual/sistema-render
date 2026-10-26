import { correctProductionRecord } from './production-record-updates.js';
import { rejectMixedProductionRecording } from './production-registry-compatibility.js';
import { assertLegacyProductionTaskAccess } from './legacy-production-authority.js';
import { getTaskActor } from './task-access.js';
import { getProductionProgress, getProductionTaskState, isProductionVisitTask } from './production-visits.js';
import { taskTransitionError } from './workflow-contract.js';
import { annotateTaskAssignments } from './task-assignments.js';

const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const quantity = n => Number.isSafeInteger(n) && n > 0;
const error = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const conflict = message => error(message, 409);

function recordId(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw error('record_id debe identificar un registro exacto.');
  return value;
}


function normalizeInput(input) {
  const allowed = ['taskId','recordId','expectedRevision','amount'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))
    || !positive(input.taskId) || !positive(input.expectedRevision) || !quantity(input.amount)) throw error('Elegí tarea, revisión observada y cantidad entera positiva explícitas.');
  return Object.freeze({task_id:input.taskId,record_id:recordId(input.recordId),expected_revision:input.expectedRevision,cantidad:input.amount});
}

const TASK = `SELECT t.id,t.revision,t.titulo,t.asignado_a,t.cliente_id,t.estado,t.tipo_tarea,t.subtipo,t.propiedades_extra,t.updated_at
  FROM tareas t WHERE t.id=$1 AND t.propiedades_extra->>'workspace'='render_os' FOR UPDATE`;

export async function lockLegacyProductionCorrectionTask(db, actor, taskId) {
  if (!positive(actor?.id) || actor.activo !== true) throw error('Necesitás una identidad actual retenida.', 403);
  const task = (await db.query(TASK, [taskId])).rows[0];
  if (!task || task.propiedades_extra?.workspace !== 'render_os' || !isProductionVisitTask(task)
    || ['archivada_render_os', 'papelera_render_os'].some(key => [true, 'true'].includes(task.propiedades_extra?.[key]))) throw error('Visita no disponible.', 404);
  await assertLegacyProductionTaskAccess(db, actor, task.id);
  await rejectMixedProductionRecording(db, task.id);
  return task;
}

function validateRecords(task, wanted) {
  const records = task.propiedades_extra?.produccion_registros;
  if (!Array.isArray(records)) throw conflict('El registro agregado no tiene una estructura verificable. Requiere conciliación explícita.');
  const ids = new Set();
  for (const row of records) {
    const value = row?.id;
    if (!(typeof value === 'string' || quantity(value))) throw conflict('Hay registros sin identidad verificable. Requiere conciliación explícita.');
    const id = String(value);
    try { recordId(id); } catch { throw conflict('Hay registros con identidad inválida. Requiere conciliación explícita.'); }
    if (ids.has(id)) throw error('Hay IDs de registro duplicados. Requiere conciliación explícita.', 409, 'PRODUCTION_RECORD_ID_AMBIGUOUS');
    ids.add(id);
  }
  const selected = records.find(row => String(row.id) === wanted);
  if (!selected) throw error('Registro de producción no encontrado.', 404);
  // Numeric legacy strings are accepted only when losslessly integer-shaped;
  // never turn null, blank, booleans, fractions or unsafe counts into history.
  const previous = selected.cantidad;
  const number = typeof previous === 'string' && /^[1-9]\d*$/.test(previous) ? Number(previous) : previous;
  if (!quantity(number)) throw error('La cantidad anterior no es verificable. Requiere conciliación explícita.', 409, 'PRODUCTION_RECORD_QUANTITY_INVALID');
}

async function prepare(db, actor, intent, now) {
  const task = await lockLegacyProductionCorrectionTask(db, actor, intent.task_id);
  if (task.revision !== intent.expected_revision) throw conflict('La visita cambió. Revisá sus registros y previsualizá nuevamente.');
  validateRecords(task, intent.record_id);
  const corrected = correctProductionRecord(task, { recordId: intent.record_id, amount: intent.cantidad,
    actorId: actor.id, actorName: getTaskActor(actor), now });
  const planned = getProductionProgress(task).planned;
  const recorded = getProductionProgress({ propiedades_extra: { produccion_registros: corrected.records } }).recorded;
  const nextState = getProductionTaskState({ planned, recorded });
  const denied = taskTransitionError(task, nextState, actor);
  if (denied) throw error(denied.error, denied.status);
  return { task, ...corrected, planned, recorded, nextState };
}


/** Caller retains current actor BEFORE domain locks and owns READ COMMITTED,
 * COMMIT/ROLLBACK and response DTO. Preview validation only: acquires the parent
 * task lock and verifies ID access/revision/mixed-registry/legacy record identity.
 * Returns an internal plan, never a transport DTO; performs no writes.
 */
export async function observeLegacyProductionRegistrationCorrection(db, actor, input, {now = new Date()} = {}) {
  return prepare(db, actor, normalizeInput(input), now);
}

/** Shared web/WhatsApp mutation. No actor lookup, transaction, DTO or notifier.
 * Actor must already be current/retained (web retainLegacyProductionActor or
 * WhatsApp lockFeedbackActor). Employee ID membership and transition policy are
 * preserved; the WhatsApp caller separately requires current admin.
 * beforeMutation({db,task,previous,records,planned,recorded,nextState}) runs
 * after validation/locks, before UPDATE, and may claim the exact transport token.
 * Returns the annotated saved task. Main keeps web early gates, actor retention,
 * transaction and taskOperationalDto(saved,req.auth) in server.js.
 * Input is exactly {taskId,recordId,expectedRevision,amount}; no implicit lookup.
 */
export async function correctLegacyProductionRegistration(db, actor, input, {beforeMutation,now = new Date()} = {}) {
  const intent = normalizeInput(input);
  const plan = await prepare(db, actor, intent, now);
  if (beforeMutation) await beforeMutation({db,...plan});
  const stamp = new Date(now).toISOString();
  const properties = { ...plan.task.propiedades_extra, produccion_registros: plan.records,
    produccion_esperando_confirmacion: plan.nextState === 'en_revision',
    produccion_finalizada_at: plan.nextState === 'en_revision' ? stamp : null,
    produccion_confirmada_at: null, produccion_confirmada_por: null, produccion_confirmada_por_id: null,
    revision_aprobada: false, revision_aprobada_por: null, revision_aprobada_por_id: null, revision_aprobada_at: null,
    finalizada_at: null, mia_notificacion_pendiente: { tipo: 'correccion_grabacion', anterior: plan.previous, nuevo: intent.cantidad, creado_en: stamp }, workspace: 'render_os' };
  const saved = (await db.query(`UPDATE tareas SET estado=$3,propiedades_extra=$2::jsonb,updated_at=now()
    WHERE id=$1 AND revision=$4 RETURNING id,revision,titulo,asignado_a,cliente_id,estado,propiedades_extra,
    to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,tipo_tarea,subtipo,
    prioridad,aclaraciones,material_referencia,tarea_padre_id,created_at,updated_at`,
  [intent.task_id, JSON.stringify(properties), plan.nextState, intent.expected_revision])).rows[0];
  if (!saved) throw conflict('La revisión cambió antes de aplicar la corrección.');
  const [task] = await annotateTaskAssignments(db, [saved]);
  return task;
}
