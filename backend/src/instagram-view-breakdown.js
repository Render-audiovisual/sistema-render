export const VIEWS_ACTION = 'media_views_v1';

const validNumber = value => value === null || (Number.isSafeInteger(value) && value >= 0);
const id = value => typeof value === 'string' && /^\d{1,40}$/.test(value);

// Preserve sub-millisecond precision in PostgreSQL timestamps; Date alone would
// incorrectly bind two different measurements in the same millisecond.
function timestamp(value) {
  if (value instanceof Date) return Number.isFinite(+value) ? timestamp(value.toISOString()) : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const instant = Date.parse(`${match[1]}T${match[2]}${match[4]}`);
  if (!Number.isFinite(instant)) return null;
  // Reject calendar overflow (e.g. February 30), including offset timestamps.
  const calendar = new Date(`${match[1]}T${match[2]}Z`);
  if (!Number.isFinite(+calendar) || calendar.toISOString().slice(0, 19) !== `${match[1]}T${match[2]}`) return null;
  return `${instant}:${(match[3] ?? '').replace(/0+$/, '')}`;
}

function binding(media, account, client, measured) {
  const time = timestamp(measured);
  return id(media) && id(account) && Number.isSafeInteger(client) && client > 0 && time !== null
    ? JSON.stringify([media, account, client, time]) : null;
}

/** One audit read; callers retain responsibility for authorization/membership.
 * Rows require ig_media_id, ig_user_id, cliente_id, medido_at and vistas.
 * No source rows are mutated and no combined total is synthesized.
 */
export async function readViewBreakdowns(db, rows) {
  const ids = [...new Set(rows.map(row => row.ig_media_id).filter(id))];
  const snapshots = new Map();
  const wanted = new Set(rows.map(row => binding(row.ig_media_id, row.ig_user_id, row.cliente_id, row.medido_at)).filter(Boolean));
  if (ids.length && wanted.size) {
    const result = await db.query(`SELECT detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND canal='system' AND actor_id='render-worker'
        AND resultado='ok' AND accion=$1 AND detalles->>'igMediaId'=ANY($2::text[])
      ORDER BY id DESC`, [VIEWS_ACTION, ids]);
    for (const { detalles: value } of result.rows) {
      if (!value || value.version !== 1 || !['instagram', 'facebook', 'total'].every(key => validNumber(value[key]))) continue;
      const key = binding(value.igMediaId, value.igUserId, value.clientId, value.measuredAt);
      if (key && wanted.has(key) && !snapshots.has(key)) snapshots.set(key, value);
    }
  }
  return rows.map(row => {
    const value = snapshots.get(binding(row.ig_media_id, row.ig_user_id, row.cliente_id, row.medido_at));
    const original = typeof row.vistas === 'string' && /^\d+$/.test(row.vistas) ? Number(row.vistas) : row.vistas;
    const fallback = validNumber(original) ? original : null;
    const total = value?.total ?? null, facebook = value?.facebook ?? null;
    const instagram = value?.instagram ?? (total !== null && facebook !== null && total >= facebook ? total - facebook : null);
    return { ...row, vistas: total ?? fallback, vistas_instagram: instagram ?? fallback,
      vistas_facebook: facebook, vistas_total: total };
  });
}
