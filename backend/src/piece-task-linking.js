export function buildAutoTaskProperties() {
  return {
    Origen: "Generada automáticamente al crear la pieza",
    workspace: "render_os",
    origen_pieza: true,
  };
}

export async function completeLinkedAutoTasks(pool, { estado, historiaId = null, publicacionId = null } = {}) {
  if (estado !== "publicada" || (!historiaId && !publicacionId)) return 0;

  const result = await pool.query(
    `UPDATE tareas
     SET estado = 'publicada', updated_at = now()
     WHERE propiedades_extra->>'workspace' = 'render_os'
       AND propiedades_extra->>'origen_pieza' = 'true'
       AND estado <> 'publicada'
       AND (($1::int IS NOT NULL AND historia_id = $1)
         OR ($2::int IS NOT NULL AND publicacion_id = $2))`,
    [historiaId, publicacionId],
  );

  return result.rowCount || 0;
}

export async function publishPieceLinkedToCompletedTask(pool, task = {}) {
  if (task.estado !== "publicada") return 0;

  let updated = 0;
  if (task.publicacion_id) {
    const result = await pool.query(
      `UPDATE publicaciones
       SET estado = 'publicada',
           fecha_publicación_real = COALESCE(fecha_publicación_real, now()),
           updated_at = now()
       WHERE id = $1 AND estado <> 'publicada'`,
      [task.publicacion_id],
    );
    updated += result.rowCount || 0;
  }
  if (task.historia_id) {
    const result = await pool.query(
      `UPDATE historias
       SET estado = 'publicada', updated_at = now()
       WHERE id = $1 AND estado <> 'publicada'`,
      [task.historia_id],
    );
    updated += result.rowCount || 0;
  }
  return updated;
}
