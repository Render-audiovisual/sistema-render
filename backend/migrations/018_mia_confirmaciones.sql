CREATE TABLE IF NOT EXISTS integracion_confirmaciones (
  token UUID PRIMARY KEY,
  integracion TEXT NOT NULL,
  canal TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  grupo_id TEXT NOT NULL,
  operacion TEXT NOT NULL,
  tarea_id INTEGER,
  payload_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integracion_confirmaciones_vigentes
  ON integracion_confirmaciones (integracion, canal, actor_id, grupo_id, expires_at)
  WHERE used_at IS NULL;
