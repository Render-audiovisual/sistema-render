-- Additive only: existing notes, categories, authors and timestamps stay intact.
ALTER TABLE notas_compartidas
  ADD COLUMN IF NOT EXISTS feedback JSONB NOT NULL DEFAULT '{}'::jsonb;
