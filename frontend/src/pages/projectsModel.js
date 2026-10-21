export const PROJECT_TYPES = { web: "Web", chatbot: "Chatbot", mantenimiento: "Mantenimiento", automatizacion: "Automatización", otro: "Otro" };
export const PROJECT_STATES = { planificado: "Planificado", en_curso: "En curso", en_revision: "En revisión", pausado: "Pausado", finalizado: "Finalizado", cancelado: "Cancelado" };
export const STAGE_STATES = { pendiente: "Pendiente", en_progreso: "En progreso", completada: "Completada" };
export const MILESTONE_STATES = { pendiente: "Pendiente", completado: "Completado", cancelado: "Cancelado" };
export const DELIVERABLE_STATES = { pendiente: "Pendiente", en_revision: "En revisión", aprobado: "Aprobado", correcciones: "Correcciones" };
export const DELIVERABLE_EDIT_STATES = { pendiente: "Pendiente", en_revision: "En revisión", correcciones: "Correcciones" };
export const PROJECT_ACTIVITY = { crear_proyecto: "Creó el proyecto", editar_proyecto: "Editó el proyecto", crear_etapa: "Agregó una etapa", editar_etapa: "Editó una etapa", ordenar_etapas: "Ordenó las etapas", crear_hito: "Agregó un hito", editar_hito: "Editó un hito", crear_entregable: "Agregó un entregable", editar_entregable: "Editó un entregable", vincular_tarea: "Vinculó una tarea", desvincular_tarea: "Desvinculó una tarea" };
export const isProjectId = value => typeof value === "string" && value.length===36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw new Error(message); };
const invalid = () => fail("La respuesta de Proyectos no es válida. Volvé a consultar.");
const contentHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const pgRevision = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const string = value => typeof value === "string";
const nullableDate = value => value === null || date(value);
const enumValue = (value, values) => own(values, value);
function named(value) { if (!positive(value?.id) || !string(value.nombre)) invalid(); return { id: value.id, nombre: value.nombre }; }
function rows(value, limit, project) { if (!Array.isArray(value) || value.length > limit) invalid(); return value.map(project); }
function child(value) { if (!isProjectId(value?.id) || !string(value.titulo)) invalid(); return { id: value.id, titulo: value.titulo }; }
function stageId(value) { if (value !== null && !isProjectId(value)) invalid(); return value; }

export function safeProjectUrl(value) {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url) return "";
  if (url.length > 4000 || /\s/.test(url)) return null;
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : null; } catch { return null; }
}
export function projectHref(id) { if (!isProjectId(id)) invalid(); return `/proyectos?proyecto=${id}`; }
export function projectLocation(href) {
  const url = new URL(href, "https://local.invalid");
  const id = url.searchParams.get("proyecto");
  return { id: id && isProjectId(id) ? id.toLowerCase() : null, invalid: id !== null && !isProjectId(id) };
}
export function projectLocationUrl(href, id) {
  const url = new URL(href, "https://local.invalid");
  if (id !== null && !isProjectId(id)) invalid();
  id ? url.searchParams.set("proyecto", id) : url.searchParams.delete("proyecto");
  return `${url.pathname}${url.search}${url.hash}`;
}
export function projectsListUrl({ offset = 0, estado = "", archivados = false } = {}) {
  if (!count(offset) || (estado && !enumValue(estado, PROJECT_STATES))) invalid();
  const params = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (estado) params.set("estado", estado);
  if (archivados) params.set("archivados", "true");
  return `/api/proyectos?${params}`;
}

export function parseProject(value, detail = false) {
  if (!isProjectId(value?.id) || !positive(value.revision) || !string(value.titulo)
    || !enumValue(value.tipo, PROJECT_TYPES) || !enumValue(value.estado, PROJECT_STATES)
    || !nullableDate(value.fecha_inicio) || !nullableDate(value.fecha_entrega) || typeof value.archivado !== "boolean") invalid();
  const counts = {};
  for (const key of ["tareas", "finalizadas", "hitos", "entregables"]) { if (!count(value.counts?.[key])) invalid(); counts[key] = value.counts[key]; }
  const result = { id: value.id, revision: value.revision, titulo: value.titulo, cliente: named(value.cliente), responsable: named(value.responsable),
    tipo: value.tipo, estado: value.estado, fecha_inicio: value.fecha_inicio, fecha_entrega: value.fecha_entrega, archivado: value.archivado, counts, href: projectHref(value.id) };
  if (!detail) return result;
  if (!string(value.descripcion) || typeof value.permissions?.administrar !== "boolean" || typeof value.permissions?.editar !== "boolean"
    || !count(value.tareas_no_disponibles)) invalid();
  result.descripcion = value.descripcion;
  if (!Array.isArray(value.miembro_ids) || !value.miembro_ids.every(positive)) invalid();
  result.miembro_ids = [...new Set(value.miembro_ids)];
  result.permissions = { administrar: value.permissions.administrar, editar: value.permissions.editar };
  result.etapas = rows(value.etapas, 100, item => {
    const base = child(item); if (!count(item.posicion) || !enumValue(item.estado, STAGE_STATES)) invalid();
    return { ...base, posicion: item.posicion, estado: item.estado };
  }).sort((a, b) => a.posicion - b.posicion);
  result.hitos = rows(value.hitos, 200, item => {
    const base = child(item); if (!nullableDate(item.fecha) || !enumValue(item.estado, MILESTONE_STATES)) invalid();
    return { ...base, etapa_id: stageId(item.etapa_id), fecha: item.fecha, estado: item.estado };
  });
  result.entregables = rows(value.entregables, 200, item => {
    const base = child(item); if (!string(item.url) || !string(item.observaciones) || !enumValue(item.estado, DELIVERABLE_STATES)
      || !(item.aprobado_por_id === null || positive(item.aprobado_por_id))
      || !(item.aprobado_at === null || (string(item.aprobado_at) && Number.isFinite(Date.parse(item.aprobado_at))))) invalid();
    const keys=['contenido_revision','entregable_revision','aprobacion_actual_id','contenido_hash','aprobacion_versionada'];
    const versioned=keys.some(key=>own(item,key));
    if(versioned&&(!keys.every(key=>own(item,key))||!pgRevision(item.contenido_revision)||!pgRevision(item.entregable_revision)||!contentHash(item.contenido_hash)||!(item.aprobacion_actual_id===null||isProjectId(item.aprobacion_actual_id))||typeof item.aprobacion_versionada!=='boolean'
      ||item.aprobacion_versionada&&(item.estado!=='aprobado'||!isProjectId(item.aprobacion_actual_id)||!positive(item.aprobado_por_id)||!item.aprobado_at)))invalid();
    return { ...base, url: item.url, observaciones: item.observaciones, estado: item.estado, aprobado_por_id: item.aprobado_por_id, aprobado_at: item.aprobado_at,
      contenido_revision:versioned?item.contenido_revision:null,entregable_revision:versioned?item.entregable_revision:null,contenido_hash:versioned?item.contenido_hash:null,aprobacion_actual_id:versioned?item.aprobacion_actual_id:null,aprobacion_versionada:versioned&&item.aprobacion_versionada };
  });
  result.tareas = rows(value.tareas, 200, item => {
    if (!positive(item?.id) || !positive(item.revision) || !string(item.titulo) || !string(item.estado) || !string(item.prioridad)
      || !nullableDate(item.fecha_vencimiento) || item.href !== `/workspace/tareas?task=${item.id}`) invalid();
    return { id: item.id, titulo: item.titulo, estado: item.estado, prioridad: item.prioridad, revision: item.revision,
      fecha_vencimiento: item.fecha_vencimiento, etapa_id: stageId(item.etapa_id), href: item.href };
  });
  result.actividad = rows(value.actividad, 20, item => {
    const states = { ...PROJECT_STATES, ...STAGE_STATES, ...MILESTONE_STATES, ...DELIVERABLE_STATES };
    if (!(positive(item?.id) || (string(item?.id) && /^[1-9]\d*$/.test(item.id))) || !positive(item.actor_id)
      || !enumValue(item.accion, PROJECT_ACTIVITY) || !string(item.created_at) || !Number.isFinite(Date.parse(item.created_at))
      || !(item.recurso_id == null || isProjectId(item.recurso_id)) || !(item.tarea_id == null || positive(item.tarea_id))
      || ![item.estado_anterior, item.estado_nuevo].every(state => state == null || enumValue(state, states))) invalid();
    return { id: item.id, actor_id: item.actor_id, accion: item.accion, created_at: item.created_at,
      recurso_id: item.recurso_id ?? null, tarea_id: item.tarea_id ?? null, estado_anterior: item.estado_anterior ?? null, estado_nuevo: item.estado_nuevo ?? null };
  });
  result.tareas_no_disponibles = value.tareas_no_disponibles;
  return result;
}
export function parseProjectsPage(value) {
  if (!count(value?.total) || !positive(value.limit) || value.limit > 100 || !count(value.offset)) invalid();
  const proyectos = rows(value.proyectos, value.limit, item => parseProject(item));
  if (proyectos.length > value.total) invalid();
  return { proyectos, total: value.total, limit: value.limit, offset: value.offset };
}
export function observedProjectTask(value, expectedId, clientId) {
  if (!positive(expectedId) || value?.id !== expectedId || !positive(value.revision) || !string(value.titulo)
    || value.cliente_id !== clientId) fail("Elegí una tarea visible del mismo cliente. Consultala antes de vincular.");
  return { id: value.id, titulo: value.titulo, estado: value.estado, revision: value.revision, href: `/workspace/tareas?task=${value.id}` };
}
export function projectDate(value) { return value ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`)) : "Sin fecha"; }
export function projectError(error) {
  if (error?.status === 409) return "El proyecto o la tarea cambió, o conserva un vínculo incompatible. Conservamos tus datos: actualizá y revisá antes de volver a guardar.";
  if ([401, 403].includes(error?.status)) return "No tenés permiso actual para esta operación. Actualizá el proyecto para revisar tu acceso.";
  if ([400, 422].includes(error?.status)) return error.message;
  return "No se pudo completar la consulta u operación. Conservamos tus datos; no se reenviará automáticamente.";
}

function title(value) { if (!string(value) || !value.trim() || value.trim().length > 250) fail("Escribí un título de hasta 250 caracteres."); return value.trim(); }
function longText(value) { if (!string(value) || value.length > 20000) fail("El texto admite hasta 20.000 caracteres."); return value; }
function inputDate(value) { if (value === "" || value === null) return null; if (!date(value)) fail("Revisá la fecha indicada."); return value; }
function inputId(value) { const id = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value; if (!positive(id)) fail("Seleccioná un ID válido."); return id; }
function inputIds(value) { if (!Array.isArray(value)) fail("Revisá los miembros seleccionados."); const ids = value.map(inputId); if (new Set(ids).size !== ids.length) fail("No repitas miembros."); return ids.sort((a, b) => a - b); }
function inputEnum(value, values) { if (!enumValue(value, values)) fail("Elegí una opción válida."); return value; }
function inputStage(value) { if (!value) return null; if (!isProjectId(value)) fail("Seleccioná una etapa del proyecto."); return value; }
function projectFields(draft, admin, creating) {
  const fields = { titulo: title(draft.titulo), tipo: inputEnum(draft.tipo, PROJECT_TYPES), descripcion: longText(draft.descripcion),
    fecha_inicio: inputDate(draft.fecha_inicio), fecha_entrega: inputDate(draft.fecha_entrega) };
  if (fields.fecha_inicio && fields.fecha_entrega && fields.fecha_inicio > fields.fecha_entrega) fail("La entrega no puede ser anterior al inicio.");
  if (!creating) fields.estado = inputEnum(draft.estado, PROJECT_STATES);
  if (admin || creating) Object.assign(fields, { cliente_id: inputId(draft.cliente_id), responsable_id: inputId(draft.responsable_id), miembro_ids: inputIds(draft.miembro_ids) });
  return fields;
}
export function buildProjectMutation(form) {
  const d = form.draft;
  if(form.kind==='deliverable-approve')return buildProjectDeliverableApproval(form);
  if (form.kind === "create") {
    if (!isProjectId(form.requestId)) fail("Falta el identificador de este intento de creación.");
    return { method: "POST", path: "/api/proyectos", body: { request_id: form.requestId, ...projectFields(d, true, true) } };
  }
  if (!isProjectId(form.projectId) || !positive(form.baseRevision)) fail("Volvé a consultar el proyecto y su revisión.");
  const base = `/api/proyectos/${form.projectId}`;
  let method = "POST", path = base, changes;
  if (form.kind === "project") {
    method = "PATCH";
    const next = projectFields(d, form.admin, false), before = projectFields(form.initial, form.admin, false);
    changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
    if (!Object.keys(changes).length) fail("No hay cambios para guardar.");
  } else if (form.kind === "archive") {
    if (typeof d.archivado !== "boolean") invalid();
    method = "PATCH"; changes = { archivado: d.archivado };
  } else if (form.kind === "order") {
    const ids = d.etapa_ids;
    if (!Array.isArray(ids) || !ids.every(isProjectId) || new Set(ids).size !== ids.length || !Array.isArray(form.originalStageIds)
      || ids.length !== form.originalStageIds.length || ids.some(id => !form.originalStageIds.includes(id))) fail("El orden debe incluir exactamente las etapas observadas.");
    method = "PUT"; path += "/etapas/orden"; changes = { etapa_ids: [...ids] };
  } else if (form.kind === "task-link") {
    const id = inputId(d.tarea_id);
    if (form.observedTask?.id !== id || !positive(form.observedTask?.revision)) fail("Consultá la tarea y revisá su versión antes de vincular.");
    path += "/tareas"; changes = { tarea_id: id, expected_tarea_revision: form.observedTask.revision, etapa_id: inputStage(d.etapa_id) };
  } else if (form.kind === "task-unlink") {
    method = "DELETE"; path += `/tareas/${inputId(form.childId)}`; changes = {};
  } else {
    const [type, action] = form.kind.split("-");
    const routes = { stage: "etapas", milestone: "hitos", deliverable: "entregables" };
    if (!own(routes, type) || !["create", "edit"].includes(action)) invalid();
    path += `/${routes[type]}`;
    if (action === "edit") { if (!isProjectId(form.childId)) invalid(); method = "PATCH"; path += `/${form.childId}`; }
    changes = { titulo: title(d.titulo) };
    if (type === "stage" && action === "edit") changes.estado = inputEnum(d.estado, STAGE_STATES);
    if (type === "milestone") Object.assign(changes, { fecha: inputDate(d.fecha), etapa_id: inputStage(d.etapa_id), estado: inputEnum(d.estado, MILESTONE_STATES) });
    if (type === "deliverable") {
      const url = safeProjectUrl(d.url); if (url === null) fail("Usá un enlace HTTP o HTTPS sin credenciales, o dejalo vacío.");
      const content={titulo:title(d.titulo),url,observaciones:longText(d.observaciones)};
      if(action==='create')Object.assign(changes,{...content,estado:inputEnum(d.estado,DELIVERABLE_EDIT_STATES)});
      else{
        changes=Object.fromEntries(Object.entries(content).filter(([key,value])=>value!==form.initial?.[key]));
        if(d.estado!==form.initial?.estado)changes.estado=inputEnum(d.estado,DELIVERABLE_EDIT_STATES);
        if(!Object.keys(changes).length)fail('No hay cambios para guardar.');
      }
    }
  }
  return { method, path, body: { expected_revision: form.baseRevision, ...changes } };
}

export function buildProjectDeliverableApproval(form){
  const item=form.observedDeliverable;
  if(!isProjectId(form.projectId)||!isProjectId(form.childId)||!isProjectId(form.requestId)||form.requestId.length!==36||!pgRevision(form.baseRevision)||item?.id!==form.childId||!pgRevision(item.contenido_revision)||!pgRevision(item.entregable_revision)||!contentHash(item.contenido_hash)||form.draft?.acknowledged!==true)fail('Revisá y confirmá la versión observada del entregable antes de aprobar.');
  return{method:'POST',path:`/api/proyectos/${form.projectId}/entregables/${form.childId}/aprobaciones`,body:{request_id:form.requestId,expected_revision:form.baseRevision,expected_entregable_revision:item.entregable_revision,expected_content_revision:item.contenido_revision,expected_content_hash:item.contenido_hash}};
}
export function parseProjectDeliverableApproval(value,form,actorId){
  const input=buildProjectDeliverableApproval(form).body,a=value?.aprobacion;
  if(typeof value?.replayed!=='boolean'||!isProjectId(a?.id)||a.entregable_id!==form.childId||a.actor_id!==actorId||a.contenido_revision!==input.expected_content_revision||a.entregable_revision!==input.expected_entregable_revision+1||a.contenido_hash!==input.expected_content_hash||typeof a.aprobado_at!=='string'||!Number.isFinite(Date.parse(a.aprobado_at)))invalid();
  const project=parseProject(value.proyecto,true);if(project.id!==form.projectId||project.revision<input.expected_revision+1)invalid();
  if(!value.replayed){const item=project.entregables.find(item=>item.id===form.childId);if(project.revision!==input.expected_revision+1||!item?.aprobacion_versionada||item.aprobacion_actual_id!==a.id||item.contenido_revision!==a.contenido_revision||item.entregable_revision!==a.entregable_revision||item.contenido_hash!==a.contenido_hash||item.aprobado_por_id!==a.actor_id||item.aprobado_at!==a.aprobado_at)invalid();}
  return project;
}
export function projectDeliverableApprovalLabel(item){return item.aprobacion_versionada?`Aprobación verificada del contenido · versión ${item.contenido_revision}`:item.estado==='aprobado'?'Aprobación histórica no versionada; no verifica el contenido actual':DELIVERABLE_STATES[item.estado];}

export function createProjectsTransport(request,{isCurrent=()=>true}={}) {
  let disposed = false, writing = false;
  const reads = new Map(), writes = new Set();
  async function read(key, url) {
    if (disposed||!isCurrent()) return undefined;
    reads.get(key)?.abort();
    const controller = new AbortController(); reads.set(key, controller);
    try {
      const value = await request(url, { signal: controller.signal });
      return disposed || !isCurrent() || controller.signal.aborted || reads.get(key) !== controller ? undefined : value;
    } catch (error) { if (disposed || !isCurrent() || controller.signal.aborted) return undefined; throw error; }
    finally { if (reads.get(key) === controller) reads.delete(key); }
  }
  async function write(mutation, scope) {
    if (disposed||!isCurrent()) return undefined;
    if (writing) fail("Ya hay una operación en curso. Esperá su resultado.");
    writing = true;
    const controller = new AbortController(); writes.add(controller);
    try {
      scope?.assertCurrent();
      const value = await (scope?scope.request:request)(mutation.path, { method: mutation.method, signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation.body) });
      scope?.assertCurrent();
      return disposed || !isCurrent() || controller.signal.aborted ? undefined : value;
    } catch (error) { if (disposed || !isCurrent() || controller.signal.aborted) return undefined; throw error; }
    finally { writing = false; writes.delete(controller); }
  }
  return { read, write, cancel(key) { reads.get(key)?.abort(); reads.delete(key); }, dispose() { disposed = true; for (const controller of [...reads.values(), ...writes]) controller.abort(); reads.clear(); writes.clear(); } };
}
