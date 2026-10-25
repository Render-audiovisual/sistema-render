import { annotateTaskAssignments, replaceTaskAssignments } from "./task-assignments.js";
import { captureAssignmentNotification, lockAssignmentNotificationActor, readAssignmentNotificationMembers, buildAssignmentNotification } from './task-reassignment-notifications.js';
import {captureTaskCreateReceipt,beginTaskCreateReceipt,readTaskCreateReceiptTask,recordTaskCreateReceipt} from './task-create-receipts.js';

// Task fields and ID relations form a single commit. A failed relation write
// must not leave a successfully saved task with missing access permissions.
export async function persistAssignedTask(pool, sql, values, assignment, afterSave = null, beforeSave = null, options = {}) {
  if (options.assignmentNotificationMode !== undefined) {
    if (options.assignmentNotificationMode !== 'created')
      throw Object.assign(new Error('Modo de notificación inválido.'), { status:400 });
    if (!assignment) throw Object.assign(new Error('La creación requiere una asignación resuelta.'), { status:400 });
  }
  const capture = assignment && (options.assignmentNotificationActor !== undefined || options.assignmentNotificationMode !== undefined)
    ? captureAssignmentNotification(options) : null;
  const created = capture?.mode === 'created';
  const receipt=options.createReceipt===undefined?null:captureTaskCreateReceipt(options.createReceipt);
  if(receipt&&!created)throw Object.assign(new Error('El recibo solo corresponde a una creación autorizada.'),{status:400});
  if (capture) {
    assignment = structuredClone(assignment);
    values = structuredClone(values);
  }
  const db = await pool.connect();
  let discard;
  try {
    await db.query("BEGIN");
    const actor = capture ? await lockAssignmentNotificationActor(db, capture) : null;
    if(receipt){
      const previous=await beginTaskCreateReceipt(db,receipt,capture.id);
      if(previous){
        const rows=await annotateTaskAssignments(db,[await readTaskCreateReceiptTask(db,previous)]);
        await db.query('COMMIT');
        return {rows,creationReplayed:true};
      }
    }
    if (beforeSave) await beforeSave(db);
    if (assignment) {
      const ids = [...new Set([assignment.ownerId, ...assignment.collaboratorIds].filter(id => id !== null))];
      const active = await db.query("SELECT id FROM usuarios WHERE id=ANY($1::integer[]) AND activo=TRUE FOR SHARE", [ids]);
      if (active.rows.length !== ids.length) {
        const error = new Error("Una de las personas seleccionadas dejó de estar disponible.");
        error.status = 400;
        throw error;
      }
    }
    let previous = created ? { ownerId:null, collaboratorIds:[] } : undefined;
    if (capture && !created) {
      const locked = await db.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [capture.taskId]);
      if (locked.rows.length !== 1 || locked.rows[0].id !== capture.taskId) throw Object.assign(new Error('Tarea no encontrada.'), { status:404 });
      previous = await readAssignmentNotificationMembers(db, capture.taskId);
    }
    const result = await db.query(sql, values);
    if (created && (result.rows.length !== 1 || !Number.isSafeInteger(result.rows[0].id) || result.rows[0].id < 1 || result.rows[0].id > 2147483647))
      throw Object.assign(new Error('La creación no devolvió una única tarea válida.'), { status:409 });
    if (capture && !created && (result.rows.length > 1 || (result.rows[0] && result.rows[0].id !== capture.taskId)))
      throw Object.assign(new Error('La tarea actualizada no coincide con la reasignación.'), { status:409 });
    if (result.rows[0] && assignment) await replaceTaskAssignments(db, result.rows[0].id, assignment);
    if (result.rows[0] && afterSave) await afterSave(db, result.rows[0]);
    result.rows = await annotateTaskAssignments(db, result.rows);
    if(receipt)await recordTaskCreateReceipt(db,receipt,capture.id,result.rows[0]);
    const notification = capture && result.rows[0]
      ? buildAssignmentNotification(result.rows[0], previous, await readAssignmentNotificationMembers(db, result.rows[0].id), actor) : null;
    await db.query("COMMIT");
    if (notification) result.assignmentNotification = notification;
    if(receipt)result.creationReplayed=false;
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally { db.release(discard); }
}
