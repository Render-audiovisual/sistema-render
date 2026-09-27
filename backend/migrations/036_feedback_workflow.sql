ALTER TABLE mia_private_task_notifications
  ALTER COLUMN tarea_id DROP NOT NULL;

ALTER TABLE mia_private_task_notifications
  ADD COLUMN IF NOT EXISTS feedback_id BIGINT REFERENCES notas_compartidas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mia_private_feedback_notifications
  ON mia_private_task_notifications (feedback_id, created_at DESC)
  WHERE feedback_id IS NOT NULL;
