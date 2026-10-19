// Caller holds the source-task lock, shared with normalized registry writers.
export async function rejectMixedProductionRecording(db, taskId) {
  const linked = await db.query(`SELECT v.id FROM produccion_visitas v
    WHERE v.tarea_origen_id=$1 AND (
      EXISTS(SELECT 1 FROM produccion_videos pv WHERE pv.visita_id=v.id)
      OR EXISTS(SELECT 1 FROM produccion_fotos pf WHERE pf.visita_id=v.id)) LIMIT 1`, [taskId]);
  if (linked.rows.length) throw Object.assign(new Error("Esta visita se registra por video en Producciones. Continuá allí para no duplicar el contenido."), { status: 409 });
}
