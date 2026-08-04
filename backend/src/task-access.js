export function getTaskActor(auth = {}) {
  return String(auth.nombre || auth.usuario || "").trim();
}

export function buildTaskAccessClause(auth, alias, placeholder) {
  if (auth?.rol === "admin") return { sql: "", value: null };
  const actor = getTaskActor(auth);
  if (!actor) return { sql: " AND FALSE", value: null };
  const normalizedActor = `translate(lower(${placeholder}), 'áéíóúüñ', 'aeiouun')`;
  return {
    sql: ` AND (
      translate(lower(${alias}.asignado_a), 'áéíóúüñ', 'aeiouun') = ${normalizedActor}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(${alias}.propiedades_extra->'colaboradores') = 'array'
              THEN ${alias}.propiedades_extra->'colaboradores'
            ELSE '[]'::jsonb
          END
        ) AS colaborador(nombre)
        WHERE translate(lower(colaborador.nombre), 'áéíóúüñ', 'aeiouun') = ${normalizedActor}
      )
    )`,
    value: actor,
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
  if (keys.every((key) => ["estado", "expected_updated_at"].includes(key))) return true;
  if (workspace !== "render_os" && role === "produccion") {
    const allowedTopLevel = keys.every((key) => ["propiedades_extra", "expected_updated_at"].includes(key));
    const allowedMetadata = Object.keys(body.propiedades_extra || {}).every((key) => ["horario", "coordinada"].includes(key));
    return allowedTopLevel && allowedMetadata;
  }
  return false;
}
