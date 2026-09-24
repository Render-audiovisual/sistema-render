ALTER TABLE contratos_financieros
ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

UPDATE contratos_financieros SET activo = true WHERE activo IS NULL;

ALTER TABLE contratos_financieros
ALTER COLUMN activo SET DEFAULT true,
ALTER COLUMN activo SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contratos_activo ON contratos_financieros(activo);
