export const PRODUCTION_MONTHLY_TARGETS = [
  { name: "Luzin", target: 8, aliases: ["luzin", "lucin"] },
  { name: "Moketa", target: 8, aliases: ["moketa", "moqueta"] },
  { name: "El Ángel Azul Turismo", target: 4, aliases: ["el angel azul turismo", "angel azul turismo"] },
  { name: "El Ángel Azul Estudiantil", target: 4, aliases: ["el angel azul estudiantil", "angel azul estudiantil"] },
  { name: "Bohle", target: 6, aliases: ["bohle", "bole"] },
  { name: "Capital", target: 6, aliases: ["capital", "capital motos", "capital moto"] },
  { name: "Búnker", target: 4, aliases: ["bunker", "búnker"] },
];

export function normalizeProductionText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export function isProductionVisitTask(task = {}) {
  const text = normalizeProductionText(`${task.titulo || ""} ${task.subtipo || ""} ${task.propiedades_extra?.clickup_lista || ""}`);
  return task.tipo_tarea === "produccion" && text.includes("visita");
}

export function getProductionPlanned(task = {}) {
  const value = Number(task.propiedades_extra?.produccion_videos_previstos);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function getProductionRecords(task = {}) {
  return Array.isArray(task.propiedades_extra?.produccion_registros)
    ? task.propiedades_extra.produccion_registros.filter((item) => Number.isInteger(Number(item?.cantidad)) && Number(item.cantidad) > 0)
    : [];
}

export function getProductionRecorded(task = {}) {
  return getProductionRecords(task).reduce((total, item) => total + Number(item.cantidad), 0);
}

export function getProductionVisitProgress(task = {}) {
  const planned = getProductionPlanned(task);
  const recorded = getProductionRecorded(task);
  return { planned, recorded, remaining: Math.max(planned - recorded, 0), complete: planned > 0 && recorded >= planned };
}

export function getProductionPhase(task = {}) {
  const progress = getProductionVisitProgress(task);
  if (isProductionVisitTask(task)) {
    if (task.propiedades_extra?.produccion_confirmada_at) return { id: "grabacion_confirmada", label: "Grabación confirmada" };
    if (progress.complete) return { id: "grabacion_completa", label: "Grabación completa" };
    if (progress.recorded > 0) return { id: "grabacion", label: "Grabación" };
  }
  if (task.estado === "programada") return { id: "programada", label: "Programada" };
  if (task.estado === "publicada") return { id: "publicada", label: "Publicada" };
  if (task.tipo_tarea === "edicion") return { id: "edicion", label: "Edición" };
  return null;
}

export function getProductionTarget(clientName = "") {
  const normalized = normalizeProductionText(clientName);
  return PRODUCTION_MONTHLY_TARGETS.find((item) => item.aliases.some((alias) => normalized === normalizeProductionText(alias))) || null;
}

export function groupProductionByClient(tasks = [], from = "0000-00-00", to = "9999-99-99") {
  const recordedByTarget = new Map(PRODUCTION_MONTHLY_TARGETS.map((item) => [item.name, 0]));
  tasks.filter(isProductionVisitTask).forEach((task) => {
    const target = getProductionTarget(task.cliente_nombre);
    if (!target) return;
    const period = from.slice(0, 7);
    const amount = getProductionRecords(task).reduce((total, item) => {
      if (item.periodo_adelanto === period) return total + Number(item.cantidad_adelanto || 0);
      const itemPeriod = item.periodo_objetivo || String(item.fecha || "").slice(0, 7);
      if (itemPeriod !== period) return total;
      return total + Number(item.cantidad_mes_actual ?? item.cantidad);
    }, 0);
    recordedByTarget.set(target.name, recordedByTarget.get(target.name) + amount);
  });
  return PRODUCTION_MONTHLY_TARGETS.map((item) => ({
    nombre: item.name,
    objetivo: item.target,
    grabados: recordedByTarget.get(item.name) || 0,
    pendientes: Math.max(item.target - (recordedByTarget.get(item.name) || 0), 0),
  }));
}
