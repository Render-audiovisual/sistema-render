ALTER TABLE contratos_financieros 
ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_contratos_activo ON contratos_financieros(activo);
