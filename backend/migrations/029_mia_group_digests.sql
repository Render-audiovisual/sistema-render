CREATE TABLE IF NOT EXISTS mia_group_digest_deliveries (
  fingerprint CHAR(64) PRIMARY KEY,
  destino TEXT NOT NULL CHECK (destino IN ('render_brain', 'comunicacion', 'edicion', 'visitas')),
  periodo CHAR(7) NOT NULL CHECK (periodo ~ '^\d{4}-\d{2}$'),
  nivel TEXT NOT NULL CHECK (nivel IN ('riesgo', 'critico')),
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mia_group_digest_deliveries_recent
  ON mia_group_digest_deliveries (destino, delivered_at DESC);

