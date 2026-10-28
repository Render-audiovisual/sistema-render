import { canonicalTaskState, isTaskCompleted, STATUSES } from "../constants.js";
import { getProductionVisitProgress, isProductionVisitTask } from "./production-visits.js";

export function mergeRelatedTasks(current, incoming) {
  const merged = [...current];
  for (const item of incoming) {
    const index = merged.findIndex((task) => task.id === item.id);
    if (index >= 0) {
      const observed = merged[index];
      // A related GET can finish after a confirmed update. Never roll that
      // row back to an older, valid server revision (including its parent).
      const validRevision = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
      if (validRevision(observed.revision) && validRevision(item.revision) && item.revision < observed.revision) continue;
      merged[index] = { ...observed, ...item };
    }
    else merged.push({ ...item, __renderOsDirectOnly: true });
  }
  return merged;
}
function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isValidActorId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
const isRenderOsTask = task => task?.propiedades_extra?.workspace === 'render_os';
const isActiveStateActor = user => isValidActorId(user?.id) && user.id <= 2147483647
  && user.activo !== false && typeof user.rol === 'string' && Boolean(user.rol.trim());

export function isTaskFinalizer(user) {
  return isValidActorId(user?.id) && (user.rol === "admin" || user.rol === "community");
}

function isOwnProductionTask(task, user) {
  return user?.rol === "produccion"
    && task?.tipo_tarea === "produccion"
    && isProductionVisitTask(task)
    && canUserOwnTask(task, user);
}

function canUserOwnTask(task, user) {
  if (!isValidActorId(user?.id)) return false;
  const collaborators = Array.isArray(task?.colaborador_ids)
    ? task.colaborador_ids
    : [];
  return task?.asignado_a_id === user.id || collaborators.includes(user.id);
}

export function canUserEditTask(task, user) {
  return (isValidActorId(user?.id) && user.rol === "admin") || canUserOwnTask(task, user);
}

export function canUserDeleteTask(task, user) {
  return (isValidActorId(user?.id) && user.rol === "admin") || canUserOwnTask(task, user);
}

export function canUserMoveTask(task, user) {
  // State-only board operation. This does NOT grant field editing, assignment,
  // deletion, approval evidence or actual editorial publication authority.
  if (isRenderOsTask(task)) return isActiveStateActor(user);
  if (isTaskFinalizer(user)) return true;
  if (isTaskCompleted(task)) return isOwnProductionTask(task, user);
  return canUserOwnTask(task, user);
}

export function canUserMoveTaskToState(task, user, nextState) {
  if (!canUserMoveTask(task, user)) return false;
  if (!STATUSES.some((state) => state.id === nextState)) return false;
  const currentState = canonicalTaskState(task?.estado);
  if (nextState === "aprobada") return user.rol === "admin" && currentState === "en_revision";
  if (isRenderOsTask(task)) {
    // No approval prerequisite or ownership restriction for operational states.
    // A visit cannot be represented as complete by inventing recorded material.
    return nextState !== 'finalizada' || !isProductionVisitTask(task) || getProductionVisitProgress(task).complete;
  }
  if (nextState === "finalizada") {
    // Existing visit completion is the only direct-finalization exception.
    const completedVisit = isProductionVisitTask(task) && getProductionVisitProgress(task).complete;
    return (isProductionVisitTask(task) ? completedVisit : currentState === "aprobada")
      && (isTaskFinalizer(user) || isOwnProductionTask(task, user));
  }
  if (isTaskCompleted(task)) {
    return isTaskFinalizer(user) || isOwnProductionTask(task, user);
  }
  return true;
}

export function canRetryTaskUpdate(previous, current, changes) {
  if (!previous || !current || !changes) return false;
  return Object.entries(changes).every(([field, value]) => {
    if (field === "propiedades_extra" && value && typeof value === "object") {
      const previousMetadata = previous.propiedades_extra || {};
      const currentMetadata = current.propiedades_extra || {};
      return Object.keys(value).every((key) => sameValue(previousMetadata[key], currentMetadata[key]));
    }
    return sameValue(previous[field], current[field]);
  });
}
