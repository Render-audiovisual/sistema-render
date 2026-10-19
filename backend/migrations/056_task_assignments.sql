-- Stable identities for new/explicit task assignments only. No historical backfill.
CREATE TABLE tarea_asignaciones (
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN ('responsable', 'colaborador')),
  PRIMARY KEY (tarea_id, usuario_id)
);

CREATE UNIQUE INDEX tarea_asignaciones_one_responsable
  ON tarea_asignaciones (tarea_id) WHERE tipo = 'responsable';
