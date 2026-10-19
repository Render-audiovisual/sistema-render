-- Additive shared registry. Never infer video identities from historical text/counts.
CREATE TABLE produccion_visitas (
  id UUID PRIMARY KEY,
  tarea_origen_id INTEGER UNIQUE REFERENCES tareas(id) ON DELETE RESTRICT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  titulo TEXT NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 250),
  observaciones TEXT NOT NULL DEFAULT '',
  drive_url TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  creado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX produccion_visitas_fecha_idx ON produccion_visitas(fecha, id);
CREATE INDEX produccion_visitas_cliente_fecha_idx ON produccion_visitas(cliente_id, fecha);

CREATE TABLE produccion_visita_participantes (
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  PRIMARY KEY (visita_id, usuario_id)
);

CREATE TABLE produccion_videos (
  id UUID PRIMARY KEY,
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  video_origen_id UUID REFERENCES produccion_videos(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 250),
  guion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'planificado' CHECK (estado IN ('planificado','grabado','pendiente','repetir')),
  material_url TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  tarea_edicion_id INTEGER UNIQUE REFERENCES tareas(id) ON DELETE RESTRICT,
  editor_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  fecha_entrega DATE,
  creado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tarea_edicion_id IS NULL AND editor_id IS NULL AND fecha_entrega IS NULL)
    OR (tarea_edicion_id IS NOT NULL AND editor_id IS NOT NULL AND fecha_entrega IS NOT NULL))
);
CREATE INDEX produccion_videos_visita_idx ON produccion_videos(visita_id, created_at, id);
CREATE UNIQUE INDEX produccion_video_retomado_unico ON produccion_videos(visita_id, video_origen_id)
  WHERE video_origen_id IS NOT NULL;

CREATE TABLE produccion_fotos (
  id UUID PRIMARY KEY,
  visita_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (length(trim(tipo)) BETWEEN 1 AND 250),
  estado TEXT NOT NULL DEFAULT 'realizada' CHECK (estado IN ('realizada','pendiente','repetir')),
  drive_url TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  creado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX produccion_fotos_visita_idx ON produccion_fotos(visita_id, created_at, id);
