-- Add a lossless concurrency token without changing historical states/dates.
ALTER TABLE tareas ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE FUNCTION incrementar_revision_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER tarea_revision_cambio BEFORE UPDATE ON tareas
  FOR EACH ROW EXECUTE FUNCTION incrementar_revision_tarea();
