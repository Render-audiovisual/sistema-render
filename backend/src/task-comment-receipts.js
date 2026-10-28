import { createHash } from 'node:crypto';
import { bindCapturedOwnerProfileAuthority, captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';
import { buildTaskAccessClause } from './task-access.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function captureActor(auth) {
  const { id, rol, session_version } = auth ?? {};
  if (!positive(id) || !positive(session_version) || typeof rol !== 'string' || !rol.trim()) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  return bindCapturedOwnerProfileAuthority(auth, Object.freeze({ id, rol, session_version }));
}
function requestKey(value, required) {
  if (value === undefined) {
    if (required) throw fail(428, 'Falta el identificador del intento de comentario.');
    return null;
  }
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw fail(400, 'El identificador del intento no es válido.');
  }
  return value.toLowerCase();
}
function target(taskId, workspace) {
  if (!positive(taskId) || !['render_os', 'historical'].includes(workspace)) throw fail(400, 'Contexto de tarea inválido.');
  return Object.freeze({ taskId, workspace });
}
function text(value) {
  if (typeof value !== 'string' || value.includes('\u0000') || !value.trim()) throw fail(400, 'Faltan autor o comentario válidos.');
  return value.trim();
}
const commentDto = row => Object.fromEntries(['id', 'tarea_id', 'autor', 'contenido', 'created_at', 'actor_usuario_id'].map(key => [key, row[key] ?? null]));
const frozenCopy = value => Array.isArray(value) ? Object.freeze(value.map(frozenCopy))
  : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)]))) : value;

async function transaction(pool, observed, key, run) {
  const ownerAuthority = captureOwnerProfileWriteAuthority(observed);
  const db = await pool.connect(); let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await retainCapturedOwnerProfileAuthority(db, ownerAuthority, { lockMode: 'share' });
    const actor = (await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.rol !== observed.rol || actor.session_version !== observed.session_version) {
      throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
    }
    if (key !== null) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [JSON.stringify(['task-comment-create-v1', observed.id, key])]);
    const result = await run(db, actor);
    await db.query('COMMIT'); return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
async function lockTask(db, actor, input) {
  const workspaceClause = input.workspace === 'render_os' ? "= 'render_os'" : "IS DISTINCT FROM 'render_os'";
  const task = (await db.query(`SELECT id,titulo,asignado_a,cliente_id,prioridad,propiedades_extra,
    to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,revision FROM tareas WHERE id=$1
    AND propiedades_extra->>'workspace' ${workspaceClause} FOR SHARE`, [input.taskId])).rows[0];
  if (!task || task.id !== input.taskId) throw fail(404, 'Tarea no encontrada.');
  // A fresh READ COMMITTED statement AFTER the task lock sees assignments
  // committed while waiting. Never authorize from the joined lock snapshot.
  const access = buildTaskAccessClause(actor, 't', '$2');
  const allowed = (await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1${access.sql}`,
    access.value === null ? [input.taskId] : [input.taskId, access.value])).rows[0];
  if (!allowed || allowed.id !== input.taskId) throw fail(404, 'Tarea no encontrada.');
  return frozenCopy(task);
}
async function receipt(db, actorId, key) {
  return (await db.query(`SELECT payload_hash,tarea_id,comment_id,workspace FROM task_comment_create_receipts
    WHERE actor_user_id=$1 AND request_id=$2`, [actorId, key])).rows[0];
}
async function retainedComment(db, previous) {
  const row = (await db.query(`SELECT id,tarea_id,autor,contenido,created_at,actor_usuario_id FROM tarea_comentarios
    WHERE id=$1 AND tarea_id=$2 FOR SHARE`, [previous.comment_id, previous.tarea_id])).rows[0];
  if (!row) throw fail(409, 'El comentario creado ya no está disponible. No se volvió a crear.');
  return commentDto(row);
}

export async function createTaskComment(pool, auth, { taskId, workspace, requestId, payload } = {}) {
  // All caller-owned primitives and the versioned hash are captured before lease.
  const observed = captureActor(auth), input = target(taskId, workspace), key = requestKey(requestId, false);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['autor', 'contenido'].includes(k))) {
    throw fail(400, 'Datos de comentario inválidos.');
  }
  const contenido = text(payload.contenido), autor = observed.rol === 'admin' ? text(payload.autor) : null;
  const hash = createHash('sha256').update(JSON.stringify({ contract: 'task-comment-create-v1',
    taskId: input.taskId, workspace: input.workspace, contenido, autor })).digest('hex');
  return transaction(pool, observed, key, async (db, actor) => {
    const task = await lockTask(db, actor, input);
    if (key !== null) {
      const previous = await receipt(db, observed.id, key);
      if (previous) {
        if (previous.payload_hash !== hash || previous.tarea_id !== input.taskId || previous.workspace !== input.workspace) {
          throw fail(409, 'Ese intento ya confirmó otro comentario.');
        }
        return { comment: await retainedComment(db, previous), requestId: key, replayed: true, notification: null };
      }
    }
    const name = autor ?? ((typeof actor.nombre === 'string' ? actor.nombre.trim() : '')
      || (typeof actor.usuario === 'string' ? actor.usuario.trim() : ''));
    if (!name) throw fail(400, 'Falta el autor del comentario.');
    const assignments = (await db.query('SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [input.taskId])).rows;
    // Internal post-commit context only. Never resolve historical labels or
    // invoke either notifier while holding the actor/task transaction locks.
    const notification = Object.freeze({ tarea: task,
      destinatarioIds: Object.freeze([...new Set(assignments.map(row => row.usuario_id))].sort((a, b) => a - b)),
      actorId: actor.id,
      actor: (typeof actor.nombre === 'string' ? actor.nombre.trim() : '') || (typeof actor.usuario === 'string' ? actor.usuario.trim() : ''),
    });
    const created = (await db.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido,actor_usuario_id) VALUES($1,$2,$3,$4)
      RETURNING id,tarea_id,autor,contenido,created_at,actor_usuario_id`, [input.taskId, name, contenido, actor.id])).rows[0];
    if (!created) throw new Error('No se pudo verificar el comentario creado.');
    if (key !== null) await db.query(`INSERT INTO task_comment_create_receipts(actor_user_id,request_id,payload_hash,tarea_id,comment_id,workspace)
      VALUES($1,$2,$3,$4,$5,$6)`, [observed.id, key, hash, input.taskId, created.id, input.workspace]);
    return { comment: commentDto(created), requestId: key, replayed: false, notification };
  });
}

export async function findTaskCommentCreation(pool, auth, { taskId, workspace, requestId } = {}) {
  const observed = captureActor(auth), input = target(taskId, workspace), key = requestKey(requestId, true);
  return transaction(pool, observed, key, async (db, actor) => {
    await lockTask(db, actor, input);
    const previous = await receipt(db, observed.id, key);
    if (!previous || previous.tarea_id !== input.taskId || previous.workspace !== input.workspace) throw fail(404, 'No se encontró ese intento de comentario.');
    return { ...await retainedComment(db, previous), creation_request_id: key };
  });
}
