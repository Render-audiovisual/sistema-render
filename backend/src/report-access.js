import { editorialEvidenceDto } from './operational-dto.js';
import { productionResultProjection } from './production-result-projection.js';
import { historicalClosuresDto } from './historical-report-closures.js';

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const ownValue = (source, key) => {
  if (!source || typeof source !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const idList = value => Array.isArray(value) ? value.filter(positiveId) : [];
const rowsOf = (source, key) => {
  const rows = ownValue(source, key);
  return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
};

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
    if (["finalizada", "publicada"].includes(task.estado)) summary[date][category].publicadas += 1;
    return summary;
  }, {});
}

// Report DTOs are allowlists: new database/JSON fields stay private by default.
// Scalars only, so an object hidden under an allowed key cannot bypass the DTO.
function pickScalars(source, fields) {
  const result = {};
  for (const key of fields) {
    const value = ownValue(source, key);
    if (value === null || ["string", "boolean"].includes(typeof value)
      || (typeof value === 'number' && Number.isFinite(value))) result[key] = value;
    else if (value instanceof Date) {
      try { const time = Date.prototype.getTime.call(value); if (Number.isFinite(time)) result[key] = new Date(time).toISOString(); } catch { /* Invalid Date object. */ }
    }
  }
  return result;
}

function taskReportDto(task) {
  const result = pickScalars(task, [
    "id", "titulo", "asignado_a", "estado", "fecha_vencimiento", "tipo_tarea",
    "subtipo", "created_at", "updated_at", "cliente_nombre", "revision",
  ]);
  const clientId = ownValue(task, 'cliente_id');
  if (positiveId(clientId) || clientId === null) result.cliente_id = clientId;
  for (const key of ['historia_id', 'publicacion_id']) {
    const value = ownValue(task, key);
    if (positiveId(value) || value === null) result[key] = value;
  }
  result.asignado_a_id = positiveId(ownValue(task, 'asignado_a_id')) ? ownValue(task, 'asignado_a_id') : null;
  result.colaborador_ids = idList(ownValue(task, 'colaborador_ids'));
  const individual = ownValue(task, 'produccion_registro_individual');
  if (typeof individual === 'boolean') result.produccion_registro_individual = individual;
  const extra = ownValue(task, 'propiedades_extra');
  result.propiedades_extra = pickScalars(extra, [
    "workspace", "archivada_render_os", "edicion_responsable", "clickup_lista",
    "clickup_cerrada_at", "reporte_fuente", "reporte_periodo", "revision_aprobada",
    "produccion_videos_previstos", "produccion_finalizada_at", "produccion_confirmada_at",
  ]);
  // Server-written completion metadata is operational, not a free JSON bag.
  // Expose only its canonical timestamp, never a numeric/object value hidden
  // under the same key. Do not infer dates for historical records.
  const completedAt = ownValue(extra, 'finalizada_at');
  if (typeof completedAt === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(completedAt)) {
    const instant = Date.parse(completedAt);
    if (Number.isFinite(instant) && new Date(instant).toISOString() === completedAt) result.propiedades_extra.finalizada_at = completedAt;
  }
  const creditedEditorId = ownValue(extra, 'edicion_responsable_id');
  if (positiveId(creditedEditorId)) result.propiedades_extra.edicion_responsable_id = creditedEditorId;
  const collaborators = ownValue(extra, 'colaboradores');
  if (Array.isArray(collaborators)) {
    result.propiedades_extra.colaboradores = collaborators.filter((name) => typeof name === "string");
  }
  if (Array.isArray(ownValue(extra, 'produccion_registros'))) {
    result.propiedades_extra.produccion_registros = rowsOf(extra, 'produccion_registros').map((record) => pickScalars(record, ["cantidad", "fecha"]));
  }
  return result;
}

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function registryRow(row, scalars, uuidFields, idFields, enums = {}) {
  const result = pickScalars(row, scalars);
  for (const key of uuidFields) { const value = ownValue(row, key); if (uuid(value) || value === null) result[key] = value; }
  for (const key of idFields) { const value = ownValue(row, key); if (positiveId(value) || value === null) result[key] = value; }
  for (const [key, values] of Object.entries(enums)) {
    const value = ownValue(row, key);
    if (value === null || values.includes(value)) result[key] = value;
  }
  return result;
}
function productionResultEvidenceDto(visit) {
  const revision=ownValue(visit,'revision'), raw=ownValue(visit,'ultimo_resultado');
  if(!positiveId(revision)||revision>2147483647)return {};
  const result={revision};
  if(raw===undefined)return result;
  try {
    const closed=raw===null ? null : Object.fromEntries(['id','visita_revision','revision_resultante','registrado_at','parcial','vigente']
      .map(key=>[key,ownValue(raw,key)]));
    result.ultimo_resultado=productionResultProjection(closed,revision);
  } catch { /* Invalid evidence is unavailable, never a claim of no recording. */ }
  return result;
}
function productionReportDto(source) {
  const result = pickScalars(source, ['desde', 'hasta']);
  result.visitas = rowsOf(source, 'visitas').map(visit => ({
    ...registryRow(visit, ['cliente_nombre', 'fecha', 'titulo'], ['id'], ['tarea_origen_id', 'cliente_id']),
    ...productionResultEvidenceDto(visit),
    participante_ids: idList(ownValue(visit, 'participante_ids')),
    videos: rowsOf(visit, 'videos').map(video => registryRow(video, ['titulo', 'fecha_entrega_actual'], ['id'],
      ['tarea_edicion_id', 'editor_actual_id'], { estado: ['planificado', 'grabado', 'pendiente', 'repetir'],
        tarea_estado: ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada'] })),
    fotos: rowsOf(visit, 'fotos').map(photo => registryRow(photo, ['tipo'], ['id'], [],
      { estado: ['realizada', 'pendiente', 'repetir'] })),
  }));
  return result;
}

function operationalReportDto(data) {
  const rows = (key, dto) => rowsOf(data, key).map(dto);
  const editorial = (item, fields) => {
    const result = pickScalars(item, fields);
    const evidence = editorialEvidenceDto(ownValue(item, 'publicacion_evidencia'));
    if (evidence !== undefined) result.publicacion_evidencia = evidence;
    return result;
  };
  return {
    tareas: rows("tareas", taskReportDto),
    tareasRenderOs: rows("tareasRenderOs", taskReportDto),
    historias: rows("historias", (item) => editorial(item, ["id", "cliente_id", "estado", "fecha_programada", "fecha_publicación_real", "responsable", "responsable_diseño"])),
    publicaciones: rows("publicaciones", (item) => editorial(item, ["id", "cliente_id", "tipo", "estado", "fecha_programada", "fecha_publicación_real", "responsable", "responsable_diseño"])),
    clientes: rows("clientes", (item) => {
      const result = pickScalars(item, ["id", "nombre", "activo", "cuota_carruseles", "disenador_responsable", "grupo_feed_id", "cuota_feed_carruseles"]);
      for (const key of ['cuota_reels', 'cuota_feed_reels']) {
        const value = ownValue(item, key);
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
      }
      return result;
    }),
    usuarios: rows("usuarios", (item) => pickScalars(item, ["id", "usuario", "nombre", "rol"])),
    entregasEdicion: rows("entregasEdicion", (item) => ({ ...pickScalars(item, ["id", "editor_clave", "fecha_entrega", "cliente_etiqueta", "categoria", "fuente", "fuente_item", "confirmado_por"]),
      ...(positiveId(ownValue(item, 'editor_id')) ? { editor_id: ownValue(item, 'editor_id') } : {}) })),
    ...(ownValue(data, 'producciones') !== undefined ? { producciones: productionReportDto(ownValue(data, 'producciones')) } : {}),
    ...(ownValue(data, 'cierresMensuales') !== undefined ? { cierresMensuales: historicalClosuresDto(ownValue(data, 'cierresMensuales')) } : {}),
  };
}

export function filterReportDataForUser(data, auth = {}) {
  const role = ownValue(auth, 'rol'), userId = ownValue(auth, 'id');
  if (!positiveId(userId) || ownValue(auth, 'activo') === false) {
    return { ...operationalReportDto(ownValue(data, 'producciones') !== undefined ? { producciones: {} } : {}), resumenRenderOsPorDia: {} };
  }
  data = operationalReportDto(data);
  if (!['admin','community', 'diseno', 'produccion', 'edicion', 'programacion'].includes(role)) {
    return { ...operationalReportDto({}),
      usuarios: data.usuarios.filter(user => positiveId(user.id) && user.id === userId),
      ...(data.producciones ? { producciones: data.producciones } : {}), resumenRenderOsPorDia: {} };
  }
  // Reports are explicitly team-wide for operational roles. This grants no
  // task mutation, user administration or finance access: every row has already
  // crossed the closed operational DTO above, including owners. Home retains
  // its separate own scope; authorized amounts remain in the finance APIs.
  return { ...data, resumenRenderOsPorDia: summarizeRenderOsByDay(data.tareasRenderOs) };
}
