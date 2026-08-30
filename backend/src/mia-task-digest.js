const ACTIVE_STATES = new Set(["pendiente", "en_proceso", "en_progreso", "en_revision", "programada"]);

function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dayDistance(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function isMiaReportWindow(now = new Date(), timeZone = "America/Argentina/Cordoba") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return weekday !== "Sun" && Number.isFinite(hour) && hour >= 8 && hour < 12;
}

export function classifyMiaTask(task, today = new Date().toISOString().slice(0, 10)) {
  if (task?.propiedades_extra?.workspace !== "render_os" || !ACTIVE_STATES.has(task.estado)) return null;
  const due = dateKey(task.fecha_vencimiento);
  const distance = due ? dayDistance(today, due) : null;
  if (distance !== null && distance < 0) return { rank: 0, category: "Vencidas" };
  if (String(task.prioridad).toLowerCase() === "alta" || task.espera_material === true) return { rank: 1, category: "Prioridad alta" };
  if (distance === 0) return { rank: 2, category: "Para hoy" };
  if (task.estado === "en_revision") return { rank: 3, category: "Para revisar" };
  if (task.estado === "programada") return { rank: 4, category: "Programadas" };
  if (distance !== null && distance <= 3) return { rank: 5, category: "Próximas" };
  return null;
}

export function buildMiaDigest(tasks, { today, maxItems = 8 } = {}) {
  const seen = new Set();
  const candidates = [];
  for (const task of tasks || []) {
    if (!task?.id || seen.has(String(task.id))) continue;
    seen.add(String(task.id));
    const classification = classifyMiaTask(task, today);
    if (classification) candidates.push({ ...task, ...classification });
  }
  candidates.sort((left, right) => left.rank - right.rank
    || String(left.fecha_vencimiento || "9999-12-31").localeCompare(String(right.fecha_vencimiento || "9999-12-31"))
    || Number(left.id) - Number(right.id));
  const selected = candidates.slice(0, Math.max(1, Math.min(Number(maxItems) || 8, 20)));
  if (!selected.length) return { text: "Todo está al día.", items: [], omitted: 0 };
  const lines = ["Resumen de tareas"];
  let lastCategory = "";
  for (const task of selected) {
    if (task.category !== lastCategory) {
      lines.push(`\n${task.category}`);
      lastCategory = task.category;
    }
    const owner = task.asignado_a ? ` · ${task.asignado_a}` : "";
    const client = task.cliente_nombre ? ` · ${task.cliente_nombre}` : "";
    lines.push(`• ${task.titulo}${client}${owner}`);
  }
  const omitted = candidates.length - selected.length;
  if (omitted > 0) lines.push(`\nY ${omitted} tarea${omitted === 1 ? "" : "s"} más en Render OS.`);
  return { text: lines.join("\n"), items: selected, omitted };
}

export function shouldSendImmediateMiaNotice(task, today = new Date().toISOString().slice(0, 10)) {
  if (task?.propiedades_extra?.workspace !== "render_os") return false;
  const due = dateKey(task.fecha_vencimiento);
  const distance = due ? dayDistance(today, due) : null;
  return String(task.prioridad).toLowerCase() === "alta" || (distance !== null && distance >= 0 && distance <= 1);
}

const MIA_STATE_EVENT_TYPES = new Map([
  ["en_revision", "tarea_en_revision"],
]);

export function buildMiaStatePendingMarker(task, previousState, createdAt = new Date().toISOString()) {
  if (task?.propiedades_extra?.workspace !== "render_os" || task.estado === previousState) return null;
  const type = MIA_STATE_EVENT_TYPES.get(task.estado);
  if (!type) return null;
  let destination = null;
  if (task.tipo_tarea === "produccion") destination = "visitas";
  else if (task.tipo_tarea === "edicion") destination = "edicion";
  else if (["diseno", "community"].includes(task.tipo_tarea)) destination = "comunicacion";
  if (!destination) return null;
  return { tipo: type, destino: destination, estado: task.estado, creado_en: createdAt };
}
