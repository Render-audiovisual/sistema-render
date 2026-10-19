import { normalizarNombre } from "./email-notifications.js";
import { getProductionProgress, isProductionVisitTask, isProductionComplete } from "./production-visits.js";
import { isTaskFinalized, normalizeTaskState } from "./workflow-contract.js";

// Notification delivery targets only; these names never grant authority.
export const TASK_LEADERS = ["Agustín", "Franco"];

function taskText(task = {}) {
  return normalizarNombre(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`);
}

export function isTaskLeader(auth = {}) {
  // auth must be the verified identity supplied by authentication middleware.
  return auth.rol === "admin";
}

export function isTaskFinalizer(auth = {}) {
  return auth.rol === "admin" || auth.rol === "community";
}

export function isCarouselTask(task = {}) {
  return taskText(task).includes("carrusel");
}

export function isVideoEditingTask(task = {}) {
  const text = taskText(task);
  return task.tipo_tarea === "edicion" || text.includes("edicion") || text.includes("reel") || text.includes("video");
}

export function getStateNotification(task, previousState) {
  if (!task?.estado || normalizeTaskState(task.estado) === normalizeTaskState(previousState)) return null;
  if (task.estado === "en_progreso") {
    return { motivo: "en_progreso", recipients: TASK_LEADERS };
  }
  if (task.estado === "en_revision") {
    return {
      motivo: "revision",
      recipients: isCarouselTask(task) ? ["Oriana", ...TASK_LEADERS] : TASK_LEADERS,
    };
  }
  if (isTaskFinalized(task)) {
    return { motivo: task.estado === "publicada" ? "publicada" : "finalizada", recipients: TASK_LEADERS };
  }
  return null;
}

export function validateProductionHandoff(task = {}) {
  if (!isProductionVisitTask(task)) return null;
  const progress = getProductionProgress(task);
  if (!isProductionComplete(task)) {
    return `Todavía faltan ${progress.remaining || progress.planned || 1} videos para enviar esta visita a edición.`;
  }
  if (!String(task.material_referencia || "").trim()) {
    return "Pegá el enlace de la carpeta de Google Drive antes de enviar la visita a edición.";
  }
  return null;
}
