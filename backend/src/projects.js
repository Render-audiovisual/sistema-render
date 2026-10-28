import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { effectiveTaskStateSql } from './task-review-query.js';
import { projectDomainConflict } from './project-errors.js';
import { bindCapturedOwnerProfileAuthority, captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';
import { approveProjectDeliverable, PROJECT_DELIVERABLE_READ_SQL, projectDeliverableDto } from './project-deliverable-approvals.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const own = (o, k) => Object.hasOwn(o, k);
const TYPES = ['web', 'chatbot', 'mantenimiento', 'automatizacion', 'otro'];
const STATES = ['planificado', 'en_curso', 'en_revision', 'pausado', 'finalizado', 'cancelado'];
const CHILDREN = {
  etapas: { table: 'proyecto_etapas', singular: 'etapa', cap: 100, states: ['pendiente', 'en_progreso', 'completada'], fields: ['titulo', 'estado'] },
  hitos: { table: 'proyecto_hitos', singular: 'hito', cap: 200, states: ['pendiente', 'completado', 'cancelado'], fields: ['titulo', 'fecha', 'estado', 'etapa_id'] },
  entregables: { table: 'proyecto_entregables', singular: 'entregable', cap: 200, states: ['pendiente', 'en_revision', 'aprobado', 'correcciones'], fields: ['titulo', 'url', 'observaciones', 'estado'] },
};
const VISIBLE = `t.propiedades_extra->>'workspace'='render_os'
 AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
 AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
 AND (t.cliente_id IS NULL OR EXISTS(SELECT 1 FROM clientes tc WHERE tc.id=t.cliente_id AND tc.activo IS DISTINCT FROM FALSE))`;
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Se requiere un objeto.');
  return value;
}
function closed(value, keys) {
  object(value);
  if (Object.keys(value).some(k => !keys.includes(k))) throw fail('Campo no permitido.');
}
function integer(value, label = 'ID') {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw fail(`${label} inválido.`);
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw fail('UUID inválido.');
  return value.toLowerCase();
}
function text(value, max = 250, empty = false) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw fail('Texto inválido.');
  const result = value.trim();
  if ((!empty && !result) || result.length > max) throw fail('Longitud de texto inválida.');
  return result;
}
function enumeration(value, allowed) {
  if (!allowed.includes(value)) throw fail('Estado o tipo inválido.');
  return value;
}
function date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail('Fecha inválida.');
  return value;
}
function safeUrl(value) {
  const result = text(value, 4000, true);
  if (!result) return result;
  let parsed;
  try { parsed = new URL(result); } catch { throw fail('URL inválida.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /\s/.test(result)) throw fail('URL inválida.');
  return result;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 200) throw fail('Integrantes inválidos.');
  const result = value.map(v => integer(v));
  if (new Set(result).size !== result.length) throw fail('IDs duplicados.');
  return result.sort((a, b) => a - b);
}
function datesCompatible(value) {
  if (value.fecha_inicio && value.fecha_entrega && value.fecha_inicio > value.fecha_entrega) throw fail('La entrega no puede ser anterior al inicio.');
}

export function normalizeProjectInput(input, { create = false } = {}) {
  closed(input, create
    ? ['request_id', 'titulo', 'cliente_id', 'responsable_id', 'tipo', 'descripcion', 'fecha_inicio', 'fecha_entrega', 'miembro_ids']
    : ['expected_revision', 'titulo', 'cliente_id', 'responsable_id', 'tipo', 'descripcion', 'estado', 'fecha_inicio', 'fecha_entrega', 'miembro_ids', 'archivado']);
  const result = {};
  if (create) result.request_id = uuid(input.request_id);
  else result.expected_revision = integer(input.expected_revision, 'Revisión');
  for (const key of ['titulo', 'descripcion', 'tipo', 'estado', 'cliente_id', 'responsable_id', 'fecha_inicio', 'fecha_entrega', 'miembro_ids', 'archivado']) {
    if (!own(input, key)) continue;
    const v = input[key];
    if (key === 'titulo') result[key] = text(v);
    else if (key === 'descripcion') result[key] = text(v, 20000, true);
    else if (key === 'tipo') result[key] = enumeration(v, TYPES);
    else if (key === 'estado') result[key] = enumeration(v, STATES);
    else if (key.endsWith('_id')) result[key] = integer(v);
    else if (key.startsWith('fecha_')) result[key] = date(v);
    else if (key === 'miembro_ids') result[key] = ids(v);
    else { if (typeof v !== 'boolean') throw fail('Archivado inválido.'); result[key] = v; }
  }
  if (create) {
    for (const key of ['titulo', 'cliente_id', 'responsable_id', 'tipo']) if (!own(result, key)) throw fail(`Falta ${key}.`);
    result.descripcion ??= ''; result.fecha_inicio ??= null; result.fecha_entrega ??= null; result.miembro_ids ??= [];
  } else if (Object.keys(result).length === 1) throw fail('No hay cambios.');
  datesCompatible(result);
  return result;
}

export function projectRequestHash(input) {
  const { request_id, ...business } = normalizeProjectInput(input, { create: true });
  const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  return createHash('sha256').update(JSON.stringify(stable(business))).digest('hex');
}

export function projectPermissions(project, user) {
  const valid = user?.activo === true && SYSTEM_USER_ROLES.includes(user.rol) && Number.isSafeInteger(user.id) && user.id > 0;
  return { administrar: Boolean(valid && user.rol === 'admin'), editar: Boolean(valid && !project.archivado && (user.rol === 'admin' || project.responsable_id === user.id)) };
}

export function normalizeProjectChild(kind, input, { create = false } = {}) {
  const spec = CHILDREN[kind];
  if (!spec) throw fail('Recurso inválido.');
  closed(input, ['expected_revision', ...(create ? ['request_id'] : []), ...spec.fields]);
  if (create && input.request_id === undefined) throw fail('Falta request_id.', 428);
  if (kind === 'entregables' && input.estado === 'aprobado') throw fail('Usá la acción explícita de aprobar la versión observada.');
  const result = { expected_revision: integer(input.expected_revision, 'Revisión') };
  if (create) result.request_id = uuid(input.request_id);
  for (const key of spec.fields) {
    if (!own(input, key)) continue;
    const v = input[key];
    result[key] = key === 'titulo' ? text(v) : key === 'estado' ? enumeration(v, spec.states)
      : key === 'fecha' ? date(v) : key === 'etapa_id' ? (v === null ? null : uuid(v))
        : key === 'url' ? safeUrl(v) : text(v, 20000, true);
  }
  if (create && !own(result, 'titulo')) throw fail('Falta titulo.');
  if (create && kind === 'etapas' && own(input, 'estado')) throw fail('La etapa nueva comienza pendiente.');
  if (!create && Object.keys(result).length === 1) throw fail('No hay cambios.');
  return result;
}

export function projectChildCreationHash(projectId, kind, normalizedInput) {
  const { request_id, ...input } = normalizedInput;
  return createHash('sha256').update(JSON.stringify([projectId, kind,
    Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]]))])).digest('hex');
}

const summarySql = `SELECT p.id,p.titulo,p.cliente_id,c.nombre AS cliente_nombre,p.responsable_id,u.nombre AS responsable_nombre,
 p.tipo,p.estado,to_char(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,to_char(p.fecha_entrega,'YYYY-MM-DD') AS fecha_entrega,
 p.archivado,p.revision,p.descripcion,
 (SELECT count(*)::int FROM proyecto_tareas x WHERE x.proyecto_id=p.id) AS tareas,
 (SELECT count(*)::int FROM proyecto_tareas x JOIN tareas t ON t.id=x.tarea_id WHERE x.proyecto_id=p.id AND ${VISIBLE}) AS tareas_visibles,
 (SELECT count(*)::int FROM proyecto_tareas x JOIN tareas t ON t.id=x.tarea_id WHERE x.proyecto_id=p.id AND ${VISIBLE} AND t.estado IN ('finalizada','publicada')) AS finalizadas,
 (SELECT count(*)::int FROM proyecto_hitos x WHERE x.proyecto_id=p.id) AS hitos,
 (SELECT count(*)::int FROM proyecto_entregables x WHERE x.proyecto_id=p.id) AS entregables
 FROM proyectos p JOIN clientes c ON c.id=p.cliente_id JOIN usuarios u ON u.id=p.responsable_id`;

export function projectSummaryDto(row) {
  return { id: row.id, titulo: row.titulo, cliente: { id: row.cliente_id, nombre: row.cliente_nombre },
    responsable: { id: row.responsable_id, nombre: row.responsable_nombre }, tipo: row.tipo, estado: row.estado,
    fecha_inicio: row.fecha_inicio, fecha_entrega: row.fecha_entrega, archivado: row.archivado, revision: row.revision,
    counts: { tareas: Number(row.tareas), finalizadas: Number(row.finalizadas), hitos: Number(row.hitos), entregables: Number(row.entregables) }, href: `/proyectos?proyecto=${row.id}` };
}
const pick = (row, fields) => Object.fromEntries(fields.map(k => [k, row[k] ?? null]));

export async function readProjectDetail(db, id, user) {
  const row = (await db.query(`${summarySql} WHERE p.id=$1`, [id])).rows[0];
  if (!row) throw fail('Proyecto no encontrado.', 404);
  const query = async (sql, fields) => (await db.query(sql, [id])).rows.map(r => pick(r, fields));
  const miembro_ids = (await db.query('SELECT usuario_id FROM proyecto_miembros WHERE proyecto_id=$1 ORDER BY usuario_id', [id])).rows.map(r => r.usuario_id);
  const etapas = await query('SELECT id,titulo,posicion,estado FROM proyecto_etapas WHERE proyecto_id=$1 ORDER BY posicion,id LIMIT 100', ['id', 'titulo', 'posicion', 'estado']);
  const hitos = await query("SELECT id,etapa_id,titulo,to_char(fecha,'YYYY-MM-DD') AS fecha,estado FROM proyecto_hitos WHERE proyecto_id=$1 ORDER BY fecha NULLS LAST,id LIMIT 200", ['id', 'etapa_id', 'titulo', 'fecha', 'estado']);
  const entregables = (await db.query(`${PROJECT_DELIVERABLE_READ_SQL} WHERE d.proyecto_id=$1 ORDER BY d.id LIMIT 200`,[id])).rows.map(projectDeliverableDto);
  const tareas = (await query(`SELECT t.id,t.titulo,${effectiveTaskStateSql('t')} AS estado,t.prioridad,t.revision,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,x.etapa_id
    FROM proyecto_tareas x JOIN tareas t ON t.id=x.tarea_id WHERE x.proyecto_id=$1 AND ${VISIBLE} ORDER BY t.id LIMIT 200`, ['id', 'titulo', 'estado', 'prioridad', 'revision', 'fecha_vencimiento', 'etapa_id'])).map(t => ({ ...t, href: `/workspace/tareas?task=${t.id}` }));
  const actividad = await query('SELECT id,actor_id,accion,created_at,recurso_id,tarea_id,estado_anterior,estado_nuevo FROM proyecto_actividad WHERE proyecto_id=$1 ORDER BY id DESC LIMIT 20', ['id', 'actor_id', 'accion', 'created_at', 'recurso_id', 'tarea_id', 'estado_anterior', 'estado_nuevo']);
  return { ...projectSummaryDto(row), descripcion: row.descripcion, miembro_ids, etapas, hitos, entregables, tareas,
    tareas_no_disponibles: Number(row.tareas) - Number(row.tareas_visibles), actividad, permissions: projectPermissions(row, user) };
}

// Shared API serialization. SQL reverse guards use task rows, never this key.
export async function lockProjectLinks(db, { tasks = false } = {}) {
  if (tasks) await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('proyecto-vinculos'))");
}
async function actor(db, auth, write) {
  if (!Number.isSafeInteger(auth?.id) || auth.id <= 0 || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
  const user = (await db.query(`SELECT id,nombre,rol,activo,session_version FROM usuarios WHERE id=$1${write ? ' FOR SHARE' : ''}`, [auth.id])).rows[0];
  if (!user || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
  if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso a proyectos.', 403);
  return user;
}
async function lockProject(db, id, revision, user, reactivation = false) {
  const row = (await db.query("SELECT id,responsable_id,cliente_id,estado,archivado,revision,to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,to_char(fecha_entrega,'YYYY-MM-DD') AS fecha_entrega FROM proyectos WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!row) throw fail('Proyecto no encontrado.', 404);
  const permissions = projectPermissions(row, user);
  if (!permissions.editar && !(reactivation && permissions.administrar)) throw fail('No podés editar este proyecto.', 403);
  if (revision !== null && row.revision !== revision) throw fail('El proyecto cambió. Actualizá antes de reintentar.', 409);
  return row;
}
async function activeClient(db, id) {
  if (!(await db.query('SELECT id FROM clientes WHERE id=$1 AND activo IS DISTINCT FROM FALSE FOR SHARE', [id])).rows.length) throw fail('Cliente no disponible.', 400);
}
async function activeUsers(db, values) {
  const selected = [...new Set(values)].sort((a, b) => a - b);
  const rows = (await db.query('SELECT id,rol,activo FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE', [selected])).rows;
  if (rows.length !== selected.length || rows.some(u => !u.activo || !SYSTEM_USER_ROLES.includes(u.rol))) throw fail('Usuario no disponible.', 400);
}
async function members(db, id, values) {
  await db.query('DELETE FROM proyecto_miembros WHERE proyecto_id=$1', [id]);
  if (values.length) await db.query('INSERT INTO proyecto_miembros(proyecto_id,usuario_id) SELECT $1,unnest($2::int[])', [id, values]);
}
async function activity(db, project, user, action, resource = null, before = null, after = null, task = null) {
  await db.query('INSERT INTO proyecto_actividad(proyecto_id,actor_id,accion,recurso_id,tarea_id,estado_anterior,estado_nuevo) VALUES($1,$2,$3,$4,$5,$6,$7)', [project, user.id, action, resource, task, before, after]);
}
async function bump(db, id, revision, user) {
  if (!(await db.query('UPDATE proyectos SET actualizado_por_id=$3,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING revision', [id, revision, user.id])).rows.length) throw fail('El proyecto cambió.', 409);
}
async function stage(db, project, id) {
  if (id !== null && !(await db.query('SELECT id FROM proyecto_etapas WHERE proyecto_id=$1 AND id=$2', [project, id])).rows.length) throw fail('Etapa no encontrada.', 404);
}

export async function readProjectList(db, user, q = {}) {
  closed(q, ['limit', 'offset', 'estado', 'cliente_id', 'archivados']);
  const num = (v, fallback, min, max) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max) throw fail('Paginación o filtro inválido.');
    return Number(v);
  };
  const limit = num(q.limit, 50, 1, 100), offset = num(q.offset, 0, 0, 2147483647);
  if (q.archivados !== undefined && q.archivados !== 'true' && q.archivados !== 'false') throw fail('Filtro inválido.');
  if (q.archivados === 'true' && user.rol !== 'admin') throw fail('Solo administración puede incluir archivados.', 403);
  const values = [], conditions = q.archivados === 'true' ? [] : ['NOT p.archivado'];
  if (q.estado !== undefined) { values.push(enumeration(q.estado, STATES)); conditions.push(`p.estado=$${values.length}`); }
  if (q.cliente_id !== undefined) { values.push(num(q.cliente_id, null, 1, 2147483647)); conditions.push(`p.cliente_id=$${values.length}`); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const total = Number((await db.query(`SELECT count(*)::int AS total FROM proyectos p${where}`, values)).rows[0].total);
  const rows = (await db.query(`${summarySql}${where} ORDER BY p.fecha_entrega NULLS LAST,p.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset])).rows;
  return { proyectos: rows.map(projectSummaryDto), total, limit, offset };
}

export function createProjectsRouter({ express, pool }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const route = (write, handler) => async (req, res, next) => {
    let db, discard;
    try {
      const observedAuth = bindCapturedOwnerProfileAuthority(req.auth, Object.freeze({id:req.auth?.id,session_version:req.auth?.session_version,rol:req.auth?.rol}));
      const authority = write ? captureOwnerProfileWriteAuthority(observedAuth) : null;
      if (write && req.params?.id !== undefined) uuid(req.params.id);
      db = await pool.connect();
      await db.query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (write) {
        // All writes use the same order, including those that later link tasks.
        await lockProjectLinks(db, { tasks: true });
        await retainCapturedOwnerProfileAuthority(db, authority);
      }
      const user = await actor(db, observedAuth, write);
      const result = await handler(req, db, user);
      await db.query('COMMIT');
      res.status(result.status ?? 200).json(result.body);
    } catch (error) {
      if (db) { try { await db.query('ROLLBACK'); } catch (rollbackError) { discard=rollbackError; } }
      if (error.status) res.status(error.status).json({ error: error.message });
      else if (projectDomainConflict(error)) res.status(409).json({ error: 'La relación del proyecto cambió o no es compatible.' });
      else next(error);
    } finally { db?.release(discard); }
  };
  router.get('/', route(false, async (req, db, user) => ({ body: await readProjectList(db, user, req.query ?? {}) })));
  router.get('/:id', route(false, async (req, db, user) => ({ body: { proyecto: await readProjectDetail(db, uuid(req.params.id), user) } })));
  router.post('/', route(true, async (req, db, user) => {
    const input = normalizeProjectInput(req.body, { create: true }), hash = projectRequestHash(req.body);
    if (user.rol !== 'admin') throw fail('Solo administración puede crear proyectos.', 403);
    await lockProjectLinks(db);
    const old = (await db.query('SELECT id,request_hash FROM proyectos WHERE creado_por_id=$1 AND request_id=$2 FOR UPDATE', [user.id, input.request_id])).rows[0];
    if (old) {
      if (old.request_hash !== hash) throw fail('La clave ya fue usada para otro proyecto.', 409);
      return { body: { proyecto: await readProjectDetail(db, old.id, user), idempotent: true } };
    }
    await activeClient(db, input.cliente_id);
    await activeUsers(db, [input.responsable_id, ...input.miembro_ids]);
    const id = randomUUID();
    await db.query('INSERT INTO proyectos(id,titulo,cliente_id,responsable_id,tipo,descripcion,fecha_inicio,fecha_entrega,creado_por_id,actualizado_por_id,request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)', [id, input.titulo, input.cliente_id, input.responsable_id, input.tipo, input.descripcion, input.fecha_inicio, input.fecha_entrega, user.id, input.request_id, hash]);
    await members(db, id, input.miembro_ids);
    await activity(db, id, user, 'crear_proyecto', id, null, 'planificado');
    return { status: 201, body: { proyecto: await readProjectDetail(db, id, user), idempotent: false } };
  }));
  router.patch('/:id', route(true, async (req, db, user) => {
    const id = uuid(req.params.id), input = normalizeProjectInput(req.body);
    const adminFields = ['cliente_id', 'responsable_id', 'miembro_ids', 'archivado'];
    if (adminFields.some(k => own(input, k)) && user.rol !== 'admin') throw fail('Campo reservado a administración.', 403);
    await lockProjectLinks(db);
    const old = await lockProject(db, id, input.expected_revision, user, input.archivado === false);
    datesCompatible({ ...old, ...input });
    if (own(input, 'cliente_id')) {
      if (input.cliente_id !== old.cliente_id && (await db.query('SELECT tarea_id FROM proyecto_tareas WHERE proyecto_id=$1 LIMIT 1', [id])).rows.length) throw fail('Desvinculá las tareas antes de cambiar el cliente.', 409);
      await activeClient(db, input.cliente_id);
    }
    if (own(input, 'responsable_id') || own(input, 'miembro_ids')) await activeUsers(db, [...(own(input, 'responsable_id') ? [input.responsable_id] : []), ...(input.miembro_ids ?? [])]);
    const entries = Object.entries(input).filter(([k]) => !['expected_revision', 'miembro_ids'].includes(k));
    const values = [id, input.expected_revision, user.id, ...entries.map(([, v]) => v)];
    await db.query(`UPDATE proyectos SET actualizado_por_id=$3,updated_at=clock_timestamp()${entries.map(([k], i) => `,${k}=$${i + 4}`).join('')} WHERE id=$1 AND revision=$2`, values);
    if (own(input, 'miembro_ids')) await members(db, id, input.miembro_ids);
    await activity(db, id, user, 'editar_proyecto', id, old.estado, input.estado ?? old.estado);
    return { body: { proyecto: await readProjectDetail(db, id, user) } };
  }));
  router.post('/:id/entregables/:child/aprobaciones', route(true, async (req,db,user) =>
    approveProjectDeliverable(db,{projectId:req.params.id,deliverableId:req.params.child,input:req.body,user},
      {lockProjectLinks,lockProject,bump,activity,readProjectDetail})));
  for (const [kind, spec] of Object.entries(CHILDREN)) {
    const mutate = create => route(true, async (req, db, user) => {
      const id = uuid(req.params.id);
      const input = normalizeProjectChild(kind, req.body, { create });
      await lockProjectLinks(db);
      let hash;
      if (create) {
        // Permission is current even on replay; the original revision is checked
        // only for a new intent. The global project mutex serializes receipt keys.
        await lockProject(db, id, null, user);
        hash = projectChildCreationHash(id, kind, input);
        const receipt = (await db.query(`SELECT actor_id,request_id,proyecto_id,recurso_tipo,recurso_id,expected_revision,payload_hash
          FROM project_child_create_receipts WHERE actor_id=$1 AND request_id=$2`, [user.id,input.request_id])).rows[0];
        if (receipt) {
          if (receipt.proyecto_id !== id || receipt.recurso_tipo !== kind || receipt.payload_hash !== hash || receipt.expected_revision !== input.expected_revision)
            throw fail('La solicitud ya fue usada para otra creación.',409);
          if (!(await db.query(`SELECT id FROM ${spec.table} WHERE proyecto_id=$1 AND id=$2 FOR SHARE`,[id,receipt.recurso_id])).rows.length)
            throw fail('El recurso creado ya no está disponible.',409);
          const { payload_hash, ...creacion } = receipt;
          return { body: { proyecto: await readProjectDetail(db,id,user), creacion, replayed:true } };
        }
      }
      await lockProject(db, id, input.expected_revision, user);
      const child = create ? randomUUID() : uuid(req.params.child);
      let old = null;
      if (!create) {
        old = (await db.query(`SELECT id,estado FROM ${spec.table} WHERE proyecto_id=$1 AND id=$2 FOR UPDATE`, [id, child])).rows[0];
        if (!old) throw fail('Recurso no encontrado.', 404);
      } else if (Number((await db.query(`SELECT count(*)::int AS total FROM ${spec.table} WHERE proyecto_id=$1`, [id])).rows[0].total) >= spec.cap) throw fail('Límite de recursos alcanzado.', 409);
      if (own(input, 'etapa_id')) await stage(db, id, input.etapa_id);
      const fields = Object.entries(input).filter(([k]) => !['expected_revision','request_id'].includes(k));
      let actualState;
      if (create) {
        if (kind === 'etapas') fields.push(['posicion', Number((await db.query('SELECT COALESCE(max(posicion),-1)+1 AS posicion FROM proyecto_etapas WHERE proyecto_id=$1', [id])).rows[0].posicion)]);
        const values = [child, id, ...fields.map(([, v]) => v)];
        const columns = ['id', 'proyecto_id', ...fields.map(([k]) => k)];
        let placeholders = values.map((_, i) => `$${i + 1}`);
        await db.query(`INSERT INTO ${spec.table}(${columns.join(',')}) VALUES(${placeholders.join(',')})`, values);
      } else {
        const values = [id, child, ...fields.map(([, v]) => v)];
        let approval = '';
        if (kind === 'entregables' && own(input, 'estado')) {
          approval = ',aprobacion_actual_id=NULL,aprobado_por_id=NULL,aprobado_at=NULL';
        }
        const updated = await db.query(`UPDATE ${spec.table} SET ${fields.map(([k], i) => `${k}=$${i + 3}`).join(',')}${approval} WHERE proyecto_id=$1 AND id=$2${kind==='entregables'?' RETURNING estado':''}`, values);
        if(kind==='entregables'){
          if(!updated.rows[0])throw fail('El entregable dejó de estar disponible.',409);
          actualState=updated.rows[0].estado;
        }
      }
      await bump(db, id, input.expected_revision, user);
      await activity(db, id, user, `${create ? 'crear' : 'editar'}_${spec.singular}`, child, old?.estado ?? null, actualState ?? input.estado ?? old?.estado ?? 'pendiente');
      if (create) {
        await db.query(`INSERT INTO project_child_create_receipts(actor_id,request_id,proyecto_id,recurso_tipo,recurso_id,expected_revision,payload_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[user.id,input.request_id,id,kind,child,input.expected_revision,hash]);
        return { status:201, body:{ proyecto:await readProjectDetail(db,id,user),
          creacion:{actor_id:user.id,request_id:input.request_id,proyecto_id:id,recurso_tipo:kind,recurso_id:child,expected_revision:input.expected_revision},replayed:false } };
      }
      return { body: { proyecto: await readProjectDetail(db, id, user) } };
    });
    router.post(`/:id/${kind}`, mutate(true));
    router.patch(`/:id/${kind}/:child`, mutate(false));
  }
  router.put('/:id/etapas/orden', route(true, async (req, db, user) => {
    closed(req.body, ['expected_revision', 'etapa_ids']);
    const id = uuid(req.params.id), revision = integer(req.body.expected_revision);
    if (!Array.isArray(req.body.etapa_ids) || req.body.etapa_ids.length > 100) throw fail('Orden inválido.');
    const order = req.body.etapa_ids.map(uuid);
    if (new Set(order).size !== order.length) throw fail('Etapas duplicadas.');
    await lockProjectLinks(db);
    await lockProject(db, id, revision, user);
    const current = (await db.query('SELECT id FROM proyecto_etapas WHERE proyecto_id=$1 ORDER BY id FOR UPDATE', [id])).rows.map(r => r.id);
    if (current.length !== order.length || current.some(v => !order.includes(v))) throw fail('El orden debe incluir todas las etapas actuales.', 409);
    await db.query('SET CONSTRAINTS proyecto_etapas_posicion_unique DEFERRED');
    await db.query('UPDATE proyecto_etapas e SET posicion=x.n::int-1 FROM unnest($2::uuid[]) WITH ORDINALITY x(id,n) WHERE e.proyecto_id=$1 AND e.id=x.id', [id, order]);
    await bump(db, id, revision, user);
    await activity(db, id, user, 'ordenar_etapas', id);
    return { body: { proyecto: await readProjectDetail(db, id, user) } };
  }));
  const taskLink = unlink => route(true, async (req, db, user) => {
    closed(req.body, unlink ? ['expected_revision'] : ['expected_revision', 'tarea_id', 'expected_tarea_revision', 'etapa_id']);
    const id = uuid(req.params.id), revision = integer(req.body.expected_revision);
    const taskId = unlink ? (/^[1-9]\d*$/.test(req.params.task) ? integer(Number(req.params.task)) : integer(null)) : integer(req.body.tarea_id);
    const taskRevision = unlink ? null : integer(req.body.expected_tarea_revision);
    const stageId = own(req.body, 'etapa_id') && req.body.etapa_id !== null ? uuid(req.body.etapa_id) : null;
    await lockProjectLinks(db, { tasks: true });
    const task = (await db.query('SELECT id,revision,cliente_id FROM tareas WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
    if (!task) throw fail('Tarea no encontrada.', 404);
    const project = await lockProject(db, id, revision, user);
    if (unlink) {
      if (!(await db.query('DELETE FROM proyecto_tareas WHERE proyecto_id=$1 AND tarea_id=$2 RETURNING tarea_id', [id, taskId])).rows.length) throw fail('Vínculo no encontrado.', 404);
    } else {
      if (task.revision !== taskRevision) throw fail('La tarea cambió. Actualizá antes de vincular.', 409);
      if (!(await db.query(`SELECT t.id FROM tareas t WHERE t.id=$1 AND ${VISIBLE}`, [taskId])).rows.length) throw fail('Tarea no disponible.', 404);
      if (task.cliente_id !== project.cliente_id) throw fail('La tarea pertenece a otro cliente.', 409);
      // The named DB predicate is shared with all reciprocal relationship guards.
      await db.query('SELECT proyectos_assert_task_domain(t,$2::int) FROM tareas t WHERE t.id=$1', [taskId, project.cliente_id]);
      await stage(db, id, stageId);
      if (Number((await db.query('SELECT count(*)::int AS total FROM proyecto_tareas WHERE proyecto_id=$1', [id])).rows[0].total) >= 200) throw fail('Límite de tareas alcanzado.', 409);
      await db.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id,etapa_id) VALUES($1,$2,$3)', [id, taskId, stageId]);
    }
    await bump(db, id, revision, user);
    await activity(db, id, user, unlink ? 'desvincular_tarea' : 'vincular_tarea', null, null, null, taskId);
    return { status: unlink ? 200 : 201, body: { proyecto: await readProjectDetail(db, id, user) } };
  });
  router.post('/:id/tareas', taskLink(false));
  router.delete('/:id/tareas/:task', taskLink(true));
  return router;
}
