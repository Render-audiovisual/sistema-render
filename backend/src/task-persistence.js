import { annotateTaskAssignments, replaceTaskAssignments } from "./task-assignments.js";

// Task fields and ID relations form a single commit. A failed relation write
// must not leave a successfully saved task with missing access permissions.
export async function persistAssignedTask(pool, sql, values, assignment, afterSave = null) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (assignment) {
      const ids = [...new Set([assignment.ownerId, ...assignment.collaboratorIds].filter(id => id !== null))];
      const active = await db.query("SELECT id FROM usuarios WHERE id=ANY($1::integer[]) AND activo=TRUE FOR SHARE", [ids]);
      if (active.rows.length !== ids.length) {
        const error = new Error("Una de las personas seleccionadas dejó de estar disponible.");
        error.status = 400;
        throw error;
      }
    }
    const result = await db.query(sql, values);
    if (result.rows[0] && assignment) await replaceTaskAssignments(db, result.rows[0].id, assignment);
    if (result.rows[0] && afterSave) await afterSave(db, result.rows[0]);
    result.rows = await annotateTaskAssignments(db, result.rows);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
