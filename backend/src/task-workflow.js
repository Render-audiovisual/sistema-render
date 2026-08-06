import { normalizarNombre } from "./email-notifications.js";
import { getProductionProgress, isProductionVisitTask } from "./production-visits.js";

export const TASK_LEADERS = ["Agustín", "Franco"];

function taskText(task = {}) {
  return normalizarNombre(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`);
}

export function isTaskLeader(auth = {}) {
  if (auth.rol === "admin") return true;
  const identity = normalizarNombre(`${auth.nombre || ""} ${auth.usuario || ""}`);
  return identity.includes("franco") || identity.includes("agustin") || identity.includes("lider");
}

export function isCarouselTask(task = {}) {
  return taskText(task).includes("carrusel");
}

export function isVideoEditingTask(task = {}) {
  const text = taskText(task);
  return task.tipo_tarea === "edicion" || text.includes("edicion") || text.includes("reel") || text.includes("video");
}

export function getStateNotification(task, previousState) {
  if (!task?.estado || task.estado === previousState) return null;
  if (task.estado === "en_progreso") {
    return { motivo: "en_progreso", recipients: TASK_LEADERS };
  }
  if (task.estado === "en_revision") {
    return {
      motivo: "revision",
      recipients: isCarouselTask(task) ? ["Oriana", ...TASK_LEADERS] : TASK_LEADERS,
    };
  }
  if (task.estado === "publicada") {
    return { motivo: "publicada", recipients: TASK_LEADERS };
  }
  return null;
}

export function validateProductionHandoff(task = {}) {
  if (!isProductionVisitTask(task)) return null;
  const progress = getProductionProgress(task);
  if (progress.planned <= 0 || progress.recorded < progress.planned) {
    return `Todavía faltan ${progress.remaining || progress.planned || 1} videos para enviar esta visita a edición.`;
  }
  if (!String(task.material_referencia || "").trim()) {
    return "Pegá el enlace de la carpeta de Google Drive antes de enviar la visita a edición.";
  }
  return null;
}
