// Response serialization only: callers must still enforce resource authorization.
// Unknown fields/types are omitted, never passed through or recursively denied.
const OMIT = Symbol('omit');
const ownValue = (source, key) => {
  if (source === null || (typeof source !== 'object' && typeof source !== 'function')) return OMIT;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : OMIT;
};
const scalar = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMIT;
  if (value instanceof Date) {
    try {
      const time = Date.prototype.getTime.call(value);
      return Number.isFinite(time) ? new Date(time).toISOString() : OMIT;
    } catch { return OMIT; }
  }
  return OMIT;
};
const string = value => typeof value === 'string' ? value : OMIT;
const nullableString = value => value === null ? null : string(value);
const finiteNumber = value => value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : OMIT;
const boolean = value => value === null || typeof value === 'boolean' ? value : OMIT;
const id = value => value === null ? null : Number.isSafeInteger(value) && value > 0 ? value : OMIT;
const fields = names => Object.fromEntries(names.trim().split(/\s+/).map(key => [key, scalar]));
const object = schema => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return OMIT;
  const result = {};
  for (const [key, serialize] of Object.entries(schema)) {
    const input = ownValue(value, key);
    if (input === OMIT) continue;
    const output = serialize(input);
    if (output !== OMIT) result[key] = output;
  }
  return result;
};
const array = serialize => value => {
  if (!Array.isArray(value)) return OMIT;
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const input = ownValue(value, String(index));
    if (input === OMIT) continue;
    const output = serialize(input);
    if (output !== OMIT && !(output && typeof output === 'object' && !Array.isArray(output) && !Object.keys(output).length)) result.push(output);
  }
  return result;
};
const strings = array(string);
const ids = array(value => value === null ? OMIT : id(value));
const days = array(value => Number.isInteger(value) && value >= 0 && value <= 6 ? value : OMIT);

const attachment = object(fields(`id name nombre url webViewLink mimeType size modifiedTime
  iconLink thumbnailLink isFolder uploaded_at uploaded_by uploaded_by_id created_at
  tipo nombre_original filename content_type ruta`));
const attachments = array(attachment);
const script = object({ ...fields(`id titulo texto contenido guion orden tipo estado
  descripcion created_at updated_at autor autor_id usuario_id`),
  escenas: array(object(fields('id orden titulo texto descripcion voz visual audio duracion'))),
});
const scripts = value => typeof value === 'string' || value === null ? value : array(script)(value);
const productionRecord = object(fields(`id cantidad fecha usuario usuario_id created_at periodo_objetivo
  cantidad_mes_actual cantidad_adelanto periodo_adelanto corregido_desde corregido_por
  corregido_por_id corregido_at`));
const report = object(fields('texto estado motivo nueva_fecha bloqueo_usuario_id usuario_id fecha'));
const marker = object({ ...fields(`id tipo creado_en cantidad anterior nuevo destino estado
  task_id tarea_id usuario_id actor_id actor_nombre source_message_id evento_id`),
  destinatarios: array(string), usuario_ids: array(value => value === null ? OMIT : id(value)),
  task_ids: array(value => value === null ? OMIT : id(value)),
});
const blocker = object({ ...fields('motivo usuario_id source_message_id desde'), usuario_ids: ids });

const taskProperties = object({
  ...fields(`Origen origen workspace resumen copy_trabajo referencia material Material feedback
    motivo_bloqueo escalada_a motivo coordinada horario destrabada_por fecha_destrabe
    wilson_confirmado_por bloqueada archivada_render_os archivada_at archivada_por
    papelera_render_os papelera_at papelera_por automatica_render_os origen_pieza origen_visita_id
    origen_produccion_video_id produccion_visita_id
    clickup_lista clickup_id clickup_url clickup_cerrada_at reporte_fuente reporte_periodo
    objetivo_periodo objetivo_id objetivo_pieza_id objetivo_clave objetivo_tipo objetivo_numero
    edicion_responsable edicion_responsable_id responsable_publicacion responsable_publicacion_id
    revision_aprobada revision_aprobada_por revision_aprobada_por_id revision_aprobada_at
    finalizada_at finalizada_por finalizada_por_id produccion_videos_previstos
    produccion_finalizada_at produccion_finalizada_por produccion_finalizada_por_id
    produccion_esperando_confirmacion produccion_confirmada_at produccion_confirmada_por
    produccion_confirmada_por_id origen_integracion mia_revision_confirmada_at
    mia_revision_informada_por mia_revision_confirmada_por`),
  colaboradores: strings, etiquetas: strings, guiones: scripts,
  coordinada: boolean,
  produccion_registros: array(productionRecord), drive_archivos: attachments,
  adjuntos: attachments, attachments, uploads: attachments,
  mia_notificacion_pendiente: value => value === null ? null : marker(value),
  supervisor_bloqueo: value => value === null ? null : blocker(value),
  supervisor_ultimo_reporte: report,
});

const editorialMetadata = object({
  ...fields(`hora tipo Idea Copy Material Aclaración idea copy material_referencia aclaraciones
    archivado_tablero archivado_at archivado_por origen migrada_desde_flyer_id
    origen_calendario calendario_clave fecha_bloqueada resumen referencia guion
    responsable_planificacion responsable_diseño responsable_edición responsable_revisión
    responsable_publicacion fecha_planificacion_inicio fecha_diseño_inicio fecha_diseño_entrega
    fecha_edición_entrega fecha_revisión_inicio fecha_revisión_aprobación fecha_publicación_real`),
  etiquetas: strings, colaboradores: strings, guiones: scripts,
  drive_archivos: attachments, adjuntos: attachments, attachments, uploads: attachments,
});

const taskSchema = {
  ...fields(`id revision titulo asignado_a estado cliente_id cliente_nombre cliente_activo
    requiere_aprobacion fecha_vencimiento historia_id publicacion_id tipo_tarea subtipo prioridad
    aclaraciones material_referencia tarea_padre_id tarea_padre_estado created_at updated_at
    historia_fecha_programada historia_estado publicacion_fecha_programada publicacion_estado
    publicacion_tipo publicacion_fecha_publicación_real objetivo_id objetivo_pieza_id
    responsable_publicacion responsable_publicacion_id edicion_responsable edicion_responsable_id
    origen url task_url total_count prioridad_score priority_score due_days risk_tomorrow
    waiting_review blocked espera_material resumen copy_trabajo dynamic_priority priority_label`),
  asignado_a_id: id, colaborador_ids: ids, colaboradores: strings, responsables: strings,
  dynamic_priority: nullableString, dynamic_priority_label: nullableString, priority_label: nullableString,
  priority_reasons: strings, razones: strings, propiedades_extra: taskProperties,
  adjuntos: attachments, attachments, uploads: attachments,
  comentarios: array(object(fields('id tarea_id contenido usuario usuario_id autor autor_id created_at updated_at'))),
  ediciones_vinculadas: array(object(fields('id titulo estado revision tarea_padre_id'))),
};
const publicationEvidence = object({
  classification: value => ['confirmada_manualmente', 'historica_sin_confirmacion', 'no_publicada'].includes(value) ? value : OMIT,
  revision: value => Number.isSafeInteger(value) && value >= 0 ? value : OMIT,
  confirmation: value => value === null ? null : object({
    id: string, actor_id: id, occurred_at: scalar, recorded_at: scalar,
    source: value => value === 'manual' ? value : OMIT,
  })(value),
});
export function editorialEvidenceDto(value) {
  const result = publicationEvidence(value);
  return result === OMIT ? undefined : result;
}
const editorialSchema = {
  ...fields(`id revision origen cliente_id cliente_nombre tipo estado fecha_programada idea copy
    material_referencia aclaraciones prioridad responsable duracion_segundos num_imagenes
    responsable_planificacion responsable_diseño responsable_edición responsable_revisión
    responsable_publicacion responsable_planificacion_id responsable_diseño_id responsable_edición_id
    responsable_revisión_id responsable_publicacion_id fecha_planificacion_inicio fecha_diseño_inicio
    fecha_diseño_entrega fecha_edición_inicio fecha_edición_entrega fecha_revisión_inicio
    fecha_revisión_aprobación fecha_publicación_real notas_planificacion notas_diseño notas_edición
    notas_revisión notas_bloqueador origen_calendario calendario_clave fecha_bloqueada
    created_at updated_at tarea_id tarea_estado tarea_revision`),
  metadata: editorialMetadata, colaborador_ids: ids, colaboradores: strings,
  publicacion_evidencia: publicationEvidence,
  adjuntos: attachments, attachments, uploads: attachments,
};
const clientSchema = {
  ...fields(`id nombre rubro activo fecha_inicio fecha_fin cuota_reels cuota_carruseles
    grupo_feed_id grupo_feed_nombre cuota_feed_reels cuota_feed_carruseles cuota_feed_compartida
    configuracion_vigente_desde configuracion_completa
    disenador_responsable disenador_responsable_id responsable responsable_id
    logo logo_url color instagram facebook sitio_web drive_folder_id drive_folder_url
    created_at updated_at fecha_configuracion vigente_desde cliente_id`),
  dias_historias: days, dias_reels: days, dias_carruseles: days,
  cuota_feed_compartida: finiteNumber, configuracion_vigente_desde: scalar, configuracion_completa: boolean,
  colaborador_ids: ids,
  metadata: object({ ...fields('logo_url color instagram facebook sitio_web drive_folder_id drive_folder_url'), etiquetas: strings }),
};

function dto(source, auth, schema, projections = {}) {
  // An inherited rol, or a getter, cannot opt a non-admin into raw passthrough.
  if (ownValue(auth, 'rol') === 'admin') return source;
  const result = object(schema)(source);
  if (result === OMIT) return {};
  // SQL ->> converts an object to JSON text. For known projections whose raw
  // source is present, validate the source as well as the projected alias.
  // Never guess from text content: a real brief may legitimately contain JSON.
  for (const [bagName, aliases] of Object.entries(projections)) {
    const bag = ownValue(source, bagName);
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const [alias, rawKey] of Object.entries(aliases)) {
      const descriptor = Object.getOwnPropertyDescriptor(bag, rawKey);
      if (descriptor && scalar(ownValue(bag, rawKey)) === OMIT) delete result[alias];
    }
  }
  return result;
}

/** Admin: exact raw object. All other/missing roles: explicit operational schema.
 * IDs arrays accept positive numeric safe integers only (no string coercion).
 * Own data properties only; no getters/prototype values; inputs never mutated.
 * All valid array items are preserved in order; pagination belongs to callers.
 * Fixed-depth schemas constrain structure, not collection lengths.
 * New fields must be added explicitly here, including nested record fields.
 */
export function taskOperationalDto(task, auth = {}) {
  return dto(task, auth, taskSchema, { propiedades_extra: { resumen: 'resumen', copy_trabajo: 'copy_trabajo',
    edicion_responsable: 'edicion_responsable', responsable_publicacion: 'responsable_publicacion' } });
}
export function editorialOperationalDto(piece, auth = {}) {
  // Existing admin fields retain their contract, but this new server-owned
  // evidence tree is closed for every role. Never evaluate a proof getter.
  if (ownValue(auth, 'rol') === 'admin' && piece && Object.hasOwn(piece, 'publicacion_evidencia')) {
    const descriptors = Object.getOwnPropertyDescriptors(piece);
    delete descriptors.publicacion_evidencia;
    const result = Object.defineProperties({}, descriptors);
    const evidence = editorialEvidenceDto(ownValue(piece, 'publicacion_evidencia'));
    if (evidence !== undefined) result.publicacion_evidencia = evidence;
    return result;
  }
  return dto(piece, auth, editorialSchema, { metadata: { idea: 'Idea', copy: 'Copy',
    material_referencia: 'Material', aclaraciones: 'Aclaración' } });
}
export function clientOperationalDto(client, auth = {}) { return dto(client, auth, clientSchema); }
