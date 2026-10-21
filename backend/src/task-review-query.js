import { createHash } from 'node:crypto';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { TASK_STATES, normalizeTaskState } from './workflow-contract.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const validSnapshot = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const alias = value => {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(value) || /\s/.test(value)) throw new TypeError('Invalid internal task SQL alias');
  return value;
};
const placeholder = value => {
  if (typeof value !== 'string' || !/^\$[1-9][0-9]*$/.test(value) || /\s/.test(value)) throw new TypeError('Invalid internal task SQL placeholder');
  return value;
};

// Only this historical boolean approval changes the read projection. In
// particular, task `publicada` remains untouched in Home's historical counts.
export function effectiveTaskStateSql(taskAlias = 't') {
  const t = alias(taskAlias);
  return `CASE WHEN ${t}.estado='en_revision' AND ${t}.propiedades_extra->'revision_aprobada'='true'::jsonb THEN 'aprobada' ELSE ${t}.estado END`;
}
export function taskLiveVisibilitySql(taskAlias = 't', clientAlias = 'c') {
  const t = alias(taskAlias), c = alias(clientAlias);
  return `${t}.propiedades_extra->>'workspace'='render_os'
    AND COALESCE(${t}.propiedades_extra->>'archivada_render_os','false')<>'true'
    AND COALESCE(${t}.propiedades_extra->>'papelera_render_os','false')<>'true'
    AND (${t}.cliente_id IS NULL OR ${c}.activo IS DISTINCT FROM FALSE)`;
}
// Home filters an already projected state; GET filters the raw task with the
// same effective-state expression. Neither interprets approval as publication.
export function taskReviewStateSql({ taskAlias = 't', projected = false } = {}) {
  if (projected) return `${taskAlias === null ? '' : `${alias(taskAlias)}.`}estado='${TASK_STATES.IN_REVIEW}'`;
  return `(${effectiveTaskStateSql(taskAlias)})='${TASK_STATES.IN_REVIEW}'`;
}
export function taskReviewMembershipSql(taskAlias = 't', actorPlaceholder = '$1') {
  return `EXISTS ( SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=${alias(taskAlias)}.id AND a.usuario_id=${placeholder(actorPlaceholder)})`;
}

// Main may use this for the general GET state filter. Keep the existing legacy
// `publicada` -> finalized input alias, but compare against BOTH persisted finals.
export function parseTaskStateRead(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || ![...Object.values(TASK_STATES),'publicada'].includes(value)) throw fail(400, 'Estado de tareas no válido.');
  return normalizeTaskState(value) === TASK_STATES.FINALIZED ? ['finalizada','publicada'] : [value];
}
export function parseTaskReviewRead(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw fail(400, 'Filtros de revisión no válidos.');
  const scope = query.review_scope, snapshot = query.expected_review_snapshot;
  if (scope === undefined) {
    if (Object.hasOwn(query,'expected_review_snapshot')) throw fail(400, 'La versión de revisión requiere una cola de revisión.');
    return null;
  }
  if (typeof scope !== 'string' || !['personal','team'].includes(scope) || query.workspace !== 'render_os') throw fail(400, 'Alcance de revisión no válido.');
  if (snapshot !== undefined && !validSnapshot(snapshot)) throw fail(400, 'La versión de la cola de revisión no es válida.');
  for (const key of ['incluir_archivadas','solo_archivadas','papelera']) {
    const value = query[key];
    if (value !== undefined && (typeof value !== 'string' || !['false','true'].includes(value) || value === 'true')) throw fail(400, 'La cola de revisión no incluye archivo ni papelera.');
  }
  if (query.estado !== undefined && query.estado !== TASK_STATES.IN_REVIEW) throw fail(400, 'El estado contradice la cola de revisión.');
  if (query.sort !== undefined && query.sort !== 'date') throw fail(400, 'La cola de revisión usa orden por fecha.');
  if (query.expected_snapshot !== undefined) throw fail(400, 'La revisión no usa versiones del orden manual.');
  for (const key of ['asignado_a','asignado_a_id','cliente_id','tipo_tarea','prioridad','q','area','sector','historia_id','publicacion_id']) {
    if (Object.hasOwn(query,key) && typeof query[key] !== 'string') throw fail(400, 'Los filtros de revisión deben ser escalares.');
  }
  for (const key of ['asignado_a_id','cliente_id','historia_id','publicacion_id']) {
    const value = query[key];
    if (value === undefined || (key === 'cliente_id' && value === 'none')) continue;
    if (!/^[1-9][0-9]*$/.test(value) || /\s/.test(value) || !positive(Number(value))) throw fail(400, 'ID de filtro de revisión no válido.');
  }
  // Additional canonical client/responsible/sector/priority/search/area filters
  // remain intersections applied by the existing GET query builder.
  return { scope, snapshot };
}
export function buildTaskReviewClause({ scope, auth, taskAlias = 't', clientAlias = 'c', placeholder: actorPlaceholder = '$1' }) {
  if (!['personal','team'].includes(scope)) throw fail(400, 'Alcance de revisión no válido.');
  if (!positive(auth?.id) || auth.activo === false) throw fail(401, 'Necesitás una sesión verificada.');
  if (!SYSTEM_USER_ROLES.includes(auth.rol) || (scope === 'team' && auth.rol !== 'admin')) throw fail(403, 'Solo administración puede consultar la revisión del equipo.');
  const membership = scope === 'personal' ? ` AND ${taskReviewMembershipSql(taskAlias,actorPlaceholder)}` : '';
  return { sql: ` AND ${taskLiveVisibilitySql(taskAlias,clientAlias)} AND ${taskReviewStateSql({taskAlias})}${membership}`, value: scope === 'personal' ? auth.id : null };
}

// query/params are the canonical, fully filtered SELECT before ORDER/LIMIT.
// Main must append buildTaskReviewClause first, retaining all other filters.
// Each page is one RR read observation (not a revocation-blocking row lock).
export async function readTaskReviewPage({ pool, query, params, limit, offset, expectedSnapshot, auth, scope, serialize }) {
  const observed = Object.freeze({ id: auth?.id, rol: auth?.rol, session_version: auth?.session_version });
  if (!positive(observed.id) || !positive(observed.session_version) || typeof observed.rol !== 'string') throw fail(401, 'Volvé a iniciar sesión.');
  if (!['personal','team'].includes(scope)) throw fail(400, 'Alcance de revisión no válido.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw fail(400, 'Paginación de revisión no válida.');
  if (expectedSnapshot !== undefined && !validSnapshot(expectedSnapshot)) throw fail(400, 'La versión de la cola de revisión no es válida.');
  if (offset > 0 && expectedSnapshot === undefined) throw fail(400, 'Actualizá la primera página de revisiones antes de continuar.');
  if (typeof query !== 'string' || !query.trim() || !Array.isArray(params) || typeof serialize !== 'function') throw new TypeError('Invalid internal task review page query');
  const values = structuredClone(params);
  const db = await pool.connect(); let releaseError;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.session_version !== observed.session_version || actor.rol !== observed.rol) throw fail(401, 'La sesión cambió. Volvé a verificar el acceso.');
    if (!SYSTEM_USER_ROLES.includes(actor.rol) || (scope === 'team' && actor.rol !== 'admin')) throw fail(403, 'Solo administración puede consultar la revisión del equipo.');
    const summary = (await db.query(`SELECT COUNT(*)::int AS total,
      COALESCE(json_agg(json_build_array(id,revision,
        (SELECT COALESCE(json_agg(json_build_array(a.usuario_id,a.tipo) ORDER BY a.usuario_id,a.tipo)::text,'[]')
          FROM tarea_asignaciones a WHERE a.tarea_id=candidates.id)) ORDER BY id)::text,'[]') AS signature
      FROM (${query}) AS candidates`,values)).rows[0];
    if (!Number.isSafeInteger(summary?.total) || summary.total < 0 || typeof summary.signature !== 'string') throw new Error('Invalid task review collection summary');
    const snapshot = createHash('sha256').update(JSON.stringify({ version:1,actor:observed,scope,query,params:values,signature:summary.signature })).digest('hex');
    if (expectedSnapshot !== undefined && expectedSnapshot !== snapshot) throw fail(409, 'La cola cambió. Actualizá la primera página de revisiones antes de continuar.');
    const index = values.length+1;
    const page = await db.query(`SELECT candidates.* FROM (${query}) AS candidates
      ORDER BY candidates.fecha_vencimiento ASC NULLS LAST,candidates.id ASC LIMIT $${index} OFFSET $${index+1}`, [...values,limit,offset]);
    const rows = page.rows.map(({total_count,...row})=>row), items = await serialize(db,rows);
    if (!Array.isArray(items) || items.length !== rows.length || items.length > limit) throw new Error('Invalid task review page projection');
    await db.query('COMMIT'); return {items,total:summary.total,snapshot};
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { db.release(releaseError); }
}
