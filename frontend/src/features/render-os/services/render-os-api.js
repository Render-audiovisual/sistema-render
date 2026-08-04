const WORKSPACE_QUERY = "workspace=render_os";

export async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body;
}

export function apiJson(url) {
  return apiRequest(url).then((body) => Array.isArray(body) ? body : []);
}

export async function apiTaskPage(offset = 0) {
  const response = await fetch(`/api/tareas?${WORKSPACE_QUERY}&incluir_archivadas=true&limit=500&offset=${offset}`);
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body.error || "No se pudieron cargar las tareas.");
  const items = Array.isArray(body) ? body : [];
  const totalHeader = Number.parseInt(response.headers.get("X-Total-Count"), 10);
  return { items, total: Number.isFinite(totalHeader) ? totalHeader : offset + items.length };
}

export function apiTaskById(id) {
  return apiRequest(`/api/tareas/${id}?${WORKSPACE_QUERY}`);
}

export function apiSubtasks(id) {
  return apiJson(`/api/tareas/${id}/subtareas?${WORKSPACE_QUERY}`);
}
