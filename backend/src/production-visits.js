export function normalizeProductionText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export function isProductionVisitTask(task = {}) {
  const text = normalizeProductionText(`${task.titulo || ""} ${task.subtipo || ""} ${task.propiedades_extra?.clickup_lista || ""}`);
  return task.tipo_tarea === "produccion" && text.includes("visita");
}

export function getProductionProgress(task = {}) {
  const plannedValue = Number(task.propiedades_extra?.produccion_videos_previstos);
  const planned = Number.isInteger(plannedValue) && plannedValue > 0 ? plannedValue : 0;
  const records = Array.isArray(task.propiedades_extra?.produccion_registros) ? task.propiedades_extra.produccion_registros : [];
  const recorded = records.reduce((total, item) => {
    const amount = Number(item?.cantidad);
    return total + (Number.isInteger(amount) && amount > 0 ? amount : 0);
  }, 0);
  return { planned, recorded, remaining: Math.max(planned - recorded, 0) };
}

export function getProductionTaskState({ planned = 0, recorded = 0 } = {}) {
  const expected = Number(planned) || 0;
  const completed = Number(recorded) || 0;
  if (expected > 0 && completed >= expected) return "en_revision";
  if (completed > 0) return "en_progreso";
  return "pendiente";
}

export function getProductionPhase(task = {}) {
  const progress = getProductionProgress(task);
  if (isProductionVisitTask(task)) {
    if (task.propiedades_extra?.produccion_confirmada_at) return "grabacion_confirmada";
    if (progress.planned > 0 && progress.recorded >= progress.planned) return "grabacion_completa";
    if (progress.recorded > 0) return "grabacion";
  }
  if (task.estado === "programada") return "programada";
  if (task.estado === "publicada") return "publicada";
  if (task.tipo_tarea === "edicion") return "edicion";
  return null;
}

export function nextProductionPeriod(dateValue) {
  const match = /^(\d{4})-(\d{2})/.exec(String(dateValue || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function canRecordProduction(auth = {}) {
  if (auth.rol === "admin") return true;
  return normalizeProductionText(auth.nombre || auth.usuario).split(/\s+/)[0] === "german";
}

export function isValidProductionDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
