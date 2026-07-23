-- Las cuentas de un mismo grupo pueden compartir la producción de feed,
-- pero el cumplimiento debe medirse por formato.

ALTER TABLE grupos_feed
  ADD COLUMN IF NOT EXISTS cuota_reels INTEGER NOT NULL DEFAULT 0 CHECK (cuota_reels >= 0),
  ADD COLUMN IF NOT EXISTS cuota_carruseles INTEGER NOT NULL DEFAULT 0 CHECK (cuota_carruseles >= 0);

-- Compatibilidad con grupos creados antes de separar los formatos.
UPDATE grupos_feed
SET cuota_reels = cuota_mensual
WHERE cuota_reels = 0
  AND cuota_carruseles = 0
  AND cuota_mensual > 0;

-- Definición confirmada para Lavalle: 16 reels y 4 carruseles compartidos.
UPDATE grupos_feed
SET
  cuota_reels = 16,
  cuota_carruseles = 4,
  cuota_mensual = 20
WHERE nombre = 'Lavalle';
