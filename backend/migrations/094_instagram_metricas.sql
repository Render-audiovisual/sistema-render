-- Métricas de Instagram leídas desde la Graph API de Meta (solo lectura hacia Meta).
-- Aditiva: no modifica clientes, publicaciones, objetivos ni tareas existentes.
-- El token de Meta vive solo en el entorno del ejecutor; nunca en la base.

-- Cuentas descubiertas con el token del usuario del sistema. La vinculación con
-- un cliente es explícita (cliente_id NULL hasta que un Líder la confirme).
CREATE TABLE instagram_cuentas (
  ig_user_id TEXT PRIMARY KEY CHECK (ig_user_id ~ '^[0-9]{1,32}$'),
  username TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_.]{1,30}$'),
  page_id TEXT CHECK (page_id IS NULL OR page_id ~ '^[0-9]{1,32}$'),
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  descubierta_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  vista_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sincronizada_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX instagram_cuentas_cliente_uidx ON instagram_cuentas(cliente_id) WHERE cliente_id IS NOT NULL;

-- Seguidores por día (una fila por cuenta y fecha de Córdoba; se pisa en el día).
CREATE TABLE instagram_cuenta_seguidores (
  ig_user_id TEXT NOT NULL REFERENCES instagram_cuentas(ig_user_id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  seguidores INTEGER NOT NULL CHECK (seguidores >= 0),
  medido_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ig_user_id, fecha)
);

-- Reels y carruseles publicados. publicacion_id enlaza con la pieza del sistema
-- (y por ella con responsables y objetivos). 'manual' nunca se reescribe solo.
CREATE TABLE instagram_media (
  ig_media_id TEXT PRIMARY KEY CHECK (ig_media_id ~ '^[0-9]{1,40}$'),
  ig_user_id TEXT NOT NULL REFERENCES instagram_cuentas(ig_user_id) ON DELETE CASCADE,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('reel', 'carrusel', 'imagen')),
  permalink TEXT NOT NULL CHECK (permalink ~ '^https://www\.instagram\.com/'),
  caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 2200),
  publicado_at TIMESTAMPTZ NOT NULL,
  publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE SET NULL,
  vinculo TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (vinculo IN ('pendiente', 'automatico', 'manual', 'ambiguo', 'sin_pieza')),
  CHECK ((vinculo IN ('automatico', 'manual')) = (publicacion_id IS NOT NULL)),
  primera_vista_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX instagram_media_cliente_fecha_idx ON instagram_media(cliente_id, publicado_at DESC);
CREATE INDEX instagram_media_cuenta_fecha_idx ON instagram_media(ig_user_id, publicado_at DESC);
CREATE UNIQUE INDEX instagram_media_publicacion_uidx ON instagram_media(publicacion_id) WHERE publicacion_id IS NOT NULL;

-- Fotos append-only de métricas: permiten ver la curva de cada pieza.
-- NULL significa que Meta no devolvió esa métrica para ese tipo de pieza.
CREATE TABLE instagram_media_metricas (
  id BIGSERIAL PRIMARY KEY,
  ig_media_id TEXT NOT NULL REFERENCES instagram_media(ig_media_id) ON DELETE CASCADE,
  medido_at TIMESTAMPTZ NOT NULL,
  alcance INTEGER CHECK (alcance >= 0),
  vistas INTEGER CHECK (vistas >= 0),
  likes INTEGER CHECK (likes >= 0),
  comentarios INTEGER CHECK (comentarios >= 0),
  guardados INTEGER CHECK (guardados >= 0),
  compartidos INTEGER CHECK (compartidos >= 0),
  interacciones INTEGER CHECK (interacciones >= 0),
  UNIQUE (ig_media_id, medido_at)
);
CREATE INDEX instagram_media_metricas_ultima_idx ON instagram_media_metricas(ig_media_id, medido_at DESC);

CREATE FUNCTION instagram_media_metricas_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las métricas de Instagram son append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER instagram_media_metricas_inmutables BEFORE UPDATE ON instagram_media_metricas
  FOR EACH ROW EXECUTE FUNCTION instagram_media_metricas_inmutables();
