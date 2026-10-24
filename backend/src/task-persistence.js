import { annotateTaskAssignments, replaceTaskAssignments } from "./task-assignments.js";
import { captureAssignmentNotification, lockAssignmentNotificationActor, readAssignmentNotificationMembers, buildAssignmentNotification } from './task-reassignment-notifications.js';

// Task fields and ID relations form a single commit. A failed relation write
// must not leave a successfully saved task with missing access permissions.
export async function persistAssignedTask(pool, sql, values, assignment, afterSave = null, beforeSave = null, options = {}) {
  const capture = assignment && options.assignmentNotificationActor !== undefined
    ? captureAssignmentNotification(options) : null;
  if (capture) {
    assignment = structuredClone(assignment);
    values = structuredClone(values);
  }
  const db = await pool.connect();
  let discard;
  try {
    await db.query("BEGIN");
    const actor = capture ? await lockAssignmentNotificationActor(db, capture) : null;
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
    let previous;
    if (capture) {
      const locked = await db.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [capture.taskId]);
      if (locked.rows.length !== 1 || locked.rows[0].id !== capture.taskId) throw Object.assign(new Error('Tarea no encontrada.'), { status:404 });
      previous = await readAssignmentNotificationMembers(db, capture.taskId);
    }
    const result = await db.query(sql, values);
    if (capture && (result.rows.length > 1 || (result.rows[0] && result.rows[0].id !== capture.taskId)))
      throw Object.assign(new Error('La tarea actualizada no coincide con la reasignación.'), { status:409 });
    if (result.rows[0] && assignment) await replaceTaskAssignments(db, result.rows[0].id, assignment);
    if (result.rows[0] && afterSave) await afterSave(db, result.rows[0]);
    result.rows = await annotateTaskAssignments(db, result.rows);
    const notification = capture && result.rows[0]
      ? buildAssignmentNotification(result.rows[0], previous, await readAssignmentNotificationMembers(db, capture.taskId), actor) : null;
    await db.query("COMMIT");
    if (notification) result.assignmentNotification = notification;
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally { db.release(discard); }
}
