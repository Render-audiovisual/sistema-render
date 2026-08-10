CREATE TABLE IF NOT EXISTS integracion_auditoria (
  id BIGSERIAL PRIMARY KEY,
  integracion TEXT NOT NULL,
  canal TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_nombre TEXT NOT NULL,
  grupo_id TEXT,
  accion TEXT NOT NULL,
  tarea_id INTEGER,
  resultado TEXT NOT NULL DEFAULT 'ok',
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integracion_auditoria_tarea
  ON integracion_auditoria (tarea_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integracion_auditoria_actor
  ON integracion_auditoria (canal, actor_id, created_at DESC);
