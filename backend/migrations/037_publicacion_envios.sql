-- Preparación y programación de publicaciones sociales.
-- Esta primera etapa persiste borradores y simulaciones; no conecta con Meta.

CREATE TABLE IF NOT EXISTS publicacion_envios (
  id BIGSERIAL PRIMARY KEY,
  publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE SET NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_por_nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('reel', 'carrusel')),
  copy TEXT NOT NULL DEFAULT '',
  primer_comentario TEXT NOT NULL DEFAULT '',
  programada_para TIMESTAMPTZ,
  estado TEXT NOT NULL CHECK (estado IN (
    'borrador', 'programada', 'lista_para_publicar', 'publicando',
    'publicada', 'parcial', 'fallida', 'cancelada'
  )),
  opciones JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  preview_only BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publicacion_envios_estado_fecha_idx
  ON publicacion_envios (estado, programada_para);
CREATE INDEX IF NOT EXISTS publicacion_envios_cliente_idx
  ON publicacion_envios (cliente_id, created_at DESC);

CREATE TABLE IF NOT EXISTS publicacion_envio_materiales (
  id BIGSERIAL PRIMARY KEY,
  envio_id BIGINT NOT NULL REFERENCES publicacion_envios(id) ON DELETE CASCADE,
  posicion SMALLINT NOT NULL CHECK (posicion BETWEEN 1 AND 10),
  drive_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (envio_id, posicion)
);

CREATE TABLE IF NOT EXISTS publicacion_envio_destinos (
  id BIGSERIAL PRIMARY KEY,
  envio_id BIGINT NOT NULL REFERENCES publicacion_envios(id) ON DELETE CASCADE,
  plataforma TEXT NOT NULL CHECK (plataforma IN ('instagram', 'facebook')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'simulada', 'publicando', 'publicada', 'fallida'
  )),
  intentos SMALLINT NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 3),
  external_media_id TEXT,
  permalink TEXT,
  ultimo_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (envio_id, plataforma)
);

