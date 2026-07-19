-- MIGRATION 002: Consolidate Historias + Workflow
-- Fecha: 2026-07-19
-- Propósito: Una sola fuente de verdad para historias (eliminar duplicación)

-- ============================================================================
-- FASE 1: BACKUP DE TABLAS EXISTENTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS historias_backup_pre_consolidation AS
  SELECT * FROM historias;

CREATE TABLE IF NOT EXISTS workflow_historia_backup_pre_consolidation AS
  SELECT * FROM workflow_historia;

CREATE TABLE IF NOT EXISTS publicaciones_backup_pre_consolidation AS
  SELECT * FROM publicaciones;

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
-- FASE 3: MIGRAR DATOS DE WORKFLOW_HISTORIA → HISTORIAS
-- ============================================================================

-- Copiar responsables
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
WHERE h.id = wh.historia_id;

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
WHERE tipo = 'reel' OR tipo = 'video';

-- Verificar que solo existan video y carrusel
-- (flyer será migrado via app, no aquí)

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

-- ============================================================================
-- FASE 8: LOGGING DE MIGRACIÓN
-- ============================================================================

INSERT INTO _migration_log (nombre, version, timestamp, estado)
VALUES (
  'consolidate_historias_workflow',
  '002',
  NOW(),
  'completed'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- FASE 9: VALIDACIÓN
-- ============================================================================

-- Verificaciones de integridad (comentadas, ejecutar manualmente si es necesario)

-- SELECT 'VALIDACIÓN: Total historias' as check_name, COUNT(*) as count FROM historias;
-- SELECT 'VALIDACIÓN: Total publicaciones' as check_name, COUNT(*) as count FROM publicaciones;
-- SELECT 'VALIDACIÓN: Tipos únicos en publicaciones' as tipos, ARRAY_AGG(DISTINCT tipo) as tipos_disponibles FROM publicaciones;
-- SELECT 'VALIDACIÓN: Historias con responsables' as check_name, COUNT(*) FILTER (WHERE responsable_diseño IS NOT NULL) as con_responsable FROM historias;

COMMIT;
