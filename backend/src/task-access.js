export function getTaskActor(auth = {}) {
  return String(auth.nombre || auth.usuario || "").trim();
}

export function getTaskActorAliases(auth = {}) {
  return [...new Set([auth.nombre, auth.usuario]
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

export function buildTaskAccessClause(auth, alias, placeholder) {
  if (auth?.rol === "admin") return { sql: "", value: null };
  const userId = auth?.id;
  if (!Number.isSafeInteger(userId) || userId < 1) return { sql: " AND FALSE", value: null };
  return {
    sql: ` AND EXISTS (SELECT 1 FROM tarea_asignaciones ta
      WHERE ta.tarea_id = ${alias}.id AND ta.usuario_id = ${placeholder}::integer)`,
    value: userId,
  };
}

export function buildTaskReadAccessClause(auth, alias, placeholder, workspace) {
  // RENDER OS funciona como tablero compartido: cualquier integrante con una
  // sesión válida puede consultar el trabajo del equipo. Las operaciones de
  // escritura siguen usando buildTaskAccessClause y conservan sus permisos.
  if (workspace === "render_os") return { sql: "", value: null };
  return buildTaskAccessClause(auth, alias, placeholder);
}

export function canEmployeePatchTask(body = {}, { workspace, role } = {}) {
  const keys = Object.keys(body);
  if (workspace === "render_os") {
    const allowedFields = ["titulo", "asignado_a", "asignado_a_id", "colaborador_ids", "cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "prioridad", "estado", "aclaraciones", "material_referencia", "propiedades_extra", "expected_updated_at", "expected_revision"];
    const allowedMetadata = ["resumen", "etiquetas", "colaboradores", "guiones", "copy_trabajo", "produccion_videos_previstos",
      ...(role === "produccion" ? ["horario", "coordinada"] : [])];
    return keys.every((key) => allowedFields.includes(key))
      && Object.keys(body.propiedades_extra || {}).every((key) => allowedMetadata.includes(key));
  }
  if (keys.every((key) => ["estado", "expected_updated_at", "expected_revision"].includes(key))) return true;
  if (workspace !== "render_os" && role === "produccion") {
    const allowedTopLevel = keys.every((key) => ["propiedades_extra", "expected_updated_at", "expected_revision"].includes(key));
    const allowedMetadata = Object.keys(body.propiedades_extra || {}).every((key) => ["horario", "coordinada"].includes(key));
    return allowedTopLevel && allowedMetadata;
  }
  return false;
}
