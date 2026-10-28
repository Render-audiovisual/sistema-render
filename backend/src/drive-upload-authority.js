import { buildTaskAccessClause } from './task-access.js';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { captureOwnerProfileWriteAuthority } from './owner-profile-authority.js';

export const driveError = (status, code, message = 'No se pudo completar la operación de Drive.') => Object.assign(new Error(message), { status, code, retryable: false });
export const driveId = value => typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value) && !value.includes('\n');
export function validDriveUploadUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.googleapis.com' && !u.port && !u.username && !u.password && !u.hash && u.pathname === '/upload/drive/v3/files'; } catch { return false; }
}
export function validateDriveBag(task) {
  const bag = task?.propiedades_extra;
  if (task && (!bag || typeof bag !== 'object' || Array.isArray(bag) || (Object.hasOwn(bag, 'drive_archivos') && !Array.isArray(bag.drive_archivos))))
    throw driveError(409, 'DRIVE_METADATA_INVALID');
}
export async function withDriveAuthority(pool, auth, { taskId = null, admin = false } = {}, operation) {
  const id = auth?.id, version = auth?.session_version;
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(version) || version < 1) throw driveError(401, 'DRIVE_SESSION_INVALID');
  // Retired UI integration: do not mint actor-only provider capabilities from
  // a delegated session. Existing direct-account integrations remain intact.
  if (captureOwnerProfileWriteAuthority(auth) !== null) throw driveError(403,'DRIVE_DELEGATION_UNSUPPORTED');
  const db = await pool.connect(); let begun = false, releaseError;
  try {
    await db.query('BEGIN'); begun = true;
    const actor = (await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [id])).rows[0];
    if (!actor || actor.id !== id || actor.activo !== true || actor.session_version !== version) throw driveError(401, 'DRIVE_SESSION_INVALID');
    if (!SYSTEM_USER_ROLES.includes(actor.rol) || (admin && actor.rol !== 'admin')) throw driveError(403, 'DRIVE_ACCESS_DENIED');
    let task = null;
    if (taskId !== null) {
      if (!Number.isSafeInteger(taskId) || taskId < 1) throw driveError(400, 'DRIVE_TASK_INVALID');
      task = (await db.query('SELECT t.*,c.nombre AS cliente_nombre FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.id=$1 FOR UPDATE OF t', [taskId])).rows[0];
      if (!task || task.propiedades_extra?.workspace !== 'render_os' || [true,'true'].includes(task.propiedades_extra?.archivada_render_os) || [true,'true'].includes(task.propiedades_extra?.papelera_render_os)) throw driveError(404, 'DRIVE_TASK_NOT_FOUND');
      if (actor.rol !== 'admin') await db.query('SELECT tarea_id FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2 FOR SHARE', [taskId, actor.id]);
      const access = buildTaskAccessClause(actor, 't', '$2');
      const args = access.value === null ? [taskId] : [taskId, access.value];
      if (!(await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1${access.sql}`, args)).rows.length) throw driveError(403, 'DRIVE_ACCESS_DENIED');
      validateDriveBag(task);
    }
    const result = await operation({ db, actor, task });
    await db.query('COMMIT'); begun = false; return result;
  } catch (error) {
    if (begun) try { await db.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { db.release(releaseError); }
}

// Factory and operation share one deadline; late provider completion cannot write SQL.
export async function boundedDriveProvider(factory, db, timeoutMs, operation) {
  const controller = new AbortController(); let timer;
  const queries = new Set();
  const scopedDb = { query: (...args) => {
    controller.signal.throwIfAborted();
    const query = Promise.resolve(db.query(...args)); queries.add(query);
    query.then(() => queries.delete(query), () => queries.delete(query)); return query;
  } };
  const work = (async () => {
    const provider = await factory({ db: scopedDb, signal: controller.signal });
    if (controller.signal.aborted) throw driveError(409, 'DRIVE_UPLOAD_UNCERTAIN');
    return operation(provider);
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(driveError(409, 'DRIVE_UPLOAD_UNCERTAIN')); }, Math.min(15000, Math.max(1, timeoutMs))); })]);
  } finally { clearTimeout(timer); controller.abort(); await Promise.allSettled([...queries]); }
}
