ALTER TABLE wilson_conversaciones
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wilson_mensajes_no_leidos
  ON wilson_mensajes (conversacion_id, remitente, created_at, id);
