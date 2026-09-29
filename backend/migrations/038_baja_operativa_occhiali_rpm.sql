-- Baja lógica de Óptica Occhiali y RPM Chevrolet.
-- Conserva tareas, publicaciones, reportes e historial para poder auditarlos.
UPDATE clientes
SET activo = FALSE,
    fecha_fin = COALESCE(fecha_fin, CURRENT_DATE)
WHERE lower(trim(nombre)) IN (
  'óptica occhiali',
  'optica occhiali',
  'óptica ochiali',
  'optica ochiali',
  'rpm chevrolet',
  'chevrolet rpm',
  'rpm'
);

-- Finanzas administra sus contratos por nombre y no por cliente_id. También
-- deben quedar de baja para no proyectar cobros posteriores a la salida.
UPDATE contratos_financieros
SET activo = FALSE,
    finaliza_el = COALESCE(finaliza_el, CURRENT_DATE)
WHERE lower(trim(nombre)) IN (
  'óptica occhiali',
  'optica occhiali',
  'óptica ochiali',
  'optica ochiali',
  'rpm chevrolet',
  'chevrolet rpm',
  'rpm'
);

-- Las tareas abiertas dejan de formar parte del trabajo operativo, pero no se
-- borran: quedan archivadas y recuperables con su contenido original.
UPDATE tareas
SET propiedades_extra = COALESCE(propiedades_extra, '{}'::jsonb)
    || jsonb_build_object(
      'archivada_render_os', TRUE,
      'motivo_archivo', 'Baja operativa del cliente',
      'archivada_en', CURRENT_DATE::text
    ),
    updated_at = NOW()
WHERE cliente_id IN (
    SELECT id
    FROM clientes
    WHERE lower(trim(nombre)) IN (
      'óptica occhiali',
      'optica occhiali',
      'óptica ochiali',
      'optica ochiali',
      'rpm chevrolet',
      'chevrolet rpm',
      'rpm'
    )
  )
  AND propiedades_extra->>'workspace' = 'render_os'
  AND propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND estado IN ('pendiente', 'en_progreso', 'en_proceso', 'para_revisar', 'revisar');
