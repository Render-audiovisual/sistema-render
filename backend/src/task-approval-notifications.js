import {captureAssignmentNotification,lockAssignmentNotificationActor,
  readAssignmentNotificationMembers,buildAssignmentNotification} from './task-reassignment-notifications.js';

// Caller already retained this actor before its task UPDATE, verified approval
// of the exact delivery, and still holds that task lock. Prepare data only;
// notification transport must run after the caller successfully commits.
export async function prepareTaskApprovalNotification(db, task, observed) {
  const snapshot = structuredClone(task);
  const capture = captureAssignmentNotification({assignmentNotificationActor: observed,
    assignmentNotificationTaskId: snapshot?.id});
  if (capture.rol !== 'admin') throw Object.assign(new Error('Solo administración puede aprobar el trabajo.'), {status:403});
  const properties = snapshot?.propiedades_extra;
  if (snapshot.estado !== 'aprobada' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
    || properties?.workspace !== 'render_os' || properties.revision_aprobada !== true
    || ['archivada_render_os','papelera_render_os'].some(key => [true,'true'].includes(properties[key]))) {
    throw Object.assign(new Error('La aprobación efectiva cambió antes de preparar el aviso.'), {status:409});
  }
  const actor = await lockAssignmentNotificationActor(db, capture);
  const members = await readAssignmentNotificationMembers(db, capture.taskId);
  // A decision concerns all current assignments, not only a reassignment delta.
  return buildAssignmentNotification(snapshot, {ownerId:null,collaboratorIds:[]}, members, actor);
}
