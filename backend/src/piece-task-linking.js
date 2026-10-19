import { isPieceActuallyPublished } from "./workflow-contract.js";

export function buildAutoTaskProperties() {
  return {
    Origen: "Generada automáticamente al crear la pieza",
    workspace: "render_os",
    origen_pieza: true,
  };
}

export async function completeLinkedAutoTasks(pool, { estado, historiaId = null, publicacionId = null } = {}) {
  if (!isPieceActuallyPublished({ estado }) || (!historiaId && !publicacionId)) return 0;

  const result = await pool.query(
    `UPDATE tareas
     SET estado = 'publicada',
         propiedades_extra = propiedades_extra || jsonb_build_object('finalizada_at', now()),
         updated_at = now()
     WHERE propiedades_extra->>'workspace' = 'render_os'
       AND propiedades_extra->>'origen_pieza' = 'true'
       AND estado NOT IN ('publicada', 'finalizada')
       AND (estado = 'aprobada' OR propiedades_extra->'revision_aprobada' = 'true'::jsonb)
       AND (($1::int IS NOT NULL AND historia_id = $1)
         OR ($2::int IS NOT NULL AND publicacion_id = $2))`,
    [historiaId, publicacionId],
  );

  return result.rowCount || 0;
}

export async function publishPieceLinkedToCompletedTask(pool, task = {}) {
  // Compatibility export for existing callers. Task completion is not evidence
  // of actual publication: never write editorial state or publication dates here.
  return 0;
}
