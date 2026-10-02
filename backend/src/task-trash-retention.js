export const TASK_TRASH_RETENTION_DAYS = 10;
export const TASK_COMPLETED_RETENTION_DAYS = 15;

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

export async function purgeExpiredCompletedRenderOsTasks(pool) {
  return pool.query(
    `WITH expired AS MATERIALIZED (
       SELECT id FROM tareas
       WHERE propiedades_extra->>'workspace' = 'render_os'
         AND estado = 'publicada'
         AND CASE
           WHEN propiedades_extra->>'finalizada_at' ~ '^\\d{4}-\\d{2}-\\d{2}T'
             THEN (propiedades_extra->>'finalizada_at')::timestamptz
           ELSE updated_at
         END <= now() - ($1::text || ' days')::interval
     ), discarded_notifications AS (
       DELETE FROM mia_private_task_notifications notification
       USING expired WHERE notification.tarea_id = expired.id
     ), deleted AS (
       DELETE FROM tareas task USING expired
       WHERE task.id = expired.id
       RETURNING task.id
     )
     SELECT id FROM deleted`,
    [TASK_COMPLETED_RETENTION_DAYS],
  );
}

export function scheduleRenderOsTrashCleanup(pool, intervalMs = 60 * 60 * 1000) {
  const clean = async () => {
    try {
      const [trash, completed] = await Promise.all([
        purgeExpiredRenderOsTrash(pool),
        purgeExpiredCompletedRenderOsTasks(pool),
      ]);
      if (trash.rowCount > 0) console.log(`${trash.rowCount} tareas vencidas eliminadas de Papelera`);
      if (completed.rowCount > 0) console.log(`${completed.rowCount} tareas finalizadas hace 15 días eliminadas definitivamente`);
    } catch (error) {
      console.error("No se pudo ejecutar la limpieza automática de tareas", error.message);
    }
  };
  void clean();
  const timer = setInterval(clean, intervalMs);
  timer.unref?.();
  return timer;
}
