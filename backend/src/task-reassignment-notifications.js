import { SYSTEM_USER_ROLES } from './user-roles.js';

const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const fail=(message,status=401)=>Object.assign(new Error(message),{status});

// Capture before leasing a connection; later caller mutations cannot change
// the authority or the row whose previous memberships we observe.
export function captureAssignmentNotification(options) {
  const auth=options.assignmentNotificationActor;
  if (!positive(auth?.id)||!positive(auth.session_version)||!SYSTEM_USER_ROLES.includes(auth.rol))
    throw fail('Sesión de reasignación inválida.');
  if (!positive(options.assignmentNotificationTaskId)) throw fail('Tarea de reasignación inválida.',400);
  return Object.freeze({id:auth.id,rol:auth.rol,session_version:auth.session_version,taskId:options.assignmentNotificationTaskId});
}

export async function lockAssignmentNotificationActor(db,capture) {
  const user=(await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE',[capture.id])).rows[0];
  if (!user||user.id!==capture.id||user.activo!==true||user.rol!==capture.rol||user.session_version!==capture.session_version)
    throw fail('La sesión de reasignación ya no está autorizada.');
  return Object.freeze({actorId:user.id,actor:user.nombre||user.usuario});
}

export async function readAssignmentNotificationMembers(db,taskId) {
  const rows=(await db.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo',[taskId])).rows;
  let ownerId=null;
  const collaborators=new Set();
  for (const row of rows) {
    if (!positive(row.usuario_id)||!['responsable','colaborador'].includes(row.tipo)) throw fail('Asignación almacenada inválida.',409);
    if (row.tipo==='responsable') {
      if (ownerId!==null) throw fail('Responsable almacenado ambiguo.',409);
      ownerId=row.usuario_id;
    } else collaborators.add(row.usuario_id);
  }
  if (collaborators.has(ownerId)) throw fail('Asignación almacenada ambigua.',409);
  return Object.freeze({ownerId,collaboratorIds:Object.freeze([...collaborators].sort((a,b)=>a-b))});
}

function frozenClone(value) {
  if (value===null||typeof value!=='object') return value;
  // node-postgres returns timestamp columns as mutable Date instances. Preserve
  // their instant as an immutable ISO string in this internal event snapshot.
  if (value instanceof Date) return value.toISOString();
  return Object.freeze(Array.isArray(value)?value.map(frozenClone)
    :Object.fromEntries(Object.entries(value).map(([key,child])=>[key,frozenClone(child)])));
}

export function buildAssignmentNotification(task,previous,next,actor) {
  const ids=new Set();
  if (next.ownerId!==null&&next.ownerId!==previous.ownerId) ids.add(next.ownerId);
  const priorCollaborators=new Set(previous.collaboratorIds);
  for (const id of next.collaboratorIds) if (!priorCollaborators.has(id)) ids.add(id);
  return Object.freeze({tarea:frozenClone(task),destinatarioIds:Object.freeze([...ids].sort((a,b)=>a-b)),
    actorId:actor.actorId,actor:actor.actor});
}
