CREATE TABLE IF NOT EXISTS integraciones_sistema (
  clave TEXT PRIMARY KEY,
  configuracion JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_por TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

