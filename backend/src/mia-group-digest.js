import crypto from "node:crypto";
import { getProductionProgress, isProductionVisitTask } from "./production-visits.js";

const DONE_STATES = new Set(["en_revision", "publicada"]);
const OPEN_STATES = new Set(["pendiente", "en_progreso", "en_proceso", "en_revision"]);

function normalized(value = "") {
  return String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function dateOnly(value) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
}

function areaForTask(task = {}) {
  const text = normalized(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`);
  if (task.tipo_tarea === "produccion" && isProductionVisitTask(task)) return "visitas";
  if (task.tipo_tarea === "edicion") return "edicion";
  if (task.tipo_tarea === "diseno" || task.tipo_tarea === "community" || text.includes("carrusel")) return "comunicacion";
  return null;
}

function isObjectiveTask(task, area) {
  if (area === "comunicacion") return normalized(`${task.titulo || ""} ${task.subtipo || ""}`).includes("carrusel");
  return area === "edicion" || area === "visitas";
}

function monthProgress(today) {
  const [year, month, day] = today.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(1, Math.max(0, day / days));
}

function riskLevel(item, today, expected) {
  if (item.blocked > 0 || item.overdue > 0) return "critico";
  if (item.done < expected || item.dueToday > 0 || item.high > 0) return "riesgo";
  return "ok";
}

function formatAreaItem(item) {
  const owner = item.owner ? ` · ${item.owner}` : "";
  if (item.area === "visitas") {
    return `• ${item.client}${owner}: ${item.done}/${item.target} videos registrados${item.blocked ? ` · ${item.blocked} bloqueo${item.blocked === 1 ? "" : "s"}` : ""}${item.overdue ? ` · ${item.overdue} vencida${item.overdue === 1 ? "" : "s"}` : ""}`;
  }
  const noun = item.area === "edicion" ? "ediciones listas" : "carruseles listos";
  return `• ${item.client}${owner}: ${item.done}/${item.target} ${noun}${item.blocked ? ` · ${item.blocked} bloqueo${item.blocked === 1 ? "" : "s"}` : ""}${item.overdue ? ` · ${item.overdue} vencida${item.overdue === 1 ? "" : "s"}` : ""}`;
}

function actionFor(area) {
  if (area === "visitas") return "Registren el avance real en las tareas y prioricen primero las visitas vencidas o bloqueadas.";
  if (area === "edicion") return "Prioricen las ediciones vencidas y pasen a Revisar todo lo que ya esté terminado.";
  return "Prioricen los carruseles vencidos y pasen a Revisar todo lo que ya esté terminado.";
}

function digestFingerprint(destination, period, items) {
  const state = items.map((item) => [item.area, item.client, item.owner, item.target, item.done, item.overdue, item.blocked, item.high, item.level].join("|")).sort().join(";");
  return crypto.createHash("sha256").update(`${destination}|${period}|${state}`).digest("hex");
}

export function buildMiaGroupDigests(tasks = [], { today = new Date().toISOString().slice(0, 10) } = {}) {
  const period = today.slice(0, 7);
  const progress = monthProgress(today);
  const groups = new Map();

  for (const task of tasks) {
    if (task?.propiedades_extra?.workspace !== "render_os" || task.propiedades_extra?.papelera_render_os === true) continue;
    const area = areaForTask(task);
    const due = dateOnly(task.fecha_vencimiento);
    if (!area || !isObjectiveTask(task, area) || (!OPEN_STATES.has(task.estado) && task.estado !== "publicada")) continue;
    if (due && due.slice(0, 7) !== period && !(OPEN_STATES.has(task.estado) && due < today)) continue;
    const client = task.cliente_nombre || "Sin cliente";
    const owner = task.asignado_a || "Sin responsable";
    const key = `${area}|${client}|${owner}`;
    if (!groups.has(key)) groups.set(key, { area, client, owner, target: 0, done: 0, overdue: 0, dueToday: 0, blocked: 0, high: 0, taskIds: [] });
    const item = groups.get(key);
    item.taskIds.push(Number(task.id));
    const blocked = task.propiedades_extra?.bloqueada === true;
    if (blocked) item.blocked += 1;
    if (task.prioridad === "alta" && !DONE_STATES.has(task.estado)) item.high += 1;
    if (due === today && !DONE_STATES.has(task.estado)) item.dueToday += 1;
    if (due && due < today && !DONE_STATES.has(task.estado)) item.overdue += 1;
    if (area === "visitas") {
      const production = getProductionProgress(task);
      item.target += production.planned;
      item.done += Math.min(production.recorded, production.planned || production.recorded);
    } else {
      item.target += 1;
      if (DONE_STATES.has(task.estado)) item.done += 1;
    }
  }

  const risky = [...groups.values()].map((item) => {
    const expected = Math.ceil(item.target * progress);
    return { ...item, expected, level: riskLevel(item, today, expected) };
  }).filter((item) => item.level !== "ok" && item.target > 0);

  const clientAreas = new Map();
  for (const item of risky) {
    if (!clientAreas.has(item.client)) clientAreas.set(item.client, new Set());
    clientAreas.get(item.client).add(item.area);
  }
  const transverseClients = new Set([...clientAreas].filter(([, areas]) => areas.size > 1).map(([client]) => client));
  const destinations = new Map();
  for (const item of risky) {
    const destination = transverseClients.has(item.client) ? "render_brain" : item.area;
    if (!destinations.has(destination)) destinations.set(destination, []);
    destinations.get(destination).push(item);
  }

  return [...destinations].map(([destination, items]) => {
    items.sort((a, b) => (a.level === b.level ? b.overdue - a.overdue : a.level === "critico" ? -1 : 1) || a.client.localeCompare(b.client));
    const title = destination === "render_brain" ? "Objetivos que requieren coordinación entre áreas"
      : destination === "comunicacion" ? "Comunicación — objetivos en riesgo"
        : destination === "edicion" ? "Edición — objetivos en riesgo" : "Visitas — objetivos en riesgo";
    const actions = destination === "render_brain"
      ? "Coordinen responsables y destraben primero los clientes que frenan a más de un área."
      : actionFor(destination);
    return {
      id: digestFingerprint(destination, period, items), destination, period,
      text: `${title}\n${items.map(formatAreaItem).join("\n")}\n\n${actions}`,
      task_ids: [...new Set(items.flatMap((item) => item.taskIds))],
      clients: [...new Set(items.map((item) => item.client))],
      level: items.some((item) => item.level === "critico") ? "critico" : "riesgo",
    };
  });
}

export function miaGroupDigestWindow(now = new Date(), timeZone = "America/Argentina/Cordoba") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const hour = Number(parts.hour);
  const friday = String(parts.weekday).toLowerCase().startsWith("fri");
  const monthly = Number(parts.day) === 28;
  if (hour === 9) return { type: "diario", criticalOnly: false };
  if (hour === 10 && (friday || monthly)) {
    return { type: friday && monthly ? "semanal_mensual" : monthly ? "mensual" : "semanal", criticalOnly: false };
  }
  if (hour === 18) return { type: "control_tarde", criticalOnly: true };
  return null;
}
