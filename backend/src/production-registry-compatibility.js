// Caller holds the source-task lock, shared with normalized registry writers.
// The origin link owns the recording workflow even before its first artifact.
// Existing aggregate history remains readable/reconcilable, never extended
// through another workflow after a canonical visit has been linked.
export async function rejectMixedProductionRecording(db, taskId) {
  const linked = await db.query(`SELECT v.id FROM produccion_visitas v
    WHERE v.tarea_origen_id=$1 LIMIT 1`, [taskId]);
  if (linked.rows.length) throw Object.assign(new Error("Esta visita se registra por video en Producciones. Continuá allí para no duplicar el contenido."), { status: 409,code:'PRODUCTION_CANONICAL_RECORDING_REQUIRED' });
}
