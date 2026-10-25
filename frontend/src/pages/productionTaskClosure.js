import { canUserEditTask, canUserMoveTask, isTaskFinalizer } from '../workspace-task-state.js';
import { isProductionVisitTask } from '../features/render-os/utils/production-visits.js';
import { canonicalTaskState } from '../features/render-os/constants.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function adoptProductionTaskObservation(confirmed, {taskId, minRevision, owner, generation, currentOwner}, adopt) {
  if (confirmed?.id !== taskId || !positive(confirmed.revision) || confirmed.revision < minRevision) throw new Error('No se pudo verificar la tarea actualizada.');
  if (owner !== currentOwner || owner.generation !== generation) return false;
  owner.baseline = JSON.parse(JSON.stringify(confirmed));
  adopt(confirmed);
  return true;
}

/** Only a current server observation can offer canonical closure. No fallback
 * to aggregate history, client-invented counts, names, or persisted preferences.
 */
export function productionTaskClosure(task, registry, user) {
  const link = registry?.ready && registry.vinculo?.tipo === 'origen' ? registry.vinculo : null;
  const evidence = link?.finalizacion;
  const observed = Boolean(isProductionVisitTask(task) && link && uuid(link.id) && positive(link.revision)
    && positive(task.revision) && evidence?.task_revision === task.revision
    && count(evidence.previstos) && count(evidence.grabados) && count(evidence.total)
    && evidence.grabados <= evidence.total && typeof evidence.habilitada === 'boolean');
  const complete = observed && evidence.habilitada === true && evidence.total > 0
    && evidence.total === evidence.grabados && evidence.grabados >= evidence.previstos;
  const authorized = isProductionVisitTask(task) && canUserMoveTask(task, user)
    && (isTaskFinalizer(user) || (user?.rol === 'produccion' && canUserEditTask(task, user)));
  return { observed, complete, authorized,
    finished: canonicalTaskState(task?.estado) === 'finalizada',
    expected: observed ? Object.freeze({ id: link.id, revision: link.revision }) : null,
    counts: observed ? { recorded: evidence.grabados, total: evidence.total, planned: evidence.previstos } : null };
}
