CREATE TABLE IF NOT EXISTS notas_compartidas (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL DEFAULT 'Nueva nota',
  contenido TEXT NOT NULL DEFAULT '',
  creado_por TEXT NOT NULL,
  modificado_por TEXT NOT NULL,
  eliminado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_compartidas_activas_updated
  ON notas_compartidas (eliminado_at, updated_at DESC);
