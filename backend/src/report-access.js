function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function belongsTo(value, identity) {
  const left = normalize(value).split(/\s+/)[0];
  const right = normalize(identity).split(/\s+/)[0];
  return Boolean(left && right && left === right);
}

const MARIANO_CLIENTS = new Set([
  "iphone shop", "luzin", "lucin", "rpm", "rpm chevrolet", "lavalle market",
  "la valle market", "el angel azul estudiantil", "angel azul estudiantil",
  "joyeria cristal", "cristal joyeria", "cristal joyerias",
]);

function clientBelongsToDesigner(client, identity) {
  const isMariano = belongsTo(identity, "Mariano");
  const isAugusto = belongsTo(identity, "Augusto");
  if (!isMariano && !isAugusto) return false;
  const belongsToMariano = MARIANO_CLIENTS.has(normalize(client?.nombre).replace(/[^a-z0-9]+/g, " ").trim());
  return isMariano ? belongsToMariano : !belongsToMariano;
}

function renderOsCategory(task = {}) {
  const text = normalize(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`);
  if (text.includes("carrusel")) return "carruseles";
  if (task.tipo_tarea === "edicion" || text.includes("edicion") || text.includes("editar reel") || text.includes("editar video")) return "ediciones";
  if (task.tipo_tarea !== "produccion" && (/^video\b/.test(normalize(task.titulo)) || text.includes(" reel") || text.includes("video "))) return "reels_planificados";
  return null;
}

export function summarizeRenderOsByDay(tasks = []) {
  return tasks.reduce((summary, task) => {
    if (task.propiedades_extra?.archivada_render_os === true) return summary;
    const category = renderOsCategory(task);
    const date = String(task.fecha_vencimiento || task.updated_at || "").slice(0, 10);
    if (!category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return summary;
    if (!summary[date]) summary[date] = {};
    if (!summary[date][category]) summary[date][category] = { total: 0, publicadas: 0 };
    summary[date][category].total += 1;
    if (task.estado === "publicada") summary[date][category].publicadas += 1;
    return summary;
  }, {});
}

// Report DTOs are allowlists: new database/JSON fields stay private by default.
// Scalars only, so an object hidden under an allowed key cannot bypass the DTO.
function pickScalars(source, fields) {
  const result = {};
  for (const key of fields) {
    const value = source?.[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) result[key] = value;
    else if (value instanceof Date) result[key] = value.toISOString();
  }
  return result;
}

function taskReportDto(task) {
  const result = pickScalars(task, [
    "id", "titulo", "asignado_a", "estado", "fecha_vencimiento", "tipo_tarea",
    "subtipo", "created_at", "updated_at", "cliente_nombre",
  ]);
  const extra = task.propiedades_extra;
  result.propiedades_extra = pickScalars(extra, [
    "workspace", "archivada_render_os", "edicion_responsable", "clickup_lista",
    "clickup_cerrada_at", "reporte_fuente", "reporte_periodo", "revision_aprobada",
    "produccion_videos_previstos", "produccion_finalizada_at", "produccion_confirmada_at",
  ]);
  if (Array.isArray(extra?.colaboradores)) {
    result.propiedades_extra.colaboradores = extra.colaboradores.filter((name) => typeof name === "string");
  }
  if (Array.isArray(extra?.produccion_registros)) {
    result.propiedades_extra.produccion_registros = extra.produccion_registros.map((record) => pickScalars(record, ["cantidad", "fecha"]));
  }
  return result;
}

function nonAdminReportDto(data) {
  const rows = (key, dto) => (data[key] || []).map(dto);
  return {
    tareas: rows("tareas", taskReportDto),
    tareasRenderOs: rows("tareasRenderOs", taskReportDto),
    historias: rows("historias", (item) => pickScalars(item, ["id", "cliente_id", "estado", "fecha_programada", "responsable", "responsable_diseño"])),
    publicaciones: rows("publicaciones", (item) => pickScalars(item, ["id", "cliente_id", "tipo", "estado", "fecha_programada", "responsable", "responsable_diseño"])),
    clientes: rows("clientes", (item) => pickScalars(item, ["id", "nombre", "activo", "cuota_carruseles", "disenador_responsable", "grupo_feed_id", "cuota_feed_carruseles"])),
    usuarios: rows("usuarios", (item) => pickScalars(item, ["id", "usuario", "nombre", "rol"])),
    entregasEdicion: rows("entregasEdicion", (item) => pickScalars(item, ["id", "editor_clave", "fecha_entrega", "cliente_etiqueta", "categoria", "fuente", "fuente_item", "confirmado_por"])),
  };
}

export function filterReportDataForUser(data, auth = {}) {
  if (auth.rol === "admin") return { ...data, resumenRenderOsPorDia: summarizeRenderOsByDay(data.tareasRenderOs) };
  data = nonAdminReportDto(data);
  const reportData = { ...data, resumenRenderOsPorDia: summarizeRenderOsByDay(data.tareasRenderOs) };
  const identity = auth.nombre || auth.usuario || "";
  const ownTask = (task) => belongsTo(task.asignado_a, identity)
    || (auth.rol === "edicion" && belongsTo(task.propiedades_extra?.edicion_responsable, identity))
    || (Array.isArray(task.propiedades_extra?.colaboradores)
      && task.propiedades_extra.colaboradores.some((name) => belongsTo(name, identity)));
  const ownUsers = data.usuarios.filter((user) => belongsTo(user.nombre || user.usuario, identity));
  const ownEditingDeliveries = (data.entregasEdicion || []).filter((item) => belongsTo(item.editor_clave, identity));

  if (auth.rol === "community") {
    return { ...reportData, tareas: data.tareas.filter(ownTask), tareasRenderOs: [], clientes: [], usuarios: ownUsers };
  }
  if (auth.rol === "diseno") {
    const assignedIds = new Set(data.clientes.filter((client) => clientBelongsToDesigner(client, identity)).map((client) => Number(client.id)));
    return {
      ...reportData,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: data.tareasRenderOs.filter(ownTask),
      historias: [],
      publicaciones: data.publicaciones.filter((item) => item.tipo === "carrusel" && assignedIds.has(Number(item.cliente_id))),
      usuarios: ownUsers,
    };
  }
  if (auth.rol === "produccion") {
    return {
      ...reportData,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: data.tareasRenderOs.filter(ownTask),
      historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
    };
  }
  return {
    ...reportData,
    tareas: data.tareas.filter(ownTask),
    tareasRenderOs: data.tareasRenderOs.filter(ownTask), entregasEdicion: ownEditingDeliveries,
    historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
  };
}
