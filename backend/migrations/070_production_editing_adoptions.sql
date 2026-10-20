-- Explicit one-to-one adoption of a verified existing editing task only.
-- Application inserts once and never updates/deletes this provenance record.
-- No backfill, task-history rewrite or arbitrary sensitive snapshots.
CREATE TABLE produccion_edicion_adopciones (
  reconciliacion_id UUID PRIMARY KEY REFERENCES produccion_reconciliaciones(id) ON DELETE RESTRICT,
  video_id UUID NOT NULL UNIQUE REFERENCES produccion_videos(id) ON DELETE RESTRICT,
  tarea_edicion_id INTEGER NOT NULL UNIQUE REFERENCES tareas(id) ON DELETE RESTRICT,
  task_revision INTEGER NOT NULL CHECK (task_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT produccion_edicion_adopciones_review_video_fk
    FOREIGN KEY (reconciliacion_id, video_id)
    REFERENCES produccion_reconciliacion_videos(reconciliacion_id, video_id) ON DELETE RESTRICT
);
