import { getProductionProgress, isProductionComplete, isProductionVisitTask } from './production-visits.js';

const fail = message => Object.assign(new Error(message), { status: 400 });

/** Called after the task UPDATE, before COMMIT. Registry writers take the same
 * task -> visit locks, so a concurrent recording cannot invalidate this check.
 * Closing work is explicit; it never confirms, publishes, or creates editing.
 */
export async function assertProductionTaskFinalization(db, task, sourceTask = task) {
  // The observed source is protected by the UPDATE's task revision CAS. A
  // simultaneous rename/reclassification must not erase its completion rule.
  if (!isProductionVisitTask(sourceTask) && !isProductionVisitTask(task)) return;
  const visit = (await db.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1 FOR UPDATE', [task.id])).rows[0];
  if (visit) {
    const videos = (await db.query('SELECT estado FROM produccion_videos WHERE visita_id=$1 ORDER BY id', [visit.id])).rows;
    const planned = Math.max(getProductionProgress(sourceTask).planned, getProductionProgress(task).planned);
    if (!videos.length) throw fail('Registrá los videos de esta visita en Producciones antes de finalizarla.');
    if (videos.some(video => video.estado !== 'grabado')) throw fail('La visita tiene videos sin grabar o para repetir. Revisalos en Producciones antes de finalizarla.');
    if (planned > videos.length) throw fail(`Todavía faltan ${planned - videos.length} videos para finalizar esta visita.`);
    return;
  }
  // Historical, unlinked aggregate records retain their existing rule. Never
  // add them to canonical videos or reinterpret them as identified media.
  const progress = getProductionProgress(sourceTask);
  if (!isProductionComplete(sourceTask)) throw fail(progress.planned === 0
    ? 'Indicá cuántos videos tiene la visita antes de finalizarla.'
    : `Todavía faltan ${progress.remaining} videos para finalizar esta visita.`);
}
