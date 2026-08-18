ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cuota_historias INTEGER NOT NULL DEFAULT 0
    CHECK (cuota_historias >= 0),
  ADD COLUMN IF NOT EXISTS estado_cliente TEXT NOT NULL DEFAULT 'activo'
    CHECK (estado_cliente IN ('activo', 'pausado', 'finalizado'));

CREATE INDEX IF NOT EXISTS idx_clientes_estado_cliente ON clientes(estado_cliente);
