-- Listas personales privadas, inspiradas en una página simple de Notion.
-- El usuario propietario se toma siempre de la sesión autenticada.
CREATE TABLE IF NOT EXISTS listas_personales (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL DEFAULT 'Sin título' CHECK (char_length(titulo) BETWEEN 1 AND 120),
  emoji TEXT NOT NULL DEFAULT '📝' CHECK (char_length(emoji) BETWEEN 1 AND 16),
  posicion INTEGER NOT NULL DEFAULT 0 CHECK (posicion >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listas_personales_usuario_orden
  ON listas_personales(usuario_id, posicion, id);

CREATE TABLE IF NOT EXISTS lista_secciones (
  id BIGSERIAL PRIMARY KEY,
  lista_id BIGINT NOT NULL REFERENCES listas_personales(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL DEFAULT 'Pendientes' CHECK (char_length(titulo) BETWEEN 1 AND 120),
  posicion INTEGER NOT NULL DEFAULT 0 CHECK (posicion >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lista_secciones_lista_orden
  ON lista_secciones(lista_id, posicion, id);

CREATE TABLE IF NOT EXISTS lista_items (
  id BIGSERIAL PRIMARY KEY,
  seccion_id BIGINT NOT NULL REFERENCES lista_secciones(id) ON DELETE CASCADE,
  texto TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 500),
  completado BOOLEAN NOT NULL DEFAULT FALSE,
  posicion INTEGER NOT NULL DEFAULT 0 CHECK (posicion >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lista_items_seccion_orden
  ON lista_items(seccion_id, posicion, id);
