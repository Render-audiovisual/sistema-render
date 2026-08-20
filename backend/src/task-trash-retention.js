export const TASK_TRASH_RETENTION_DAYS = 10;

export async function purgeExpiredRenderOsTrash(pool) {
  return pool.query(
    `DELETE FROM tareas
     WHERE propiedades_extra->>'workspace' = 'render_os'
       AND propiedades_extra->>'papelera_render_os' = 'true'
       AND CASE
         WHEN propiedades_extra->>'papelera_at' ~ '^\\d{4}-\\d{2}-\\d{2}T'
           THEN (propiedades_extra->>'papelera_at')::timestamptz
         ELSE updated_at
       END <= now() - ($1::text || ' days')::interval
     RETURNING id`,
    [TASK_TRASH_RETENTION_DAYS],
  );
}

export function scheduleRenderOsTrashCleanup(pool, intervalMs = 60 * 60 * 1000) {
  const clean = async () => {
    try {
      const result = await purgeExpiredRenderOsTrash(pool);
      if (result.rowCount > 0) console.log(`${result.rowCount} tareas vencidas eliminadas de Papelera`);
    } catch (error) {
      console.error("No se pudo limpiar la Papelera de tareas", error.message);
    }
  };
  void clean();
  const timer = setInterval(clean, intervalMs);
  timer.unref?.();
  return timer;
}
