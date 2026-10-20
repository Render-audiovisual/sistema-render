import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}

// Only historical production evidence; ordinary title/priority edits do not
// invalidate review. Never return or copy arbitrary task metadata into a DTO.
export function productionHistoryHash(source) {
  const properties = source?.propiedades_extra || {};
  const history = Object.fromEntries(Object.keys(properties).filter(key => key.startsWith('produccion_')).sort().map(key => [key,properties[key]]));
  return createHash('sha256').update(JSON.stringify(canonical(history))).digest('hex');
}

export async function isReconciledProductionVideo(db, visit, source, videoId) {
  if (!videoId || !visit?.tarea_origen_id || !source) return false;
  // A later aggregate editing child cannot inherit this per-video review.
  if ((await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 LIMIT 1",[String(visit.tarea_origen_id)])).rows.length) return false;
  const review = (await db.query(`SELECT r.source_history_hash FROM produccion_reconciliacion_videos rv
    JOIN produccion_reconciliaciones r ON r.id=rv.reconciliacion_id
    WHERE rv.video_id=$1 AND r.visita_id=$2 AND r.tarea_origen_id=$3`,
    [videoId,visit.id,visit.tarea_origen_id])).rows[0];
  return Boolean(review && review.source_history_hash === productionHistoryHash(source));
}
