CREATE TABLE IF NOT EXISTS tarea_limpieza_auditoria (
  id BIGSERIAL PRIMARY KEY,
  motivo TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  ejecutada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH completed AS MATERIALIZED (
  SELECT id
  FROM tareas
  WHERE propiedades_extra->>'workspace'='render_os'
    AND estado='publicada'
), removed_notifications AS (
  DELETE FROM mia_private_task_notifications notification
  USING completed
  WHERE notification.tarea_id=completed.id
), deleted AS (
  DELETE FROM tareas task
  USING completed
  WHERE task.id=completed.id
  RETURNING task.id
)
INSERT INTO tarea_limpieza_auditoria(motivo,cantidad)
SELECT 'eliminacion_inicial_tareas_finalizadas',COUNT(*)::integer
FROM deleted;
