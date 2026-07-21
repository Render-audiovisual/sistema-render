-- MIGRATION 005: Tablero de tareas real en /piezas
-- Fecha: 2026-07-21
-- Propósito: soportar el rediseño de Tareas (tabla operativa sobre la tabla
-- `tareas` real, no ya sobre el UNION de historias+publicaciones).
--
-- 1) Amplía tipo_tarea para aceptar los sectores 'community' y
--    'administracion' (hoy solo existen diseno/edicion/produccion).
-- 2) Suma aclaraciones y material_referencia como columnas propias de
--    tareas: una tarea sin historia_id/publicacion_id (el caso típico de
--    community/administración, o cualquier tarea suelta) no tenía antes
--    dónde guardar esto — solo existía en historias/publicaciones.

-- El CHECK de tipo_tarea se declaró sin nombre en 000_initial_schema.sql,
-- así que Postgres le puso un nombre automático. Lo buscamos dinámicamente
-- en vez de asumirlo, para no romper si alguna migración manual histórica
-- lo alteró.
DO $$
DECLARE
  nombre_constraint TEXT;
BEGIN
  SELECT conname INTO nombre_constraint
  FROM pg_constraint
  WHERE conrelid = 'tareas'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tipo_tarea%';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tareas DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END $$;

ALTER TABLE tareas ADD CONSTRAINT tareas_tipo_tarea_check
  CHECK (tipo_tarea IN ('diseno', 'edicion', 'produccion', 'community', 'administracion'));

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS aclaraciones TEXT;
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS material_referencia TEXT;
