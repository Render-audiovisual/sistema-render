CREATE TABLE IF NOT EXISTS moodboard_boards (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS moodboard_board_clients (
  board_id INTEGER NOT NULL REFERENCES moodboard_boards(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  PRIMARY KEY (board_id, cliente_id)
);

CREATE TABLE IF NOT EXISTS moodboard_categories (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES moodboard_boards(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS moodboard_categories_board_nombre_idx
  ON moodboard_categories(board_id, lower(nombre));

CREATE TABLE IF NOT EXISTS moodboard_references (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES moodboard_boards(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES moodboard_categories(id) ON DELETE SET NULL,
  titulo TEXT,
  nota TEXT NOT NULL,
  etiquetas TEXT[] NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'libre' CHECK (estado IN ('libre', 'aprobada', 'descartada')),
  tipo_fuente TEXT NOT NULL CHECK (tipo_fuente IN ('imagen', 'enlace', 'pinterest')),
  enlace_externo TEXT,
  archivo_nombre TEXT,
  autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  autor_nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (enlace_externo IS NOT NULL OR archivo_nombre IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS moodboard_reference_tasks (
  reference_id INTEGER NOT NULL REFERENCES moodboard_references(id) ON DELETE CASCADE,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  PRIMARY KEY (reference_id, tarea_id)
);

WITH clientes_activos AS (
  SELECT id, nombre,
    CASE
      WHEN nombre ILIKE '%ángel azul%' OR nombre ILIKE '%angel azul%' THEN 'compartido:angel-azul'
      WHEN nombre ILIKE '%lavalle%' THEN 'compartido:lavalle'
      ELSE 'cliente:' || id::text
    END AS clave
  FROM clientes
  WHERE COALESCE(activo, true) = true
), grupos AS (
  SELECT clave,
    CASE
      WHEN clave = 'compartido:angel-azul' THEN 'El Ángel Azul'
      WHEN clave = 'compartido:lavalle' THEN 'Lavalle'
      ELSE min(nombre)
    END AS nombre
  FROM clientes_activos GROUP BY clave
), creados AS (
  INSERT INTO moodboard_boards(nombre)
  SELECT nombre FROM grupos
  RETURNING id, nombre
)
INSERT INTO moodboard_board_clients(board_id, cliente_id)
SELECT b.id, ca.id
FROM clientes_activos ca
JOIN grupos g ON g.clave = ca.clave
JOIN moodboard_boards b ON b.nombre = g.nombre
ON CONFLICT (cliente_id) DO NOTHING;

INSERT INTO moodboard_categories(board_id, nombre, orden)
SELECT b.id, categoria.nombre, categoria.orden
FROM moodboard_boards b
CROSS JOIN (VALUES
  ('Fotografía', 1), ('Tipografía', 2), ('Color', 3), ('Composición', 4),
  ('Historias', 5), ('Carrusel', 6), ('Flyer', 7)
) AS categoria(nombre, orden)
ON CONFLICT DO NOTHING;

WITH ejemplos AS (
  SELECT b.id,
    row_number() OVER (ORDER BY b.id) AS numero,
    (SELECT id FROM moodboard_categories c WHERE c.board_id = b.id AND c.nombre = 'Fotografía' LIMIT 1) AS category_id
  FROM moodboard_boards b
)
INSERT INTO moodboard_references(
  board_id, category_id, titulo, nota, etiquetas, estado, tipo_fuente,
  enlace_externo, autor_nombre
)
SELECT id, category_id, 'Referencia visual de ejemplo',
  'Esta imagen es un ejemplo para empezar el moodboard. Podés editarla, cambiar su estado o eliminarla cuando la marca tenga referencias propias.',
  ARRAY['ejemplo', 'inspiración'], 'libre', 'enlace',
  CASE (numero - 1) % 4
    WHEN 0 THEN 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=82'
    WHEN 1 THEN 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=1200&q=82'
    WHEN 2 THEN 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=82'
    ELSE 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=82'
  END,
  'Equipo RENDER'
FROM ejemplos
WHERE NOT EXISTS (SELECT 1 FROM moodboard_references r WHERE r.board_id = ejemplos.id);
