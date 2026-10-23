import { SYSTEM_USER_ROLES } from './user-roles.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { productionVisitMembersSql } from './production-visit-membership.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const CALENDAR_TIMEZONE = 'America/Argentina/Cordoba';
const LIMIT = 2000;
const KINDS = ['all', 'tarea', 'visita', 'programacion', 'publicacion', 'hito'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

export function normalizeCalendarQuery(query = {}) {
  const keys = ['desde', 'hasta', 'scope', 'kind', 'cliente_id'];
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(k => !keys.includes(k))
    || Object.values(query).some(v => typeof v !== 'string')) throw fail('Filtros de calendario inválidos.');
  const desde = day(query.desde), hasta = day(query.hasta);
  const days = desde && hasta ? (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000 : 0;
  if (!desde || !hasta || days < 1 || days > 62) throw fail('Elegí un rango de 1 a 62 días, con hasta exclusivo.');
  const scope = query.scope ?? 'mine', kind = query.kind ?? 'all';
  if (!['mine', 'team'].includes(scope) || !KINDS.includes(kind)) throw fail('Ámbito o tipo de calendario inválido.');
  let cliente_id = null;
  if (query.cliente_id !== undefined) {
    if (!/^[1-9]\d*$/.test(query.cliente_id) || !id(Number(query.cliente_id))) throw fail('Cliente inválido.');
    cliente_id = Number(query.cliente_id);
  }
  return { desde, hasta, scope, kind, cliente_id };
}

const visibleTask = alias => `${alias}.propiedades_extra->>'workspace'='render_os'
 AND COALESCE(${alias}.propiedades_extra->>'archivada_render_os','false')<>'true'
 AND COALESCE(${alias}.propiedades_extra->>'papelera_render_os','false')<>'true'
 AND (${alias}.cliente_id IS NULL OR EXISTS(SELECT 1 FROM clientes vc WHERE vc.id=${alias}.cliente_id AND vc.activo IS DISTINCT FROM FALSE))`;
const assigned = alias => `EXISTS(SELECT 1 FROM tarea_asignaciones mine WHERE mine.tarea_id=${alias}.id AND mine.usuario_id=$4)`;
const visitMembers = productionVisitMembersSql('v', visibleTask);

export const CALENDAR_TASK_SQL = `SELECT t.id,t.titulo,t.estado,t.cliente_id,c.nombre AS cliente_nombre,
 to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS date,
 ARRAY(SELECT a.usuario_id FROM tarea_asignaciones a WHERE a.tarea_id=t.id ORDER BY a.usuario_id) AS responsable_ids
 FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
 WHERE ${visibleTask('t')} AND t.fecha_vencimiento >= $1::date AND t.fecha_vencimiento < $2::date
 AND ($3::int IS NULL OR t.cliente_id=$3) AND ($5::boolean OR ${assigned('t')})
 AND NOT EXISTS(SELECT 1 FROM produccion_visitas v WHERE v.tarea_origen_id=t.id)
 ORDER BY t.fecha_vencimiento,t.id LIMIT 2001`;

export const CALENDAR_VISIT_SQL = `SELECT v.id,v.titulo,v.cliente_id,c.nombre AS cliente_nombre,
 to_char(v.fecha,'YYYY-MM-DD') AS date,
 ARRAY(SELECT DISTINCT members.usuario_id FROM (
   ${visitMembers}
 ) members ORDER BY members.usuario_id) AS responsable_ids
 FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id
 WHERE c.activo IS DISTINCT FROM FALSE AND v.fecha >= $1::date AND v.fecha < $2::date
 AND ($3::int IS NULL OR v.cliente_id=$3)
 AND (v.tarea_origen_id IS NULL OR EXISTS(SELECT 1 FROM tareas source WHERE source.id=v.tarea_origen_id AND ${visibleTask('source')}))
 AND ($5::boolean OR EXISTS(SELECT 1 FROM (${visitMembers}) visit_mine WHERE visit_mine.usuario_id=$4))
 ORDER BY v.fecha,v.id LIMIT 2001`;

export const CALENDAR_MILESTONE_SQL = `SELECT h.id,h.proyecto_id,h.titulo,h.estado,p.cliente_id,c.nombre AS cliente_nombre,
 to_char(h.fecha,'YYYY-MM-DD') AS date,
 ARRAY(SELECT DISTINCT members.usuario_id FROM (
   SELECT p.responsable_id AS usuario_id
   UNION SELECT m.usuario_id FROM proyecto_miembros m WHERE m.proyecto_id=p.id
 ) members ORDER BY members.usuario_id) AS responsable_ids
 FROM proyecto_hitos h JOIN proyectos p ON p.id=h.proyecto_id JOIN clientes c ON c.id=p.cliente_id
 WHERE NOT p.archivado AND c.activo IS DISTINCT FROM FALSE
 AND h.fecha >= $1::date AND h.fecha < $2::date AND ($3::int IS NULL OR p.cliente_id=$3)
 AND ($5::boolean OR p.responsable_id=$4
   OR EXISTS(SELECT 1 FROM proyecto_miembros m WHERE m.proyecto_id=p.id AND m.usuario_id=$4))
 ORDER BY h.fecha,h.id LIMIT 2001`;

export function calendarEditorialSql(domain, kind) {
  if (!['historia', 'publicacion'].includes(domain) || !KINDS.includes(kind)) throw new TypeError('Dominio/tipo inválido.');
  const table = domain === 'historia' ? 'historias' : 'publicaciones';
  const fk = domain === 'historia' ? 'historia_id' : 'publicacion_id';
  const linked = `t.${fk}=p.id AND t.cliente_id=p.cliente_id AND ${visibleTask('t')}`;
  const scheduled = '(p.fecha_programada >= $1::date AND p.fecha_programada < $2::date)';
  const actual = `(p.fecha_publicación_real >= ($1::date::timestamp AT TIME ZONE '${CALENDAR_TIMEZONE}')
    AND p.fecha_publicación_real < ($2::date::timestamp AT TIME ZONE '${CALENDAR_TIMEZONE}'))`;
  return `SELECT p.id,p.cliente_id,c.nombre AS cliente_nombre,p.estado,${domain === 'publicacion' ? 'p.tipo' : "'historia'::text AS tipo"},
    left(COALESCE(NULLIF(btrim(p.idea),''),NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'idea')='string' THEN p.metadata->>'idea' END),''),
      NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'Idea')='string' THEN p.metadata->>'Idea' END),''),left(p.copy,160),''),160) AS titulo,
    to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,p.fecha_publicación_real,
    ARRAY(SELECT DISTINCT a.usuario_id FROM tarea_asignaciones a JOIN tareas t ON t.id=a.tarea_id
      WHERE ${linked} ORDER BY a.usuario_id) AS responsable_ids
    FROM ${table} p JOIN clientes c ON c.id=p.cliente_id
    WHERE c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
    AND ($3::int IS NULL OR p.cliente_id=$3)
    AND ($5::boolean OR EXISTS(SELECT 1 FROM tareas t WHERE ${linked} AND ${assigned('t')}))
    AND ${kind === 'programacion' ? scheduled : kind === 'publicacion' ? actual : `(${scheduled} OR ${actual})`}
    ORDER BY p.id LIMIT 2001`;
}

const cordobaDate = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
function actualDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return null;
  const parts = Object.fromEntries(cordobaDate.formatToParts(date).map(p => [p.type, p.value]));
  return day(`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`);
}

function closedEvidence(row) {
  const evidence = row.publicacion_evidencia, proof = evidence?.confirmation;
  if (evidence?.classification !== 'confirmada_manualmente' || !Number.isSafeInteger(evidence.revision) || evidence.revision < 1
    || row.estado !== 'publicada' || !proof || typeof proof.id !== 'string' || !UUID.test(proof.id)
    || !id(proof.actor_id) || proof.source !== 'manual' || !actualDate(proof.occurred_at) || !actualDate(proof.recorded_at)) return null;
  const raw = row['fecha_publicación_real'];
  const root = raw instanceof Date ? raw : typeof raw === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? new Date(raw) : null;
  if (!root || !Number.isFinite(root.getTime()) || root.toISOString() !== proof.occurred_at) return null;
  return { classification: 'confirmada_manualmente', revision: evidence.revision,
    confirmation: { id: proof.id.toLowerCase(), actor_id: proof.actor_id, occurred_at: proof.occurred_at, recorded_at: proof.recorded_at, source: 'manual' } };
}

/** Pure closed projection. Editorial rows must first be server-annotated. */
export function buildCalendarEvents({ tasks = [], visits = [], historias = [], publicaciones = [], hitos = [] }, filters) {
  const result = new Map();
  const add = (row, kind, source, date, href, label, evidence = null) => {
    if (!day(date) || date < filters.desde || date >= filters.hasta || (filters.kind !== 'all' && filters.kind !== kind)) return;
    if (['visita', 'hito'].includes(source) ? typeof row.id !== 'string' || !UUID.test(row.id) : !id(row.id)) return;
    if (row.cliente_id !== null && !id(row.cliente_id)) return;
    if (filters.cliente_id !== null && row.cliente_id !== filters.cliente_id) return;
    const key = `${kind}:${source}:${row.id}`;
    result.set(key, { key, kind, source, source_id: row.id, date, title: text(label, 160), cliente_id: row.cliente_id,
      cliente_nombre: row.cliente_id === null ? null : text(row.cliente_nombre, 250), estado: typeof row.estado === 'string' ? text(row.estado, 80) : null,
      href, responsable_ids: [...new Set((Array.isArray(row.responsable_ids) ? row.responsable_ids : []).filter(id))].sort((a, b) => a - b), evidence });
  };
  for (const row of tasks) add(row, 'tarea', 'tarea', row.date, `/workspace/tareas?task=${row.id}`, `Entrega de tarea · ${text(row.titulo, 160)}`);
  for (const row of visits) add(row, 'visita', 'visita', row.date, `/producciones?visita=${row.id}&mes=${row.date?.slice(0, 7)}`, `Visita de producción · ${text(row.titulo, 160)}`);
  for (const row of hitos) {
    if (typeof row.proyecto_id !== 'string' || !UUID.test(row.proyecto_id) || !['pendiente', 'completado', 'cancelado'].includes(row.estado)) continue;
    add(row, 'hito', 'hito', row.date, `/proyectos?proyecto=${row.proyecto_id}`, `Hito de proyecto · ${text(row.titulo, 160)}`);
  }
  for (const [source, rows] of [['historia', historias], ['publicacion', publicaciones]]) {
    for (const row of rows) {
      const proof = closedEvidence(row), actual = proof ? actualDate(proof.confirmation.occurred_at) : null;
      const planned = day(row.fecha_programada), month = (planned ?? actual)?.slice(0, 7);
      const context = source === 'historia' ? `/planificacion-historias?vista=checklist&cliente=${row.cliente_id}&mes=${month}`
        : `/planificacion-publicaciones?tab=calendario&cliente=${row.cliente_id}&mes=${month}`;
      const type = source === 'historia' ? 'Historia' : ({ video: 'Video', reel: 'Reel', carrusel: 'Carrusel', flyer: 'Flyer' }[row.tipo] ?? 'Publicación');
      const title = text(row.titulo, 160);
      const pieceLabel = title ? `${type} · ${title}` : `${type} #${row.id}`;
      if (planned) add(row, 'programacion', source, planned, context, `Programación editorial · ${pieceLabel}`);
      if (actual) add(row, 'publicacion', source, actual, context, `Publicación confirmada manualmente · ${pieceLabel}`, proof);
    }
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

export async function readCalendar(pool, auth, query) {
  const filters = normalizeCalendarQuery(query);
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (!id(auth?.id) || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
    const user = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
    if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version || user.rol !== auth.rol) throw fail('La sesión ya no está activa.', 401);
    if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso al calendario.', 403);
    const clients = (await db.query('SELECT id,nombre FROM clientes WHERE activo IS DISTINCT FROM FALSE ORDER BY nombre,id')).rows
      .filter(row => id(row.id)).map(row => ({ id: row.id, nombre: text(row.nombre, 250) }));
    const values = [filters.desde, filters.hasta, filters.cliente_id, user.id, filters.scope === 'team'];
    const data = { tasks: [], visits: [], historias: [], publicaciones: [], hitos: [] };
    let truncated = false;
    const fetch = async sql => {
      const rows = (await db.query(sql, values)).rows;
      if (rows.length > LIMIT) truncated = true;
      return rows.slice(0, LIMIT + 1);
    };
    if (['all', 'tarea'].includes(filters.kind)) data.tasks = await fetch(CALENDAR_TASK_SQL);
    if (['all', 'visita'].includes(filters.kind)) data.visits = await fetch(CALENDAR_VISIT_SQL);
    if (['all', 'hito'].includes(filters.kind)) data.hitos = await fetch(CALENDAR_MILESTONE_SQL);
    if (['all', 'programacion', 'publicacion'].includes(filters.kind)) {
      for (const domain of ['historia', 'publicacion']) {
        const rows = await fetch(calendarEditorialSql(domain, filters.kind));
        // A scheduled-only view does not award publication credit or need proof.
        data[domain === 'historia' ? 'historias' : 'publicaciones'] = filters.kind === 'programacion' ? rows : await annotateEditorialEvidence(db, domain, rows);
      }
    }
    const events = buildCalendarEvents(data, filters);
    if (events.length > LIMIT) truncated = true;
    await db.query('COMMIT');
    return { range: { desde: filters.desde, hasta: filters.hasta }, scope: filters.scope, kind: filters.kind,
      timezone: CALENDAR_TIMEZONE, clients, events: events.slice(0, LIMIT), truncated };
  } catch (error) {
    if (db) { try { await db.query('ROLLBACK'); } catch { /* preserve original failure */ } }
    throw error;
  } finally { db?.release(); }
}

export function createCalendarRouter({ express, pool }) {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await readCalendar(pool, req.auth, req.query ?? {})); }
    catch (error) {
      if ([400, 401, 403].includes(error.status)) res.status(error.status).json({ error: error.message });
      else next(error);
    }
  });
  return router;
}
