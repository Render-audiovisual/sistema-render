CREATE TABLE IF NOT EXISTS tarea_comentarios (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarea_comentarios_tarea_fecha
  ON tarea_comentarios (tarea_id, created_at);
