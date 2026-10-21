import { productionHistoryHash } from './production-history-hash.js';
import { productionBatchVideoEvidence } from './production-batch-evidence.js';
export { productionHistoryHash } from './production-history-hash.js';

export async function isReconciledProductionVideo(db, visit, source, videoId) {
  if (!videoId || !visit?.tarea_origen_id || !source) return false;
  const batch = await productionBatchVideoEvidence(db,visit,source,videoId);
  if (batch !== null) return batch;
  // A later/unmapped aggregate editing child cannot inherit this review.
  const children=(await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 ORDER BY id LIMIT 2",[String(visit.tarea_origen_id)])).rows;
  if(children.length>1)return false;
  const review = (await db.query(`SELECT r.source_history_hash,a.tarea_edicion_id AS adopted_task_id FROM produccion_reconciliacion_videos rv
    JOIN produccion_reconciliaciones r ON r.id=rv.reconciliacion_id
    LEFT JOIN produccion_edicion_adopciones a ON a.reconciliacion_id=r.id
    WHERE rv.video_id=$1 AND r.visita_id=$2 AND r.tarea_origen_id=$3`,
    [videoId,visit.id,visit.tarea_origen_id])).rows[0];
  if(!review||review.source_history_hash!==productionHistoryHash(source))return false;
  if(!children.length)return !review.adopted_task_id;
  // One explicit disposition covers only this receipt's exact original child.
  // Its deliveries/decisions stay live on that task; no approval is replicated.
  return Boolean((await db.query(`SELECT a.tarea_edicion_id FROM produccion_edicion_adopciones a
    JOIN produccion_reconciliaciones r ON r.id=a.reconciliacion_id
    JOIN produccion_reconciliacion_videos rv ON rv.reconciliacion_id=r.id
    JOIN produccion_videos adopted ON adopted.id=a.video_id AND adopted.visita_id=r.visita_id
      AND adopted.tarea_edicion_id=a.tarea_edicion_id
    JOIN produccion_visitas v ON v.id=r.visita_id
    JOIN tareas original ON original.id=a.tarea_edicion_id AND original.cliente_id=v.cliente_id
      AND original.tipo_tarea='edicion' AND original.propiedades_extra->>'workspace'='render_os'
      AND original.propiedades_extra->>'origen_visita_id'=r.tarea_origen_id::text
      AND original.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND original.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND original.historia_id IS NULL AND original.publicacion_id IS NULL
    WHERE rv.video_id=$1 AND r.visita_id=$2 AND r.tarea_origen_id=$3 AND a.tarea_edicion_id=$4
      AND NOT EXISTS(SELECT 1 FROM proyecto_tareas pt WHERE pt.tarea_id=original.id)
      AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas s WHERE s.tarea_id=original.id)`,
    [videoId,visit.id,visit.tarea_origen_id,children[0].id])).rows.length);
}
