-- RPM Chevrolet dejó de trabajar con RENDER. La baja es lógica para conservar
-- tareas, publicaciones, archivos e historial vinculados.
UPDATE clientes
SET activo = FALSE,
    fecha_fin = COALESCE(fecha_fin, DATE '2026-09-03')
WHERE lower(trim(nombre)) IN ('rpm chevrolet', 'chevrolet rpm');

-- Nadie debe continuar tareas todavía abiertas del cliente inactivo.
UPDATE tareas
SET propiedades_extra = COALESCE(propiedades_extra, '{}'::jsonb)
    || jsonb_build_object(
      'archivada_render_os', TRUE,
      'motivo_archivo', 'Baja operativa de RPM Chevrolet',
      'archivada_en', '2026-09-07'
    ),
    updated_at = NOW()
WHERE cliente_id IN (
    SELECT id FROM clientes
    WHERE lower(trim(nombre)) IN ('rpm chevrolet', 'chevrolet rpm')
  )
  AND propiedades_extra->>'workspace' = 'render_os'
  AND propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND estado IN ('pendiente', 'en_progreso', 'en_proceso');
