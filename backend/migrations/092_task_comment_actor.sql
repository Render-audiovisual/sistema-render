-- Preserve historical display text. Unknown and system actors remain NULL;
-- no names, receipts or mentioned humans are used to infer past authorship.
ALTER TABLE tarea_comentarios ADD COLUMN actor_usuario_id INTEGER;
ALTER TABLE tarea_comentarios ADD CONSTRAINT tarea_comentarios_actor_positive
  CHECK (actor_usuario_id IS NULL OR actor_usuario_id > 0);
ALTER TABLE tarea_comentarios ADD CONSTRAINT tarea_comentarios_actor_fk
  FOREIGN KEY (actor_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT;
CREATE INDEX tarea_comentarios_actor_idx ON tarea_comentarios(actor_usuario_id)
  WHERE actor_usuario_id IS NOT NULL;
