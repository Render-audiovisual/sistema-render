-- Lavalle opera dos cuentas con historias independientes, pero comparte una
-- única producción mensual de feed entre Hortícola y Market.

CREATE TABLE IF NOT EXISTS grupos_feed (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cuota_mensual INTEGER NOT NULL DEFAULT 0 CHECK (cuota_mensual >= 0)
);

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS grupo_feed_id INTEGER REFERENCES grupos_feed(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_grupo_feed ON clientes(grupo_feed_id);

INSERT INTO grupos_feed (nombre, cuota_mensual)
VALUES ('Lavalle', 16)
ON CONFLICT (nombre)
DO UPDATE SET cuota_mensual = EXCLUDED.cuota_mensual;

UPDATE clientes
SET
  grupo_feed_id = (SELECT id FROM grupos_feed WHERE nombre = 'Lavalle'),
  cuota_reels = 0,
  cuota_carruseles = 0
WHERE nombre IN ('Lavalle Hortícola', 'Lavalle Market');
