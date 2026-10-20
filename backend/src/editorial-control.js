import { SYSTEM_USER_ROLES } from './user-roles.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const BUCKETS = ['today', 'overdue', 'blocked', 'upcoming_ready'];
const CLASSIFICATIONS = ['confirmada_manualmente', 'historica_sin_confirmacion', 'no_publicada'];
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

export function normalizeEditorialControlQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['bucket', 'offset', 'limit'].includes(key))
    || Object.values(query).some(value => typeof value !== 'string')) throw fail('Filtros de control editorial inválidos.');
  const bucket = query.bucket ?? 'today';
  if (!BUCKETS.includes(bucket)) throw fail('Cola editorial inválida.');
  function number(value, fallback, min, max) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(parsed)
      || String(parsed) !== value || parsed < min || parsed > max) throw fail('Paginación editorial inválida.');
    return parsed;
  }
  return { bucket, offset: number(query.offset, 0, 0, 1000000), limit: number(query.limit, 20, 1, 50) };
}

// Internal observed evidence fields are projected narrowly and discarded after
// server annotation. No metadata-based publication claim is trusted or exported.
const domainSql = (domain, table) => `SELECT '${domain}'::text AS domain,p.id,p.estado,
  ${domain === 'historia' ? "'historia'::text" : 'p.tipo'} AS tipo,p.cliente_id,c.nombre AS cliente_nombre,
  c.activo AS cliente_activo,p.fecha_programada,p.fecha_publicación_real,
  jsonb_build_object('archivado_tablero',p.metadata->'archivado_tablero') AS metadata,
  left(COALESCE(NULLIF(btrim(p.idea),''),
    NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'idea')='string' THEN p.metadata->>'idea' END),''),
    NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'Idea')='string' THEN p.metadata->>'Idea' END),''),
    left(p.copy,160),''),160) AS titulo
  FROM ${table} p JOIN clientes c ON c.id=p.cliente_id
  WHERE c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'`;

export const EDITORIAL_CONTROL_SQL = `WITH
  day AS (SELECT (statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date AS today),
  visible AS MATERIALIZED (
    ${domainSql('historia', 'historias')}
    UNION ALL
    ${domainSql('publicacion', 'publicaciones')}
  ),
  bucketed AS MATERIALIZED (
    SELECT v.domain,v.id,v.estado,v.tipo,v.cliente_id,v.cliente_nombre,v.cliente_activo,
      v.fecha_programada,v.fecha_publicación_real,v.metadata,v.titulo,
      v.fecha_programada=day.today AS is_today,
      (v.fecha_programada<day.today AND v.estado NOT IN ('publicada','rechazada')) AS is_overdue,
      v.estado='bloqueada' AS is_blocked,
      (v.estado='lista' AND v.fecha_programada>day.today) AS is_upcoming_ready
    FROM visible v CROSS JOIN day
  ),
  selected AS MATERIALIZED (
    SELECT b.domain,b.id,b.estado,b.tipo,b.cliente_id,b.cliente_nombre,b.cliente_activo,
      b.fecha_programada,b.fecha_publicación_real,b.metadata,b.titulo
    FROM bucketed b WHERE CASE $1::text
      WHEN 'today' THEN b.is_today WHEN 'overdue' THEN b.is_overdue
      WHEN 'blocked' THEN b.is_blocked WHEN 'upcoming_ready' THEN b.is_upcoming_ready END
  ),
  page AS (
    SELECT s.domain,s.id,s.estado,s.tipo,s.cliente_id,s.cliente_nombre,s.cliente_activo,
      s.fecha_programada,s.fecha_publicación_real,s.metadata,s.titulo
    FROM selected s ORDER BY s.fecha_programada ASC NULLS LAST,s.domain ASC,s.id ASC OFFSET $2 LIMIT $3
  )
SELECT jsonb_build_object('today',to_char(day.today,'YYYY-MM-DD'),
  'total',(SELECT count(*)::int FROM selected),
  'summary',jsonb_build_object('today',(SELECT count(*) FILTER (WHERE is_today)::int FROM bucketed),
    'overdue',(SELECT count(*) FILTER (WHERE is_overdue)::int FROM bucketed),
    'blocked',(SELECT count(*) FILTER (WHERE is_blocked)::int FROM bucketed),
    'upcoming_ready',(SELECT count(*) FILTER (WHERE is_upcoming_ready)::int FROM bucketed)),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'domain',p.domain,'id',p.id,'titulo',p.titulo,'estado',p.estado,'tipo',p.tipo,
    'cliente_id',p.cliente_id,'cliente_nombre',p.cliente_nombre,'cliente_activo',p.cliente_activo,
    'fecha_programada',to_char(p.fecha_programada,'YYYY-MM-DD'),
    'fecha_publicación_real',p.fecha_publicación_real,'metadata',p.metadata)
    ORDER BY p.fecha_programada ASC NULLS LAST,p.domain ASC,p.id ASC) FROM page p),'[]'::jsonb)
) AS control FROM day`;

function closeItem(row) {
  const classification = row.publicacion_evidencia?.classification;
  if (!['historia', 'publicacion'].includes(row.domain) || !id(row.id) || !id(row.cliente_id)
    || !CLASSIFICATIONS.includes(classification)) throw new Error('No se pudo proyectar la pieza editorial.');
  return { domain: row.domain, id: row.id, titulo: text(row.titulo, 160), estado: text(row.estado, 80),
    tipo: text(row.tipo, 80), cliente: { id: row.cliente_id, nombre: text(row.cliente_nombre, 250) },
    fecha_programada: row.fecha_programada, publication_classification: classification };
}

export async function readEditorialControl(pool, auth, query = {}) {
  const filters = normalizeEditorialControlQuery(query);
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (!id(auth?.id) || !Number.isSafeInteger(auth.session_version)) throw fail('Sesión requerida.', 401);
    const user = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
    if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version
      || user.rol !== auth.rol) throw fail('La sesión ya no está activa.', 401);
    if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso al control editorial.', 403);
    const raw = (await db.query(EDITORIAL_CONTROL_SQL, [filters.bucket, filters.offset, filters.limit])).rows[0]?.control;
    if (!raw || !Array.isArray(raw.items) || raw.items.length > filters.limit) throw new Error('No se pudo leer el control editorial.');
    const annotated = new Map();
    for (const domain of ['historia', 'publicacion']) {
      const rows = raw.items.filter(row => row.domain === domain);
      for (const row of await annotateEditorialEvidence(db, domain, rows)) annotated.set(`${domain}:${row.id}`, row);
    }
    const items = raw.items.map(row => {
      const observed = annotated.get(`${row.domain}:${row.id}`);
      if (!observed) throw new Error('No se pudo verificar la pieza editorial.');
      return closeItem(observed);
    });
    const result = { version: 1, today: raw.today, ...filters, total: raw.total,
      has_more: raw.total > filters.offset + filters.limit,
      summary: Object.fromEntries(BUCKETS.map(bucket => [bucket, raw.summary[bucket]])), items };
    await db.query('COMMIT');
    return result;
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db?.release(); }
}

export function createEditorialControlRouter({ express, pool }) {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await readEditorialControl(pool, req.auth, req.query ?? {})); }
    catch (error) {
      if ([400, 401, 403].includes(error.status)) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });
  return router;
}
