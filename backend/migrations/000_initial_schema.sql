-- MIGRATION 000: Schema inicial completo
-- Fecha: 2026-07-19
-- Propósito: Crear todas las tablas desde cero. Nunca existió un schema.sql
-- versionado — las tablas del servidor original se crearon a mano y no son
-- reproducibles (ver docs/DIAGNOSTICO_RENDER.md). Este archivo es la fuente
-- de verdad para levantar una base de datos nueva desde cero.
--
-- Uso: correr este archivo primero, luego 001 y 002 en orden. El script
-- backend/scripts/migrate.js hace esto automáticamente y es idempotente.

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── USUARIOS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'diseno', 'edicion', 'produccion', 'community')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── CLIENTES ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cuota_reels INTEGER NOT NULL DEFAULT 0,
  cuota_carruseles INTEGER NOT NULL DEFAULT 0
);

-- ── HISTORIAS (ya incluye los campos consolidados de migración 002) ───────

CREATE TABLE IF NOT EXISTS historias (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'en_diseño', 'en_edición', 'en_revision', 'en_revisión',
    'lista', 'publicada', 'bloqueada'
  )),
  fecha_programada DATE NOT NULL,
  responsable TEXT,
  idea TEXT DEFAULT '',
  copy TEXT DEFAULT '',
  material_referencia TEXT DEFAULT '',
  aclaraciones TEXT DEFAULT '',
  prioridad TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),
  metadata JSONB NOT NULL DEFAULT '{}',

  responsable_planificacion TEXT,
  responsable_diseño TEXT,
  responsable_revisión TEXT,
  responsable_publicacion TEXT,
  fecha_planificacion_inicio DATE,
  fecha_diseño_inicio DATE,
  fecha_diseño_entrega DATE,
  fecha_revisión_inicio DATE,
  fecha_revisión_aprobación DATE,
  fecha_publicación_real TIMESTAMPTZ,
  notas_planificacion TEXT,
  notas_diseño TEXT,
  notas_revisión TEXT,
  notas_bloqueador TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historias_cliente ON historias(cliente_id);
CREATE INDEX IF NOT EXISTS idx_historias_estado ON historias(estado);
CREATE INDEX IF NOT EXISTS idx_historias_fecha_programada ON historias(fecha_programada);

-- ── PUBLICACIONES (ya incluye los campos consolidados de migración 002) ───

CREATE TABLE IF NOT EXISTS publicaciones (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('video', 'carrusel', 'flyer', 'reel')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'en_diseño', 'en_edición', 'en_revision', 'en_revisión',
    'lista', 'publicada', 'bloqueada'
  )),
  fecha_programada DATE NOT NULL,
  responsable TEXT,
  idea TEXT DEFAULT '',
  copy TEXT DEFAULT '',
  material_referencia TEXT DEFAULT '',
  aclaraciones TEXT DEFAULT '',
  prioridad TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),
  metadata JSONB NOT NULL DEFAULT '{}',

  duracion_segundos INTEGER,
  num_imagenes INTEGER,
  responsable_diseño TEXT,
  responsable_edición TEXT,
  responsable_revisión TEXT,
  responsable_publicacion TEXT,
  fecha_diseño_entrega DATE,
  fecha_edición_entrega DATE,
  fecha_revisión_aprobación DATE,
  fecha_publicación_real TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publicaciones_cliente ON publicaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_publicaciones_estado ON publicaciones(estado);
CREATE INDEX IF NOT EXISTS idx_publicaciones_tipo ON publicaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_publicaciones_fecha_programada ON publicaciones(fecha_programada);

-- Nota: 'flyer' y 'reel' se aceptan a nivel de columna por compatibilidad
-- con datos viejos, pero POST /piezas ya no los ofrece al crear (ver
-- backend/src/server.js) — reel se unificó en 'video', flyer vive en
-- historias. El banner de HistoriasPage convierte flyers legacy si aparecen.

-- ── TAREAS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tareas (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'en_progreso', 'en_revision', 'hecha', 'bloqueada'
  )),
  asignado_a TEXT NOT NULL,
  requiere_aprobacion BOOLEAN NOT NULL DEFAULT false,
  tarea_padre_id INTEGER REFERENCES tareas(id) ON DELETE SET NULL,
  propiedades_extra JSONB NOT NULL DEFAULT '{}',
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  fecha_vencimiento DATE,

  historia_id INTEGER REFERENCES historias(id) ON DELETE CASCADE,
  publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE CASCADE,
  tipo_tarea TEXT CHECK (tipo_tarea IN ('diseno', 'edicion', 'produccion')),
  subtipo TEXT,
  prioridad TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tarea_referencia_unica CHECK (
    (CASE WHEN historia_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN publicacion_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_tareas_asignado_a ON tareas(asignado_a);
CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_historia_id ON tareas(historia_id);
CREATE INDEX IF NOT EXISTS idx_tareas_publicacion_id ON tareas(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_tareas_tipo ON tareas(tipo_tarea);

-- ── ESTRUCTURA BASE POR CLIENTE ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estructura_cliente (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  tema TEXT,
  horario TEXT,
  cta_fijo TEXT,
  tipo TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (cliente_id, dia_semana)
);

-- ── CHECK DE PUBLICACIÓN DIARIO ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS check_publicacion (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  publicado BOOLEAN NOT NULL DEFAULT false,
  confirmado_por TEXT,
  confirmado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, fecha)
);

-- ── FECHAS ESPECIALES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fechas_especiales (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  fecha DATE,
  evento TEXT NOT NULL,
  tipo TEXT,
  anticipacion_dias INTEGER,
  idea TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'hecho')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
