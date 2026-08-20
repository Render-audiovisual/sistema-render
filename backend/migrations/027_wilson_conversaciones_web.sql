CREATE TABLE IF NOT EXISTS wilson_conversaciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  periodo CHAR(7) NOT NULL CHECK (periodo ~ '^\d{4}-\d{2}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, periodo)
);

CREATE TABLE IF NOT EXISTS wilson_mensajes (
  id BIGSERIAL PRIMARY KEY,
  conversacion_id BIGINT NOT NULL REFERENCES wilson_conversaciones(id) ON DELETE CASCADE,
  remitente TEXT NOT NULL CHECK (remitente IN ('usuario', 'wilson')),
  contenido TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'mensaje',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wilson_mensajes_conversacion
  ON wilson_mensajes (conversacion_id, created_at, id);

CREATE TABLE IF NOT EXISTS wilson_acciones_pendientes (
  token UUID PRIMARY KEY,
  conversacion_id BIGINT NOT NULL REFERENCES wilson_conversaciones(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  accion TEXT NOT NULL,
  tarea_id INTEGER REFERENCES tareas(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wilson_envios_programados (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, fecha, tipo)
);
