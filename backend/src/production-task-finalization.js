import { getProductionProgress, isProductionComplete, isProductionVisitTask } from './production-visits.js';

const fail = message => Object.assign(new Error(message), { status: 400 });
const conflict = () => Object.assign(new Error('La visita cambió. Actualizá su evidencia antes de finalizar la tarea.'), { status: 409 });
export function normalizeExpectedProductionVisit(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'revision')
    || typeof value.id !== 'string' || value.id.length !== 36
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)
    || !Number.isSafeInteger(value.revision) || value.revision < 1) throw fail('La observación de la visita no es válida.');
  return Object.freeze({ id: value.id.toLowerCase(), revision: value.revision });
}

// Evidence only, never authority: role/membership checks stay in the writer.
export function productionFinalizationReadiness(taskRevision, previstos, total, grabados) {
  return { task_revision: taskRevision, previstos, grabados, total,
    habilitada: total > 0 && grabados === total && total >= previstos };
}

/** Called after the task UPDATE, before COMMIT. Registry writers take the same
 * task -> visit locks, so a concurrent recording cannot invalidate this check.
 * Closing work is explicit; it never confirms, publishes, or creates editing.
 */
export async function assertProductionTaskFinalization(db, task, sourceTask = task, expectedVisit) {
  const expected = normalizeExpectedProductionVisit(expectedVisit);
  // The observed source is protected by the UPDATE's task revision CAS. A
  // simultaneous rename/reclassification must not erase its completion rule.
  if (!isProductionVisitTask(sourceTask) && !isProductionVisitTask(task)) {
    if (expected) throw conflict();
    return;
  }
  const visit = (await db.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1 FOR UPDATE', [task.id])).rows[0];
  if (visit) {
    if (!expected) throw fail('Actualizá la visita antes de finalizarla: falta su observación.');
    if (expected.id !== visit.id || expected.revision !== visit.revision) throw conflict();
    const videos = (await db.query('SELECT estado FROM produccion_videos WHERE visita_id=$1 ORDER BY id', [visit.id])).rows;
    const planned = Math.max(getProductionProgress(sourceTask).planned, getProductionProgress(task).planned);
    const readiness = productionFinalizationReadiness(sourceTask.revision, planned, videos.length,
      videos.filter(video => video.estado === 'grabado').length);
    if (readiness.habilitada) return;
    if (!videos.length) throw fail('Registrá los videos de esta visita en Producciones antes de finalizarla.');
    if (videos.some(video => video.estado !== 'grabado')) throw fail('La visita tiene videos sin grabar o para repetir. Revisalos en Producciones antes de finalizarla.');
    if (planned > videos.length) throw fail(`Todavía faltan ${planned - videos.length} videos para finalizar esta visita.`);
    return;
  }
  if (expected) throw conflict();
  // Historical, unlinked aggregate records retain their existing rule. Never
  // add them to canonical videos or reinterpret them as identified media.
  const progress = getProductionProgress(sourceTask);
  if (!isProductionComplete(sourceTask)) throw fail(progress.planned === 0
    ? 'Indicá cuántos videos tiene la visita antes de finalizarla.'
    : `Todavía faltan ${progress.remaining} videos para finalizar esta visita.`);
}
