import { SYSTEM_USER_ROLES } from './user-roles.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0;
const invalidQuery = () => fail('Filtros del inventario de feedback inválidos.', 400);

export function parseFeedbackTaskInventoryQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['limit', 'offset', 'view', 'cliente_id', 'q'].includes(key))) throw invalidQuery();
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw invalidQuery();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalidQuery();
    return parsed;
  };
  const view = query.view === undefined ? 'all' : query.view;
  if (typeof view !== 'string' || !['all', 'awaiting_review', 'with_corrections'].includes(view)) throw invalidQuery();
  if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 200 || /\p{Cc}/u.test(query.q))) throw invalidQuery();
  return {
    limit: integer(query.limit, 20, 1, 50),
    offset: integer(query.offset, 0, 0, 1000000),
    view,
    cliente_id: integer(query.cliente_id, null, 1, 2147483647),
    q: query.q === undefined ? '' : query.q.trim(),
  };
}

// One candidate per canonical task: lateral reads select one artifact/decision,
// EXISTS preserves historical corrections without multiplying rows or inferring
// resolution. No note/comment body, arbitrary metadata or finance is projected.
export const FEEDBACK_TASK_INVENTORY_SQL = `WITH candidates AS (
  SELECT t.id,t.revision,t.titulo,t.estado,t.cliente_id,c.nombre AS cliente_nombre,
    d.id AS delivery_id,d.task_revision AS delivery_revision,d.recorded_at AS delivery_at,
    r.id AS decision_id,r.delivery_id AS decision_delivery_id,r.action AS decision_action,
    r.task_revision AS decision_revision,r.recorded_at AS decision_at,
    EXISTS (SELECT 1 FROM task_editing_reviews correction
      WHERE correction.task_id=t.id AND correction.action='correcciones') AS has_corrections,
    (t.estado='en_revision' AND d.id IS NOT NULL AND d.task_revision<=t.revision
      AND NOT COALESCE((t.propiedades_extra->'revision_aprobada'='true'::jsonb
        AND t.propiedades_extra->>'revision_aprobada_entrega_id'=d.id::text
        AND d.task_revision<t.revision),FALSE)) AS awaiting_review
  FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
  LEFT JOIN LATERAL (
    SELECT delivery.id,delivery.task_revision,delivery.recorded_at FROM task_editing_deliveries delivery
    WHERE delivery.task_id=t.id
    ORDER BY delivery.task_revision DESC,delivery.recorded_at DESC,delivery.id DESC LIMIT 1
  ) d ON TRUE
  LEFT JOIN LATERAL (
    SELECT review.id,review.delivery_id,review.action,review.task_revision,review.recorded_at
    FROM task_editing_reviews review WHERE review.task_id=t.id
    ORDER BY review.task_revision DESC,review.id DESC LIMIT 1
  ) r ON TRUE
  WHERE t.tipo_tarea='edicion' AND t.propiedades_extra->>'workspace'='render_os'
    AND COALESCE(t.propiedades_extra->>'archivada_render_os','false')<>'true'
    AND COALESCE(t.propiedades_extra->>'papelera_render_os','false')<>'true'
    AND (t.cliente_id IS NULL OR c.activo IS DISTINCT FROM FALSE)
    AND ($4::integer IS NULL OR t.cliente_id=$4::integer)
    AND ($5::text='' OR strpos(lower(concat_ws(' ',t.titulo,c.nombre)),lower($5::text))>0)
), filtered AS MATERIALIZED (
  SELECT id,revision,titulo,estado,cliente_id,cliente_nombre,delivery_id,delivery_revision,delivery_at,
    decision_id,decision_delivery_id,decision_action,decision_revision,decision_at,has_corrections
  FROM candidates WHERE
    ($3::text='all' AND (awaiting_review OR decision_id IS NOT NULL))
    OR ($3::text='awaiting_review' AND awaiting_review)
    OR ($3::text='with_corrections' AND has_corrections)
), page AS (
  SELECT id,revision,titulo,estado,cliente_id,cliente_nombre,delivery_id,delivery_revision,delivery_at,
    decision_id,decision_delivery_id,decision_action,decision_revision,decision_at,has_corrections
  FROM filtered ORDER BY id DESC LIMIT $1::integer OFFSET $2::integer
)
SELECT jsonb_build_object('total',(SELECT count(*)::int FROM filtered),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'task_id',p.id,'revision',p.revision,'titulo',p.titulo,'estado',p.estado,
    'cliente',CASE WHEN p.cliente_id IS NULL THEN NULL ELSE jsonb_build_object('id',p.cliente_id,'nombre',p.cliente_nombre) END,
    'latest_delivery',CASE WHEN p.delivery_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',p.delivery_id,'task_revision',p.delivery_revision,'recorded_at',p.delivery_at) END,
    'latest_decision',CASE WHEN p.decision_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',p.decision_id,'delivery_id',p.decision_delivery_id,'action',p.decision_action,
      'task_revision',p.decision_revision,'recorded_at',p.decision_at) END,
    'has_corrections',p.has_corrections) ORDER BY p.id DESC) FROM page p),'[]'::jsonb)) AS inventory`;

const storageFault = () => new Error('No se pudo leer el inventario de feedback.');
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw storageFault();
  return value.toLowerCase();
}
function timestamp(value) {
  if (!(typeof value === 'string' || value instanceof Date)) throw storageFault();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw storageFault();
  return date.toISOString();
}
function itemDto(row) {
  if (!row || !positive(row.task_id) || !positive(row.revision) || typeof row.titulo !== 'string'
    || typeof row.estado !== 'string' || typeof row.has_corrections !== 'boolean') throw storageFault();
  let cliente = null;
  if (row.cliente !== null) {
    if (!row.cliente || !positive(row.cliente.id) || typeof row.cliente.nombre !== 'string') throw storageFault();
    cliente = { id: row.cliente.id, nombre: row.cliente.nombre };
  }
  const artifact = (value, decision = false) => {
    if (value === null) return null;
    if (!value || !positive(value.task_revision) || value.task_revision > row.revision) throw storageFault();
    const common = { id: uuid(value.id) };
    if (decision) {
      if (!['aprobada', 'correcciones'].includes(value.action)) throw storageFault();
      common.delivery_id = uuid(value.delivery_id);
      common.action = value.action;
    }
    return { ...common, task_revision: value.task_revision, recorded_at: timestamp(value.recorded_at) };
  };
  return { task_id: row.task_id, revision: row.revision, titulo: row.titulo, estado: row.estado,
    cliente, latest_delivery: artifact(row.latest_delivery), latest_decision: artifact(row.latest_decision, true),
    has_corrections: row.has_corrections, href: `/workspace/tareas?task=${row.task_id}` };
}

export async function readFeedbackTaskInventory(pool, auth, query = {}) {
  if (!positive(auth?.id) || !positive(auth?.session_version)) throw fail('Sesión requerida.', 401);
  const page = parseFeedbackTaskInventoryQuery(query);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [auth.id])).rows[0];
    if (!user || user.id !== auth.id || user.activo !== true || user.session_version !== auth.session_version
      || user.rol !== auth.rol) throw fail('La sesión ya no está autorizada.', 401);
    if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail('Este perfil no tiene acceso al inventario.', 403);
    const result = await db.query(FEEDBACK_TASK_INVENTORY_SQL, [page.limit, page.offset, page.view, page.cliente_id, page.q]);
    const data = result.rows[0]?.inventory;
    if (!data || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items)
      || data.items.length > page.limit) throw storageFault();
    const items = data.items.map(itemDto);
    if (new Set(items.map(item => item.task_id)).size !== items.length) throw storageFault();
    const body = { version: 1, limit: page.limit, offset: page.offset, total: data.total,
      has_more: data.total > page.offset + page.limit, items };
    await db.query('COMMIT');
    return body;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}
