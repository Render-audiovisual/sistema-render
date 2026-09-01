ALTER TABLE integracion_confirmaciones
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS informante_actor_id TEXT,
  ADD COLUMN IF NOT EXISTS informante_actor_nombre TEXT;

CREATE INDEX IF NOT EXISTS idx_integracion_confirmaciones_lotes_revision
  ON integracion_confirmaciones (operacion, grupo_id, expires_at)
  WHERE used_at IS NULL AND operacion = 'revisar_lote';
