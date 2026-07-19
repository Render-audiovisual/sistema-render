-- MIGRATION 002: Consolidate Historias + Workflow
-- Fecha: 2026-07-19
-- Propósito: Una sola fuente de verdad para historias (eliminar duplicación)

-- ============================================================================
-- FASE 1: BACKUP DE TABLAS EXISTENTES
-- ============================================================================
-- workflow_historia solo existe en despliegues viejos (nunca tuvo migration
-- propia — se creó a mano en el servidor original). En un servidor nuevo,
-- levantado desde 000_initial_schema.sql, esta tabla no existe: todo lo que
-- dependa de ella se salta de forma segura.

CREATE TABLE IF NOT EXISTS historias_backup_pre_consolidation AS
  SELECT * FROM historias;

CREATE TABLE IF NOT EXISTS publicaciones_backup_pre_consolidation AS
  SELECT * FROM publicaciones;

DO $$
BEGIN
  IF to_regclass('workflow_historia') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS workflow_historia_backup_pre_consolidation AS SELECT * FROM workflow_historia';
  END IF;
END $$;

-- ============================================================================
-- FASE 2: EXTENDER TABLA HISTORIAS CON CAMPOS DE WORKFLOW
-- ============================================================================

ALTER TABLE historias ADD COLUMN IF NOT EXISTS responsable_planificacion TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS responsable_diseño TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS responsable_revisión TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS responsable_publicacion TEXT;

ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_planificacion_inicio DATE;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_diseño_inicio DATE;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_diseño_entrega DATE;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_revisión_inicio DATE;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_revisión_aprobación DATE;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS fecha_publicación_real TIMESTAMP;

ALTER TABLE historias ADD COLUMN IF NOT EXISTS notas_planificacion TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS notas_diseño TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS notas_revisión TEXT;
ALTER TABLE historias ADD COLUMN IF NOT EXISTS notas_bloqueador TEXT;

-- ============================================================================
-- FASE 3: MIGRAR DATOS DE WORKFLOW_HISTORIA → HISTORIAS (solo si existe)
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('workflow_historia') IS NOT NULL THEN
    EXECUTE '
      UPDATE historias h
      SET
        responsable_planificacion = COALESCE(wh.responsable_planificacion, h.responsable),
        responsable_diseño = COALESCE(wh.responsable_diseño, h.responsable),
        responsable_revisión = wh.responsable_revisión,
        fecha_diseño_entrega = wh.fecha_entrega_diseño,
        fecha_revisión_aprobación = wh.fecha_revisión,
        fecha_publicación_real = wh.fecha_publicación,
        notas_planificacion = wh.notas
      FROM workflow_historia wh
      WHERE h.id = wh.historia_id
    ';
  END IF;
END $$;

-- ============================================================================
-- FASE 4: EXTENDER TABLA PUBLICACIONES
-- ============================================================================

ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS duracion_segundos INTEGER;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS num_imagenes INTEGER;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS responsable_diseño TEXT;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS responsable_edición TEXT;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS responsable_revisión TEXT;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS responsable_publicacion TEXT;

ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS fecha_diseño_entrega DATE;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS fecha_edición_entrega DATE;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS fecha_revisión_aprobación DATE;
ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS fecha_publicación_real TIMESTAMP;

-- ============================================================================
-- FASE 5: UNIFICAR REELS → VIDEOS
-- ============================================================================

-- Cambiar tipo 'reel' → 'video' y asignar duración default
UPDATE publicaciones
SET
  tipo = 'video',
  duracion_segundos = COALESCE(duracion_segundos, 30)
WHERE tipo = 'reel';

-- flyer se migra desde la app (banner en /planificacion-historias),
-- no acá — necesita mover cada fila a la tabla historias, no solo
-- cambiar un valor de columna.

-- ============================================================================
-- FASE 6: CREAR ÍNDICES NUEVOS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_historias_responsable_diseño
  ON historias(responsable_diseño);

CREATE INDEX IF NOT EXISTS idx_historias_responsable_revisión
  ON historias(responsable_revisión);

CREATE INDEX IF NOT EXISTS idx_historias_fecha_diseño_entrega
  ON historias(fecha_diseño_entrega);

CREATE INDEX IF NOT EXISTS idx_historias_estado_responsable
  ON historias(estado, responsable_diseño);

CREATE INDEX IF NOT EXISTS idx_publicaciones_tipo_estado
  ON publicaciones(tipo, estado);

CREATE INDEX IF NOT EXISTS idx_publicaciones_responsable_diseño
  ON publicaciones(responsable_diseño);

-- ============================================================================
-- FASE 7: AGREGAR CONSTRAINT DE COHERENCIA (opcional)
-- ============================================================================

-- Este constraint asegura que si hay fecha_diseño_entrega, debe haber fecha_diseño_inicio
-- (Puede desactivarse si causa problemas)
-- ALTER TABLE historias ADD CONSTRAINT historias_fecha_coherencia CHECK (
--   fecha_diseño_entrega IS NULL OR fecha_diseño_inicio IS NOT NULL
-- );

-- El tracking de qué migración se aplicó lo lleva backend/scripts/migrate.js
-- en la tabla _migrations (creada en 000_initial_schema.sql), no este archivo.
