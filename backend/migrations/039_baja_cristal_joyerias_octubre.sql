-- Cristal Joyerías deja de formar parte de la operación desde octubre de 2026.
-- La baja es lógica: se conserva íntegro el historial anterior para consultas,
-- reportes y auditoría, sin proyectar trabajo ni facturación desde octubre.

UPDATE clientes
SET activo = FALSE,
    fecha_fin = DATE '2026-09-30'
WHERE lower(trim(nombre)) IN (
  'cristal joyería',
  'cristal joyeria',
  'cristal joyerías',
  'cristal joyerias',
  'joyería cristal',
  'joyeria cristal'
);

UPDATE contratos_financieros
SET activo = FALSE,
    finaliza_el = DATE '2026-09-30'
WHERE lower(trim(nombre)) IN (
  'cristal joyería',
  'cristal joyeria',
  'cristal joyerías',
  'cristal joyerias',
  'joyería cristal',
  'joyeria cristal'
);

-- Las tareas todavía abiertas salen del tablero operativo, pero quedan en el
-- archivo y pueden recuperarse con todo su contenido original.
UPDATE tareas
SET propiedades_extra = COALESCE(propiedades_extra, '{}'::jsonb)
    || jsonb_build_object(
      'archivada_render_os', TRUE,
      'motivo_archivo', 'Baja operativa de Cristal Joyerías desde octubre de 2026',
      'archivada_en', '2026-10-01'
    ),
    updated_at = NOW()
WHERE cliente_id IN (
    SELECT id FROM clientes
    WHERE lower(trim(nombre)) IN (
      'cristal joyería', 'cristal joyeria', 'cristal joyerías',
      'cristal joyerias', 'joyería cristal', 'joyeria cristal'
    )
  )
  AND propiedades_extra->>'workspace' = 'render_os'
  AND propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND estado IN ('pendiente', 'en_progreso', 'en_proceso', 'para_revisar', 'revisar', 'en_revision');

-- La planificación desde octubre deja de mostrarse en los tableros activos.
UPDATE publicaciones
SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'archivado_tablero', TRUE,
      'motivo_archivo', 'Baja operativa de Cristal Joyerías',
      'archivada_en', '2026-10-01'
    ),
    updated_at = NOW()
WHERE cliente_id IN (
    SELECT id FROM clientes
    WHERE lower(trim(nombre)) IN (
      'cristal joyería', 'cristal joyeria', 'cristal joyerías',
      'cristal joyerias', 'joyería cristal', 'joyeria cristal'
    )
  )
  AND fecha_programada >= DATE '2026-10-01'
  AND metadata->>'archivado_tablero' IS DISTINCT FROM 'true';

UPDATE historias
SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'archivado_tablero', TRUE,
      'motivo_archivo', 'Baja operativa de Cristal Joyerías',
      'archivada_en', '2026-10-01'
    ),
    updated_at = NOW()
WHERE cliente_id IN (
    SELECT id FROM clientes
    WHERE lower(trim(nombre)) IN (
      'cristal joyería', 'cristal joyeria', 'cristal joyerías',
      'cristal joyerias', 'joyería cristal', 'joyeria cristal'
    )
  )
  AND fecha_programada >= DATE '2026-10-01'
  AND metadata->>'archivado_tablero' IS DISTINCT FROM 'true';
