import { sumarDiasISO } from "../../../shared/date/date-utils.js";

const normalize = (value) => String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function dashboardToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function belongsToUser(names, user) {
  const aliases = [user?.nombre, user?.usuario].map(normalize).filter(Boolean);
  return names.some((name) => aliases.includes(normalize(name)));
}
export function taskPeople(task) {
  return [...new Set([task.asignado_a, ...(Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [])].filter(Boolean))];
}
export function activeTasks(tasks) {
  return tasks.filter((task) => task.estado !== "publicada" && ![true, "true"].includes(task.propiedades_extra?.papelera_render_os) && ![true, "true"].includes(task.propiedades_extra?.archivada_render_os));
}
export function isWaitingReview(task) {
  return task.estado === "en_revision" && ![true, "true"].includes(task.propiedades_extra?.revision_aprobada);
}
export const DASHBOARD_STAGES = [
  { id: "pending", label: "Pendientes", color: "var(--render-accent)" },
  { id: "progress", label: "En proceso", color: "#6480b5" },
  { id: "reviews", label: "En revisión", color: "#d5a34a" },
  { id: "ready", label: "Listas para publicar", color: "#9985b9" },
  { id: "done", label: "Finalizadas", color: "var(--render-success)" },
  { id: "other", label: "Otros estados", color: "#a7ada2" },
];
export function taskStage(task) {
  if (task.estado === "publicada") return "done";
  if (isWaitingReview(task)) return "reviews";
  if (task.estado === "en_revision") return "ready";
  if (task.estado === "en_progreso") return "progress";
  if (task.estado === "pendiente") return "pending";
  return "other";
}
export function dashboardCharts(tasks, today, team = false) {
  const stages = DASHBOARD_STAGES.map((stage) => ({ ...stage, count: tasks.filter((task) => taskStage(task) === stage.id).length }));
  const open = activeTasks(tasks);
  const agenda = Array.from({ length: 7 }, (_, index) => {
    const date = sumarDiasISO(today, index);
    return { date, count: open.filter((task) => task.fecha_vencimiento === date).length };
  });
  const loads = new Map();
  for (const task of open) {
    // One task belongs to one group; collaborators don't inflate totals.
    const name = team ? task.asignado_a || "Sin responsable principal" : task.cliente_nombre || "Sin cliente";
    const current = loads.get(name) || { name, count: 0, late: 0 };
    current.count += 1;
    if (task.fecha_vencimiento && task.fecha_vencimiento < today) current.late += 1;
    loads.set(name, current);
  }
  return { stages, agenda, loads: [...loads.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), total: tasks.length };
}
export function priorityForTask(task, today) {
  const date = task.fecha_vencimiento;
  if (date && date < today) return { rank: 0, label: "Vencida", tone: "late" };
  if (date === today) return { rank: 1, label: "Para hoy", tone: "today" };
  if (date && date <= sumarDiasISO(today, 7)) return { rank: 2, label: "Próximos 7 días", tone: "soon" };
  if (task.estado === "en_progreso") return { rank: 3, label: "En proceso", tone: "progress" };
  return { rank: 4, label: date ? "Próxima entrega" : "Sin fecha", tone: "neutral" };
}
export function orderTasks(tasks, today) {
  return [...tasks].sort((a, b) => priorityForTask(a, today).rank - priorityForTask(b, today).rank
    || String(a.fecha_vencimiento || "9999").localeCompare(String(b.fecha_vencimiento || "9999"))
    || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}
export function pendingFeedback(notes, user, team = false, permanent = false) {
  return notes.filter((note) => {
    if (!note.feedback || typeof note.feedback !== "object" || Array.isArray(note.feedback) || !Object.keys(note.feedback).length) return false;
    if (note.eliminado_at || note.feedback.estado === "resuelto") return false;
    if ((note.feedback.vigencia === "permanente") !== permanent) return false;
    const names = Array.isArray(note.feedback?.responsables) ? note.feedback.responsables : [note.feedback?.responsable];
    return team || belongsToUser(names, user);
  });
}
