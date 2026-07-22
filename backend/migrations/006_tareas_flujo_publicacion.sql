-- MIGRATION 006: Flujo único de estados para Tareas
-- Fecha: 2026-07-22
-- Flujo: Pendiente → En proceso → En revisión → Programada → Publicada.

-- El CHECK original fue creado sin nombre explícito. Se busca por su
-- definición para que la migración también funcione si el nombre automático
-- cambió en algún entorno.
DO $$
DECLARE
  nombre_constraint TEXT;
BEGIN
  SELECT conname INTO nombre_constraint
  FROM pg_constraint
  WHERE conrelid = 'tareas'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%estado%';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tareas DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END $$;

-- Conserva el dato de una tarea bloqueada antes de ubicarla en revisión.
UPDATE tareas
SET propiedades_extra = propiedades_extra || '{"estado_anterior":"bloqueada"}'::jsonb
WHERE estado = 'bloqueada';

UPDATE tareas SET estado = 'en_revision' WHERE estado = 'bloqueada';
UPDATE tareas SET estado = 'publicada' WHERE estado = 'hecha';

ALTER TABLE tareas ADD CONSTRAINT tareas_estado_check
  CHECK (estado IN ('pendiente', 'en_progreso', 'en_revision', 'programada', 'publicada'));
