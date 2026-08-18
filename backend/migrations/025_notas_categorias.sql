ALTER TABLE notas_compartidas
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'general';

UPDATE notas_compartidas
SET categoria = 'general'
WHERE categoria IS NULL OR btrim(categoria) = '';

ALTER TABLE notas_compartidas
  DROP CONSTRAINT IF EXISTS notas_compartidas_categoria_check;

ALTER TABLE notas_compartidas
  ADD CONSTRAINT notas_compartidas_categoria_check
  CHECK (categoria IN ('general', 'diseno', 'web', 'reunion', 'contenido'));

CREATE INDEX IF NOT EXISTS idx_notas_compartidas_categoria
  ON notas_compartidas (categoria, eliminado_at, updated_at DESC);
