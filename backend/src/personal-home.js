import { SYSTEM_USER_ROLES } from './user-roles.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

// Explicit projections, not whole-row JSON: even administrators' personal home
// is operational, and must never become an alternate financial endpoint.
const taskJson = alias => `jsonb_build_object('id',${alias}.id,'titulo',${alias}.titulo,
  'estado',${alias}.estado,'prioridad',${alias}.prioridad,'revision',${alias}.revision,
  'fecha_vencimiento',to_char(${alias}.fecha_vencimiento,'YYYY-MM-DD'),
  'cliente',CASE WHEN ${alias}.cliente_id IS NULL THEN NULL ELSE jsonb_build_object('id',${alias}.cliente_id,'nombre',${alias}.cliente_nombre) END,
  'href','/workspace/tareas?task='||${alias}.id)`;

// Historical labels select a work queue, never the authenticated identity.
// Keep this separate from review: pending/in-progress escalations also matter.
export const HOME_ESCALATIONS_SQL = `WITH escalated AS MATERIALIZED (
  SELECT t.id,t.titulo,CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb
    THEN 'aprobada' ELSE t.estado END AS estado,t.prioridad,t.revision,t.fecha_vencimiento,
    t.cliente_id,c.nombre AS cliente_nombre
  FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
  WHERE t.propiedades_extra->>'workspace'='render_os'
    AND t.estado NOT IN ('finalizada','publicada')
    AND jsonb_typeof(t.propiedades_extra->'escalada_a')='string'
    AND t.propiedades_extra->>'escalada_a' IN ('Líder','Agustín','Franco')
    AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
    AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
    AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)
), page AS (
  SELECT e.*,row_number() OVER (ORDER BY fecha_vencimiento ASC NULLS LAST,
    CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,id) AS rank
  FROM escalated e ORDER BY rank OFFSET $1 LIMIT $2
)
SELECT jsonb_build_object('version',1,'offset',$1::integer,'limit',$2::integer,
  'total',(SELECT count(*)::int FROM escalated),
  'has_more',(SELECT count(*) FROM escalated)>$1::integer+$2::integer,
  'items',COALESCE((SELECT jsonb_agg(${taskJson('q')} ORDER BY q.rank) FROM page q),'[]'::jsonb)) AS queue`;

export function parseEscalationPage(query = {}) {
  if (Object.keys(query).some(key => !['offset', 'limit'].includes(key))) throw fail('Filtros de escalaciones no válidos.', 400);
  const parse = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw fail('Paginación no válida.', 400);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw fail('Paginación fuera de rango.', 400);
    return number;
  };
  return { offset: parse(query.offset, 0, 0, 1000000), limit: parse(query.limit, 20, 1, 50) };
}

async function verifiedHomeUser(db, auth) {
  const user = (await db.query('SELECT id,nombre,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
  if (!user || !user.activo || user.session_version !== auth.session_version) throw fail('La sesión ya no está activa.', 401);
  if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso al inicio operativo.', 403);
  return user;
}

export async function readHomeEscalations(pool, auth, query = {}) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1) throw fail('Necesitás una identidad verificada.', 403);
  const { offset, limit } = parseEscalationPage(query);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = await verifiedHomeUser(db, auth);
    if (user.rol !== 'admin') throw fail('Solo dirección puede consultar las escalaciones del equipo.', 403);
    const result = await db.query(HOME_ESCALATIONS_SQL, [offset, limit]);
    if (!result.rows[0]?.queue) throw new Error('No se pudieron leer las escalaciones.');
    await db.query('COMMIT');
    return result.rows[0].queue;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

// Team workload is a closed operational projection. Assignment membership is
// ID-only and may overlap: a shared task counts once globally, once per person.
export const HOME_TEAM_WORKLOAD_SQL = `WITH
  day AS (SELECT (statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date AS today),
  open_tasks AS MATERIALIZED (
    SELECT t.id,t.fecha_vencimiento,
      CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb
        THEN 'aprobada' ELSE t.estado END AS estado
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
    WHERE t.propiedades_extra->>'workspace'='render_os'
      AND t.estado NOT IN ('finalizada','publicada')
      AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
      AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
      AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)
  ),
  membership AS MATERIALIZED (
    SELECT DISTINCT a.tarea_id,a.usuario_id FROM tarea_asignaciones a
    JOIN open_tasks t ON t.id=a.tarea_id
  ),
  people AS MATERIALIZED (
    SELECT u.id,u.nombre,u.activo,count(DISTINCT t.id)::int AS open,
      count(DISTINCT t.id) FILTER (WHERE t.fecha_vencimiento<day.today)::int AS overdue,
      count(DISTINCT t.id) FILTER (WHERE t.estado='en_revision')::int AS review,
      count(DISTINCT t.id) FILTER (WHERE t.estado='aprobada')::int AS approved
    FROM membership a JOIN open_tasks t ON t.id=a.tarea_id
    JOIN usuarios u ON u.id=a.usuario_id CROSS JOIN day
    GROUP BY u.id,u.nombre,u.activo
  ),
  unassigned_tasks AS MATERIALIZED (
    SELECT t.id,t.fecha_vencimiento FROM open_tasks t
    WHERE NOT EXISTS (SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id)
  ),
  page AS (
    SELECT p.id,p.nombre,p.activo,p.open,p.overdue,p.review,p.approved
    FROM people p ORDER BY p.overdue DESC,p.open DESC,p.id ASC OFFSET $1 LIMIT $2
  )
SELECT jsonb_build_object('version',1,'today',to_char(day.today,'YYYY-MM-DD'),
  'offset',$1::integer,'limit',$2::integer,
  'total_tasks',(SELECT count(DISTINCT id)::int FROM open_tasks),
  'total_overdue',(SELECT count(DISTINCT id) FILTER (WHERE fecha_vencimiento<day.today)::int FROM open_tasks),
  'total_people',(SELECT count(*)::int FROM people),
  'has_more',(SELECT count(*) FROM people)>$1::integer+$2::integer,
  'unassigned',jsonb_build_object('open',(SELECT count(DISTINCT id)::int FROM unassigned_tasks),
    'overdue',(SELECT count(DISTINCT id) FILTER (WHERE fecha_vencimiento<day.today)::int FROM unassigned_tasks)),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'user',jsonb_build_object('id',p.id,'nombre',p.nombre,'activo',p.activo),
    'open',p.open,'overdue',p.overdue,'review',p.review,'approved',p.approved)
    ORDER BY p.overdue DESC,p.open DESC,p.id ASC) FROM page p),'[]'::jsonb)
) AS workload FROM day`;

export async function readHomeTeamWorkload(pool, auth, query = {}) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1) throw fail('Necesitás una identidad verificada.', 403);
  const { offset, limit } = parseEscalationPage(query);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = await verifiedHomeUser(db, auth);
    if (user.rol !== 'admin') throw fail('Solo dirección puede consultar la carga del equipo.', 403);
    const result = await db.query(HOME_TEAM_WORKLOAD_SQL, [offset, limit]);
    if (!result.rows[0]?.workload) throw new Error('No se pudo leer la carga del equipo.');
    await db.query('COMMIT');
    return result.rows[0].workload;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export const PERSONAL_HOME_SQL = `WITH
  day AS (SELECT (statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date AS today),
  visible AS MATERIALIZED (
    SELECT t.id,t.titulo,CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb
      THEN 'aprobada' ELSE t.estado END AS estado,t.prioridad,t.revision,t.fecha_vencimiento,t.updated_at,
      t.cliente_id,c.nombre AS cliente_nombre,t.tipo_tarea
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
    WHERE t.propiedades_extra->>'workspace'='render_os'
      AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
      AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
      AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)
  ),
  mine AS MATERIALIZED (SELECT v.* FROM visible v WHERE EXISTS (
    SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=v.id AND a.usuario_id=$1)),
  open AS MATERIALIZED (SELECT * FROM mine WHERE estado NOT IN ('finalizada','publicada')),
  monthly_work AS MATERIALIZED (
    SELECT m.* FROM mine m CROSS JOIN day
    WHERE COALESCE(m.fecha_vencimiento,(m.updated_at AT TIME ZONE 'America/Argentina/Cordoba')::date)
      >= date_trunc('month',day.today)::date
      AND COALESCE(m.fecha_vencimiento,(m.updated_at AT TIME ZONE 'America/Argentina/Cordoba')::date)
      < (date_trunc('month',day.today)+interval '1 month')::date
  ),
  monthly_sectors AS (
    SELECT COALESCE(tipo_tarea,'sin_sector') AS sector,count(*)::int AS total,
      count(*) FILTER (WHERE estado IN ('finalizada','publicada'))::int AS completed
    FROM monthly_work GROUP BY COALESCE(tipo_tarea,'sin_sector')
  ),
  reviews AS MATERIALIZED (SELECT * FROM visible v WHERE estado='en_revision' AND
    ($2::boolean OR EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=v.id AND a.usuario_id=$1))),
  client_work AS (SELECT cliente_id AS id,cliente_nombre AS nombre,count(*)::int AS open FROM open
    WHERE cliente_id IS NOT NULL GROUP BY cliente_id,cliente_nombre),
  my_visits AS MATERIALIZED (
    SELECT v.id,v.titulo,v.fecha,v.cliente_id,c.nombre AS cliente_nombre
    FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id CROSS JOIN day
    WHERE c.activo IS DISTINCT FROM FALSE AND v.fecha BETWEEN day.today AND day.today+7
      AND (v.tarea_origen_id IS NULL OR EXISTS(SELECT 1 FROM visible source WHERE source.id=v.tarea_origen_id))
      AND (EXISTS(SELECT 1 FROM produccion_visita_participantes p WHERE p.visita_id=v.id AND p.usuario_id=$1)
        OR EXISTS(SELECT 1 FROM mine m WHERE m.id=v.tarea_origen_id)
        OR EXISTS(SELECT 1 FROM produccion_videos pv JOIN mine m ON m.id=COALESCE(pv.tarea_entrega_id,pv.tarea_edicion_id)
          WHERE pv.visita_id=v.id))
  ),
  my_projects AS MATERIALIZED (
    SELECT p.id,p.titulo,p.tipo,p.estado,p.fecha_entrega,p.revision,p.cliente_id,c.nombre AS cliente_nombre
    FROM proyectos p JOIN clientes c ON c.id=p.cliente_id
    WHERE NOT p.archivado AND p.estado NOT IN ('finalizado','cancelado') AND c.activo IS DISTINCT FROM FALSE
      AND (p.responsable_id=$1 OR EXISTS(SELECT 1 FROM proyecto_miembros m WHERE m.proyecto_id=p.id AND m.usuario_id=$1))
  )
SELECT jsonb_build_object(
  'version',1,'generated_at',statement_timestamp(),'today',to_char(day.today,'YYYY-MM-DD'),
  'summary',jsonb_build_object(
    'open',(SELECT count(*)::int FROM open),
    'overdue',(SELECT count(*)::int FROM open WHERE fecha_vencimiento<day.today),
    'today',(SELECT count(*)::int FROM open WHERE fecha_vencimiento=day.today),
    'upcoming',(SELECT count(*)::int FROM open WHERE fecha_vencimiento>day.today AND fecha_vencimiento<=day.today+7),
    'undated',(SELECT count(*)::int FROM open WHERE fecha_vencimiento IS NULL),
    'awaiting_review',(SELECT count(*)::int FROM open WHERE estado='en_revision')),
  'monthly_progress',jsonb_build_object('period',to_char(day.today,'YYYY-MM'),
    'total',(SELECT count(*)::int FROM monthly_work),
    'completed',(SELECT count(*)::int FROM monthly_work WHERE estado IN ('finalizada','publicada')),
    'by_sector',COALESCE((SELECT jsonb_agg(jsonb_build_object('sector',s.sector,'total',s.total,'completed',s.completed)
      ORDER BY s.sector) FROM monthly_sectors s),'[]'::jsonb)),
  'tasks',COALESCE((SELECT jsonb_agg(${taskJson('q')} ORDER BY q.rank) FROM (
    SELECT o.*,row_number() OVER (ORDER BY fecha_vencimiento ASC NULLS LAST,
      CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,id) AS rank FROM open o
    ORDER BY rank LIMIT 12) q),'[]'::jsonb),
  'review',jsonb_build_object('scope',CASE WHEN $2::boolean THEN 'team' ELSE 'personal' END,
    'total',(SELECT count(*)::int FROM reviews),
    'items',COALESCE((SELECT jsonb_agg(${taskJson('q')} ORDER BY q.rank) FROM (
      SELECT r.*,row_number() OVER(ORDER BY fecha_vencimiento ASC NULLS LAST,id) AS rank
      FROM reviews r ORDER BY rank LIMIT 8) q),'[]'::jsonb)),
  'clients',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.open DESC,q.nombre,q.id)
    FROM (SELECT * FROM client_work ORDER BY open DESC,nombre,id LIMIT 8) q),'[]'::jsonb),
  'visits',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'titulo',q.titulo,
    'fecha',to_char(q.fecha,'YYYY-MM-DD'),'cliente',jsonb_build_object('id',q.cliente_id,'nombre',q.cliente_nombre),
    'href','/producciones?visita='||q.id||'&mes='||to_char(q.fecha,'YYYY-MM')) ORDER BY q.fecha,q.id)
    FROM (SELECT * FROM my_visits ORDER BY fecha,id LIMIT 8) q),'[]'::jsonb),
  'activity',COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id',q.id,'titulo',q.titulo,
    'estado',q.estado,'updated_at',q.updated_at,'href','/workspace/tareas?task='||q.id) ORDER BY q.updated_at DESC,q.id DESC)
    FROM (SELECT * FROM mine ORDER BY updated_at DESC,id DESC LIMIT 8) q),'[]'::jsonb),
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'titulo',q.titulo,'tipo',q.tipo,
    'estado',q.estado,'fecha_entrega',to_char(q.fecha_entrega,'YYYY-MM-DD'),'revision',q.revision,
    'cliente',jsonb_build_object('id',q.cliente_id,'nombre',q.cliente_nombre),'href','/proyectos?proyecto='||q.id)
    ORDER BY q.fecha_entrega ASC NULLS LAST,q.id) FROM (
      SELECT * FROM my_projects ORDER BY fecha_entrega ASC NULLS LAST,id LIMIT 8) q),'[]'::jsonb),
  'list_totals',jsonb_build_object('clients',(SELECT count(*)::int FROM client_work),
    'visits',(SELECT count(*)::int FROM my_visits),'activity',(SELECT count(*)::int FROM mine),'projects',(SELECT count(*)::int FROM my_projects)),
  'capabilities',jsonb_build_object('projects',true)
) AS home FROM day`;

export async function readPersonalHome(pool, auth) {
  if (!Number.isSafeInteger(auth?.id) || auth.id < 1) throw fail('Necesitás una identidad verificada.', 403);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = await verifiedHomeUser(db, auth);
    const result = await db.query(PERSONAL_HOME_SQL, [user.id, user.rol === 'admin']);
    if (!result.rows[0]?.home) throw new Error('No se pudo leer el inicio operativo.');
    const home = { ...result.rows[0].home, user: { id: user.id, nombre: user.nombre } };
    await db.query('COMMIT');
    return home;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export function createPersonalHomeRouter({ express, pool }) {
  const router = express.Router();
  router.get('/equipo', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await readHomeTeamWorkload(pool, req.auth, req.query)); }
    catch (error) {
      if ([400, 401, 403].includes(error.status)) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });
  router.get('/escalaciones', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await readHomeEscalations(pool, req.auth, req.query)); }
    catch (error) {
      if ([400, 401, 403].includes(error.status)) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });
  router.get('/', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query ?? {}).length) return res.status(400).json({ error: 'El inicio usa tu sesión, no filtros de identidad.' });
    try { return res.json(await readPersonalHome(pool, req.auth)); }
    catch (error) {
      if ([401, 403].includes(error.status)) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });
  return router;
}
