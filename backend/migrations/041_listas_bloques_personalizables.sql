-- Editor personal por bloques. Conserva las tablas originales para compatibilidad
-- y copia cada sección existente a un bloque checklist una única vez.
CREATE TABLE IF NOT EXISTS lista_bloques (
  id BIGSERIAL PRIMARY KEY,
  lista_id BIGINT NOT NULL REFERENCES listas_personales(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'listado', 'checklist', 'tabla')),
  contenido JSONB NOT NULL DEFAULT '{}'::jsonb,
  posicion INTEGER NOT NULL DEFAULT 0 CHECK (posicion >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lista_bloques_lista_orden
  ON lista_bloques(lista_id, posicion, id);

CREATE TABLE IF NOT EXISTS lista_plantillas_personales (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  emoji TEXT NOT NULL DEFAULT '🧩' CHECK (char_length(emoji) BETWEEN 1 AND 16),
  bloques JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lista_plantillas_usuario
  ON lista_plantillas_personales(usuario_id, updated_at DESC, id DESC);

INSERT INTO lista_bloques(lista_id, tipo, contenido, posicion)
SELECT
  s.lista_id,
  'checklist',
  jsonb_build_object(
    'titulo', s.titulo,
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', 'legacy-' || i.id::text,
          'texto', i.texto,
          'completado', i.completado
        ) ORDER BY i.posicion, i.id
      )
      FROM lista_items i
      WHERE i.seccion_id = s.id
    ), '[]'::jsonb)
  ),
  s.posicion
FROM lista_secciones s
WHERE NOT EXISTS (
  SELECT 1 FROM lista_bloques b WHERE b.lista_id = s.lista_id
);
