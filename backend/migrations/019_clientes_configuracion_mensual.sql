-- Configuración comercial mensual de clientes.
-- Es aditiva: no altera ni completa artificialmente los clientes existentes.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS rubro TEXT,
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
  ADD COLUMN IF NOT EXISTS fecha_fin DATE;

CREATE TABLE IF NOT EXISTS cliente_configuraciones (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  vigente_desde DATE NOT NULL,
  cuota_reels INTEGER NOT NULL DEFAULT 0 CHECK (cuota_reels >= 0),
  cuota_carruseles INTEGER NOT NULL DEFAULT 0 CHECK (cuota_carruseles >= 0),
  dias_historias SMALLINT[] NOT NULL DEFAULT '{}',
  disenador_responsable TEXT NOT NULL,
  abono_mensual NUMERIC(14, 2) NOT NULL CHECK (abono_mensual >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, vigente_desde),
  CHECK (EXTRACT(DAY FROM vigente_desde) = 1),
  CHECK (dias_historias <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[])
);

CREATE INDEX IF NOT EXISTS idx_cliente_configuraciones_vigencia
  ON cliente_configuraciones(cliente_id, vigente_desde DESC);
