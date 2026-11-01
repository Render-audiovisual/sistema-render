-- Reportes semanales de Instagram. 'hechos' son los datos calculados por el
-- sistema; 'conclusiones' es texto opcional redactado por IA solo a partir de
-- esos hechos (desactivado salvo habilitación explícita en el ejecutor).
CREATE TABLE instagram_reportes (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('semanal')),
  desde DATE NOT NULL,
  hasta DATE NOT NULL CHECK (hasta >= desde),
  generado_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  hechos JSONB NOT NULL CHECK (jsonb_typeof(hechos) = 'object'),
  conclusiones TEXT CHECK (conclusiones IS NULL OR length(conclusiones) <= 20000),
  modelo TEXT CHECK (modelo IS NULL OR length(modelo) <= 100),
  estado TEXT NOT NULL CHECK (estado IN ('solo_datos', 'ia', 'ia_error')),
  CHECK ((estado = 'ia') = (conclusiones IS NOT NULL)),
  UNIQUE (tipo, desde)
);
