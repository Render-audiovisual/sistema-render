import { parseHomeMonthlyProgress } from '../components/homeMonthlyProgress.js';

const positive = (value) => Number.isSafeInteger(value) && value > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const text = (value) => typeof value === "string";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const invalid = () => { throw new Error("La respuesta de Inicio no es válida. Actualizá para volver a consultar."); };
function client(value, nullable = false) {
  if (nullable && value === null) return null;
  if (!value || !positive(value.id) || !text(value.nombre)) invalid();
  return { id: value.id, nombre: value.nombre };
}
function rows(value, limit, project) {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return value.map(project);
}
function task(value) {
  if (!value || !positive(value.id) || !positive(value.revision) || !text(value.titulo)
    || !text(value.estado) || !text(value.prioridad) || !(value.fecha_vencimiento === null || date(value.fecha_vencimiento))
    || value.href !== `/workspace/tareas?task=${value.id}`) invalid();
  return { id: value.id, revision: value.revision, titulo: value.titulo, estado: value.estado, prioridad: value.prioridad,
    fecha_vencimiento: value.fecha_vencimiento, cliente: client(value.cliente, true), href: value.href };
}

// Project only the documented DTO; never keep arbitrary metadata in UI state.
export function parsePersonalHome(value, userId, allowTeamReview = false) {
  if (!positive(userId) || value?.version !== 1 || value.user?.id !== userId || !text(value.user.nombre)
    || !date(value.today) || !text(value.generated_at) || !Number.isFinite(Date.parse(value.generated_at))) invalid();
  const summary = {};
  for (const key of ["open", "overdue", "today", "upcoming", "undated", "awaiting_review"]) {
    if (!count(value.summary?.[key])) invalid();
    summary[key] = value.summary[key];
  }
  if (!value.review || !["team", "personal"].includes(value.review.scope)
    || (value.review.scope === "team" && !allowTeamReview) || !count(value.review.total)) invalid();
  const tasks = rows(value.tasks, 12, task);
  const review = { scope: value.review.scope, total: value.review.total, items: rows(value.review.items, 8, task) };
  const clients = rows(value.clients, 8, (item) => {
    if (!count(item?.open)) invalid();
    return { ...client(item), open: item.open };
  });
  const visits = rows(value.visits, 8, (item) => {
    if (!item || !uuid.test(item.id) || !text(item.titulo) || !date(item.fecha)
      || item.href !== `/producciones?visita=${item.id}&mes=${item.fecha.slice(0, 7)}`) invalid();
    return { id: item.id, titulo: item.titulo, fecha: item.fecha, cliente: client(item.cliente), href: item.href };
  });
  const activity = rows(value.activity, 8, (item) => {
    if (!item || !positive(item.task_id) || !text(item.titulo) || !text(item.estado)
      || !text(item.updated_at) || !Number.isFinite(Date.parse(item.updated_at))
      || item.href !== `/workspace/tareas?task=${item.task_id}`) invalid();
    return { task_id: item.task_id, titulo: item.titulo, estado: item.estado, updated_at: item.updated_at, href: item.href };
  });
  const list_totals = {};
  for (const [key, list] of Object.entries({ clients, visits, activity })) {
    if (!count(value.list_totals?.[key]) || value.list_totals[key] < list.length) invalid();
    list_totals[key] = value.list_totals[key];
  }
  if (typeof value.capabilities?.projects !== 'boolean') invalid();
  const hasProjects = value.capabilities.projects;
  const projects = hasProjects ? rows(value.projects, 8, item => {
    if (!item || !uuid.test(item.id) || !text(item.titulo) || !text(item.tipo) || !text(item.estado)
      || !positive(item.revision) || !(item.fecha_entrega === null || date(item.fecha_entrega))
      || item.href !== `/proyectos?proyecto=${item.id}`) invalid();
    return { id: item.id, titulo: item.titulo, tipo: item.tipo, estado: item.estado,
      revision: item.revision, fecha_entrega: item.fecha_entrega, cliente: client(item.cliente), href: item.href };
  }) : [];
  if (hasProjects && (!count(value.list_totals?.projects) || value.list_totals.projects < projects.length)) invalid();
  list_totals.projects = hasProjects ? value.list_totals.projects : 0;
  if (summary.open < tasks.length || review.total < review.items.length) invalid();
  return { version: 1, generated_at: value.generated_at, today: value.today, user: { id: userId, nombre: value.user.nombre },
    summary, tasks, review, clients, visits, activity, projects, list_totals, capabilities: { projects: hasProjects },
    ...(value.monthly_progress === undefined ? {} : { monthly_progress: parseHomeMonthlyProgress(value.monthly_progress, value.today) }) };
}

export function homeDate(value, full = false) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: full ? "long" : "short", ...(full ? { weekday: "long" } : {}) })
    .format(new Date(`${value}T12:00:00Z`));
}
export function homeStateLabel(value) {
  return ({ pendiente: "Pendiente", en_progreso: "En progreso", en_revision: "En revisión", aprobada: "Aprobada", finalizada: "Finalizada", publicada: "Finalizada" })[value] || `Estado: ${value}`;
}
export function homeDeadline(value, today) {
  if (!value) return "Sin fecha";
  return value === today ? "Hoy" : `${value < today ? "Venció el " : ""}${homeDate(value)}`;
}
export function personalHomeNavigate(event, href, onNavigate) {
  if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(href);
}

export function createPersonalHomeLoader({ request, userId, allowTeamReview = false, onChange, now = Date.now }) {
  let controller, version = 0, disposed = false, lastRequest = -Infinity, inFlight = false;
  async function refresh({ background = false } = {}) {
    if (disposed || (background && (inFlight || now() - lastRequest < 30000))) return false;
    controller?.abort();
    const current = ++version;
    controller = new AbortController();
    const signal = controller.signal;
    lastRequest = now();
    inFlight = true;
    onChange({ status: "loading", data: null, error: "" });
    try {
      const result = await request("/api/inicio", { signal });
      if (disposed || signal.aborted || current !== version) return false;
      const data = parsePersonalHome(result, userId, allowTeamReview);
      onChange({ status: "ready", data, error: "" });
    } catch (error) {
      if (disposed || signal.aborted || current !== version) return false;
      const denied = [401, 403].includes(error.status);
      onChange({ status: "error", data: null, error: denied ? "No pudimos validar tu acceso. Volvé a iniciar sesión para consultar tu inicio." : "No pudimos cargar tu inicio. Reintentá para consultar los datos actuales." });
    } finally {
      if (current === version) inFlight = false;
    }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++version; controller?.abort(); } };
}

export function subscribePersonalHomeRefresh(loader, windowTarget = window, documentTarget = document) {
  const refresh = () => { if (documentTarget.visibilityState === "visible") void loader.refresh({ background: true }); };
  windowTarget.addEventListener("focus", refresh);
  windowTarget.addEventListener("online", refresh);
  documentTarget.addEventListener("visibilitychange", refresh);
  return () => {
    windowTarget.removeEventListener("focus", refresh);
    windowTarget.removeEventListener("online", refresh);
    documentTarget.removeEventListener("visibilitychange", refresh);
  };
}
