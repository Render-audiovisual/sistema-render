-- MIGRATION: Extender tabla tareas con motor flexible de tareas
-- Fecha: 2026-07-19
-- Propósito: Agregar relaciones historia_id y publicacion_id, y campos de clasificación

-- Paso 1: Agregar columnas nuevas (sin datos inicialmente)
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS (
  historia_id INTEGER REFERENCES historias(id) ON DELETE CASCADE,
  publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE CASCADE,
  tipo_tarea TEXT CHECK (tipo_tarea IN ('diseno', 'edicion', 'produccion')),
  subtipo TEXT,
  prioridad TEXT DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta'))
);

-- Paso 2: Constraint para asegurar que una tarea referencia como máximo UNA pieza
-- (pero puede no referenciar ninguna = tarea independiente)
ALTER TABLE tareas ADD CONSTRAINT tarea_referencia_unica CHECK (
  (
    CASE WHEN historia_id IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN publicacion_id IS NOT NULL THEN 1 ELSE 0 END
  ) <= 1
);

-- Paso 3: Índices para queries rápidas
CREATE INDEX IF NOT EXISTS idx_tareas_historia_id ON tareas(historia_id);
CREATE INDEX IF NOT EXISTS idx_tareas_publicacion_id ON tareas(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_tareas_tipo ON tareas(tipo_tarea);
CREATE INDEX IF NOT EXISTS idx_tareas_asignado_a ON tareas(asignado_a);

-- Paso 4: Actualizar existing tareas (si las hay) para que sean "independientes"
-- (es decir, no referencian a ninguna pieza)
-- Si había tareas previamente, quedan con historia_id=NULL y publicacion_id=NULL
-- Esto permite que el sistema siga funcionando sin romper datos existentes

COMMIT;
