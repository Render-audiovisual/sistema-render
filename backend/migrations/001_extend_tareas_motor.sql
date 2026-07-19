-- MIGRATION 001: Extender tabla tareas con motor flexible de tareas
-- Fecha: 2026-07-19
-- Propósito: Agregar relaciones historia_id y publicacion_id, y campos de clasificación
--
-- Nota: en un servidor levantado desde 000_initial_schema.sql estas columnas
-- y el constraint ya existen — cada paso de acá es un no-op seguro en ese
-- caso. Esta migración solo hace falta en el servidor viejo, donde `tareas`
-- se creó a mano sin estos campos.

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS historia_id INTEGER REFERENCES historias(id) ON DELETE CASCADE;
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS publicacion_id INTEGER REFERENCES publicaciones(id) ON DELETE CASCADE;
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS tipo_tarea TEXT CHECK (tipo_tarea IN ('diseno', 'edicion', 'produccion'));
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS subtipo TEXT;
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta'));

-- Constraint: una tarea referencia como máximo UNA pieza (o ninguna = tarea
-- independiente). ALTER TABLE ADD CONSTRAINT no soporta IF NOT EXISTS en
-- Postgres, así que lo chequeamos a mano antes de agregarlo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tarea_referencia_unica'
  ) THEN
    ALTER TABLE tareas ADD CONSTRAINT tarea_referencia_unica CHECK (
      (CASE WHEN historia_id IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN publicacion_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tareas_historia_id ON tareas(historia_id);
CREATE INDEX IF NOT EXISTS idx_tareas_publicacion_id ON tareas(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_tareas_tipo ON tareas(tipo_tarea);
CREATE INDEX IF NOT EXISTS idx_tareas_asignado_a ON tareas(asignado_a);

-- Tareas ya existentes (si las había) quedan con historia_id=NULL y
-- publicacion_id=NULL, es decir, como tareas independientes. No rompe nada.
