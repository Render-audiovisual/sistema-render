const TABLES = { historia: 'historias', publicacion: 'publicaciones' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function positiveId(value) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value > 0 && value <= 2147483647 ? value : null;
}

// Never let Date.parse assign a local timezone or normalize impossible dates.
// PostgreSQL root timestamptz values may arrive as Date; JSON rows use ISO.
function utcInstant(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const iso = value.toISOString();
    return /^\d{4}-/.test(iso) && !iso.startsWith('0000-') ? iso : null;
  }
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, , zone, , oh, om] = m;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
  calendar.setUTCHours(0, 0, 0, 0);
  if (Number(y) < 1 || calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() + 1 !== Number(mo)
    || calendar.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59
    || (zone !== 'Z' && (Number(oh) > 23 || Number(om) > 59))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? utcInstant(new Date(time)) : null;
}

function scheduledDate(value) {
  if (value instanceof Date) return utcInstant(value)?.slice(0, 10) ?? null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = utcInstant(`${value}T00:00:00Z`);
  return iso?.slice(0, 10) === value ? value : null;
}

function safeRevision(value) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 1 ? value : 0;
}

function observedArchive(row) {
  return row.metadata?.archivado_tablero === true || row.metadata?.archivado_tablero === 'true';
}

function evidenceFor(domain, row, current) {
  const revision = safeRevision(current?.revision);
  const unknown = row.estado === 'publicada' || Boolean(row['fecha_publicación_real']);
  const fallback = { classification: unknown ? 'historica_sin_confirmacion' : 'no_publicada', revision, confirmation: null };
  if (!current || !revision || current.piece_archived !== false || current.cliente_activo !== true
    || observedArchive(row) || row.cliente_activo === false) return fallback;
  const id = positiveId(row.id), clientId = positiveId(row.cliente_id);
  const actual = utcInstant(row['fecha_publicación_real']);
  const occurred = utcInstant(current.event_occurred_at), recorded = utcInstant(current.event_recorded_at);
  const planned = scheduledDate(row.fecha_programada);
  if (!id || !clientId || !actual || !occurred || !recorded || !planned
    || positiveId(current.piece_id) !== id || positiveId(current.piece_cliente_id) !== clientId
    || row.estado !== 'publicada' || current.piece_estado !== row.estado
    || scheduledDate(current.piece_fecha_programada) !== planned
    || utcInstant(current.piece_actual_at) !== actual || occurred !== actual
    || typeof current.current_event_id !== 'string' || !UUID.test(current.current_event_id)
    || typeof current.event_id !== 'string' || !UUID.test(current.event_id)
    || current.current_event_id.toLowerCase() !== current.event_id.toLowerCase()
    || current.event_dominio !== domain || positiveId(current.event_pieza_id) !== id
    || positiveId(current.event_cliente_id) !== clientId || !positiveId(current.event_actor_id)
    || current.event_action !== 'confirmar' || current.event_source !== 'manual') return fallback;
  return { classification: 'confirmada_manualmente', revision,
    confirmation: { id: current.event_id.toLowerCase(), actor_id: positiveId(current.event_actor_id),
      occurred_at: occurred, recorded_at: recorded, source: 'manual' } };
}

/** Read-only batch annotation. Returns copies; callers still own row privacy DTOs.
 * The base observed row is part of the evidence check, not just a lookup key.
 * No transaction is started: callers may supply their existing snapshot client.
 */
export async function annotateEditorialEvidence(db, domain, rows) {
  if (!Object.hasOwn(TABLES, domain)) throw new TypeError('Dominio editorial inválido.');
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new TypeError('Filas editoriales inválidas.');
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(row => positiveId(row.id)).filter(id => id !== null))].sort((a, b) => a - b);
  let results = [];
  if (ids.length) {
    results = (await db.query(`SELECT p.id AS piece_id,p.cliente_id AS piece_cliente_id,p.estado AS piece_estado,
      p.fecha_publicación_real AS piece_actual_at,to_char(p.fecha_programada,'YYYY-MM-DD') AS piece_fecha_programada,
      (p.metadata->>'archivado_tablero' IS NOT DISTINCT FROM 'true') AS piece_archived,
      (c.id IS NOT NULL AND c.activo IS DISTINCT FROM FALSE) AS cliente_activo,
      v.revision,v.current_event_id,e.id AS event_id,e.dominio AS event_dominio,e.pieza_id AS event_pieza_id,
      e.cliente_id AS event_cliente_id,e.actor_id AS event_actor_id,e.action AS event_action,e.source AS event_source,
      e.occurred_at AS event_occurred_at,e.recorded_at AS event_recorded_at
      FROM ${TABLES[domain]} p LEFT JOIN clientes c ON c.id=p.cliente_id
      LEFT JOIN editorial_publicacion_versiones v ON v.dominio=$1 AND v.pieza_id=p.id
      LEFT JOIN editorial_publicacion_eventos e ON e.id=v.current_event_id AND e.dominio=v.dominio AND e.pieza_id=v.pieza_id
        AND e.cliente_id=p.cliente_id AND e.action='confirmar' AND e.source='manual'
        AND p.estado='publicada' AND p.fecha_publicación_real=e.occurred_at
      WHERE p.id=ANY($2::int[])`, [domain, ids])).rows;
  }
  const byId = new Map();
  for (const result of results) {
    const id = positiveId(result.piece_id);
    // A duplicate/inconsistent lookup result cannot choose evidence by order.
    if (id !== null) byId.set(id, byId.has(id) ? null : result);
  }
  return rows.map(row => ({ ...row, publicacion_evidencia: evidenceFor(domain, row, byId.get(positiveId(row.id))) }));
}
