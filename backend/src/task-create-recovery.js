import {captureAssignmentNotification,lockAssignmentNotificationActor} from './task-reassignment-notifications.js';
import {taskCreateRequestId,readTaskCreateReceiptTask} from './task-create-receipts.js';
import {annotateTaskAssignments} from './task-assignments.js';

// A missing receipt is not proof that a pending POST cannot still commit.
// Caller must retain its uncertain attempt rather than infer another creation.
export async function readTaskCreationAttempt(pool,auth,rawRequestId,query={}){
  const requestId=taskCreateRequestId(rawRequestId);
  if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).length)
    throw Object.assign(new Error('La verificación no admite filtros.'),{status:400});
  const actor=captureAssignmentNotification({assignmentNotificationActor:auth,assignmentNotificationMode:'created'});
  const db=await pool.connect();let discard;
  try{
    await db.query('BEGIN');
    await lockAssignmentNotificationActor(db,actor);
    const receipt=(await db.query('SELECT task_id,task_revision FROM task_create_receipts WHERE actor_user_id=$1 AND request_id=$2',[actor.id,requestId])).rows[0];
    if(!receipt)throw Object.assign(new Error('El intento guardado no está disponible.'),{status:404});
    const [task]=await annotateTaskAssignments(db,[await readTaskCreateReceiptTask(db,receipt)]);
    await db.query('COMMIT');
    return {task,requestId};
  }catch(error){
    try{await db.query('ROLLBACK');}catch(rollbackError){discard=rollbackError;}
    if(error.status===404)throw Object.assign(new Error('El intento guardado no está disponible.'),{status:404});
    throw error;
  }
  finally{db.release(discard);}
}
