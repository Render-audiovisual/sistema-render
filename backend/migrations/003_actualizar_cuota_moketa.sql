-- Corrige la cuota mensual de videos de Moketa: el Google Sheet
-- CONFIG_MAESTRA (fuente usada para la migración de publicaciones) tenía
-- 4 videos/mes desactualizado; el compromiso real confirmado al definir
-- las responsabilidades del equipo es 8. Solo actualiza si sigue en el
-- valor viejo, para no pisar un ajuste manual posterior.
UPDATE clientes
SET cuota_reels = 8
WHERE nombre = 'Moketa' AND cuota_reels = 4;
