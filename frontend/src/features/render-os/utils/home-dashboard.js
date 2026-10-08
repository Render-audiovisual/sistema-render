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
