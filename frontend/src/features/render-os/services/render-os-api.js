import { responsibleFilterId } from '../utils/task-responsible-filter.js';
import { isSessionFailure } from '../../../shared/session/captured-request.js';
import { validTaskOrderRevision, validTaskOrderSnapshot } from '../utils/task-manual-order.js';
import { taskQueryNotice } from '../utils/task-view-state.js';
import { requireTaskSubtaskParentId, verifyTaskSubtasks } from './task-subtask-collection.js';
const WORKSPACE_QUERY = "workspace=render_os";

export async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(error => { if (isSessionFailure(error)) throw error; return {}; });
  if (!response.ok) {
    const error = new Error(typeof body?.error === 'string' && body.error ? body.error : "No se pudo completar la operación.");
    error.status = response.status;
    const code = typeof body?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.exec(body.code);
    if (code && code[0] === body.code && body.code !== 'session_binding_obsolete') error.code = body.code;
    throw error;
  }
  return body;
}

export function apiJson(url, options) {
  return apiRequest(url, options).then((body) => {
    if (!Array.isArray(body)) throw new Error('No pudimos verificar la lista recibida. Volvé a consultarla.');
    return body;
  });
}

export function buildTaskPageUrl(options = {}) {
  const settings = typeof options === "number" ? { offset: options } : options;
  const limit = settings.limit === undefined ? 50 : settings.limit;
  const offset = settings.offset === undefined ? 0 : settings.offset;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    throw new Error("Paginación de tareas no válida.");
  }
  const params = new URLSearchParams({ workspace: "render_os", limit: String(limit), offset: String(offset) });
  const reviewScope = settings.reviewScope ?? '', status = settings.status ?? (reviewScope ? 'en_revision' : 'all');
  // This validates query shape only. The server independently verifies scope.
  const notice = taskQueryNotice({status,reviewScope,sort:settings.sort??'date',archiveMode:settings.archiveMode??'active'});
  if (notice) throw new Error(notice);
  if (status !== 'all') params.set('estado',status);
  if (reviewScope) params.set('review_scope',reviewScope);
  if (reviewScope && offset > 0 && !validTaskOrderSnapshot(settings.expectedReviewSnapshot)) throw new Error('Actualizá la cola desde el principio antes de continuar.');
  if (settings.expectedReviewSnapshot !== undefined) {
    if (!reviewScope || !validTaskOrderSnapshot(settings.expectedReviewSnapshot)) throw new Error('Snapshot de revisión inválido.');
    params.set('expected_review_snapshot',settings.expectedReviewSnapshot);
  }
  if (settings.sort !== undefined && !['date','manual'].includes(settings.sort)) throw new Error('Orden de tareas inválido.');
  if (settings.sort === 'manual') {
    params.set('sort','manual');
    if (offset > 0 && !validTaskOrderSnapshot(settings.expectedSnapshot)) throw new Error('Recargá la primera página antes de continuar el orden manual.');
    if (settings.expectedSnapshot !== undefined) {
      if (!validTaskOrderSnapshot(settings.expectedSnapshot)) throw new Error('Snapshot de tareas inválido.');
      params.set('expected_snapshot',settings.expectedSnapshot);
    }
  }
  if (settings.archiveMode === "trash") params.set("papelera", "true");
  if (settings.responsible !== undefined && settings.responsible !== "all") {
    const id = responsibleFilterId(settings.responsible);
    if (id === null) throw new Error("Elegí un responsable identificado antes de cargar las tareas.");
    params.set("asignado_a_id", String(id));
  }
  if (settings.client && settings.client !== "all") params.set("cliente_id", settings.client === "none" ? "none" : settings.client);
  if (settings.sector && settings.sector !== "all") params.set("tipo_tarea", settings.sector === "none" ? "none" : settings.sector);
  if (settings.priority && settings.priority !== "all") params.set("prioridad", settings.priority);
  if (settings.area && settings.area !== "all") params.set("area", settings.area);
  if (settings.query?.trim()) params.set("q", settings.query.trim());
  return `/api/tareas?${params.toString()}`;
}

export async function apiTaskPage(options = {}, requestOptions) {
  const settings = typeof options === "number" ? { offset: options } : options;
  const response = await fetch(buildTaskPageUrl(settings), requestOptions);
  const body = await response.json().catch(error => { if (isSessionFailure(error)) throw error; if(response.ok)throw new Error('No se pudo verificar la página de tareas.'); return []; });
  if (!response.ok) throw Object.assign(new Error(body?.error || "No se pudieron cargar las tareas."), {status:response.status});
  if (settings.reviewScope) {
    const reviewSnapshot=response.headers.get('X-Task-Review-Snapshot'),count=response.headers.get('X-Total-Count');
    if (!validTaskOrderSnapshot(reviewSnapshot) || typeof count!=='string' || !/^(0|[1-9]\d*)$/.test(count) || count.trim()!==count || !Number.isSafeInteger(Number(count))
      || !Array.isArray(body) || body.some(item=>!Number.isSafeInteger(item?.id)||item.id<1||item.id>2147483647) || new Set(body.map(item=>item.id)).size!==body.length
      || body.length!==Math.min(settings.limit??50,Math.max(0,Number(count)-(settings.offset??0)))) throw new Error('No se pudo verificar la cola de revisión. Actualizala desde el principio.');
    if (settings.expectedReviewSnapshot!==undefined && settings.expectedReviewSnapshot!==reviewSnapshot) throw Object.assign(new Error('La cola cambió. Actualizala desde el principio.'),{status:409});
    return {items:body,total:Number(count),reviewSnapshot};
  }
  if (settings.sort === 'manual') {
    const orderRevision=response.headers.get('X-Task-Order-Revision'),orderSnapshot=response.headers.get('X-Task-Order-Snapshot'),count=response.headers.get('X-Total-Count');
    if(!Array.isArray(body)||body.some(item=>!Number.isSafeInteger(item?.id)||item.id<=0||item.id>2147483647)||new Set(body.map(item=>item.id)).size!==body.length
      ||!validTaskOrderRevision(orderRevision)||!validTaskOrderSnapshot(orderSnapshot)||typeof count!=='string'||!/^(0|[1-9]\d*)$/.test(count)||count.trim()!==count||!Number.isSafeInteger(Number(count)))throw new Error('No se pudo verificar la página de orden manual.');
    if(settings.expectedSnapshot!==undefined&&settings.expectedSnapshot!==orderSnapshot)throw Object.assign(new Error('El orden o los filtros cambiaron. Recargá la primera página.'),{status:409});
    if(body.length!==Math.min(settings.limit??50,Math.max(0,Number(count)-(settings.offset??0))))throw new Error('La página manual está incompleta. Recargá la primera página.');
    return {items:body,total:Number(count),orderRevision,orderSnapshot};
  }
  const count = response.headers.get('X-Total-Count');
  if (typeof count !== 'string' || !/^(0|[1-9]\d*)$/.test(count) || count.trim() !== count || !Number.isSafeInteger(Number(count))
    || !Array.isArray(body) || body.some(item => !Number.isSafeInteger(item?.id) || item.id < 1 || item.id > 2147483647)
    || new Set(body.map(item => item.id)).size !== body.length
    || body.length !== Math.min(settings.limit ?? 50, Math.max(0, Number(count) - (settings.offset ?? 0)))) {
    throw new Error('No se pudo verificar la página de tareas.');
  }
  return { items: body, total: Number(count) };
}

export function apiTaskById(id, options) {
  return apiRequest(`/api/tareas/${id}?${WORKSPACE_QUERY}`, options);
}

export async function apiSubtasks(id, options) {
  requireTaskSubtaskParentId(id);
  return verifyTaskSubtasks(await apiJson(`/api/tareas/${id}/subtareas?${WORKSPACE_QUERY}`, options),id);
}
