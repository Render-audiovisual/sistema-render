const WORKSPACE_QUERY = "workspace=render_os";

export async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "No se pudo completar la operación.");
    error.status = response.status;
    throw error;
  }
  return body;
}

export function apiJson(url) {
  return apiRequest(url).then((body) => Array.isArray(body) ? body : []);
}

export function buildTaskPageUrl(options = {}) {
  const settings = typeof options === "number" ? { offset: options } : options;
  const params = new URLSearchParams({ workspace: "render_os", limit: "100", offset: String(settings.offset || 0) });
  if (settings.archiveMode === "trash") params.set("papelera", "true");
  if (settings.responsible && settings.responsible !== "all") params.set("asignado_a", settings.responsible);
  if (settings.client && settings.client !== "all") params.set("cliente_id", settings.client === "none" ? "none" : settings.client);
  if (settings.sector && settings.sector !== "all") params.set("tipo_tarea", settings.sector === "none" ? "none" : settings.sector);
  if (settings.priority && settings.priority !== "all") params.set("prioridad", settings.priority);
  if (settings.area && settings.area !== "all") params.set("area", settings.area);
  if (settings.query?.trim()) params.set("q", settings.query.trim());
  return `/api/tareas?${params.toString()}`;
}

export async function apiTaskPage(options = {}) {
  const settings = typeof options === "number" ? { offset: options } : options;
  const response = await fetch(buildTaskPageUrl(settings));
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las tareas.");
  const items = Array.isArray(body) ? body : [];
  const totalHeader = Number.parseInt(response.headers.get("X-Total-Count"), 10);
  return { items, total: Number.isFinite(totalHeader) ? totalHeader : (settings.offset || 0) + items.length };
}

export function apiTaskById(id) {
  return apiRequest(`/api/tareas/${id}?${WORKSPACE_QUERY}`);
}

export function apiSubtasks(id) {
  return apiJson(`/api/tareas/${id}/subtareas?${WORKSPACE_QUERY}`);
}
