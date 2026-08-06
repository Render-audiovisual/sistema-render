CREATE UNIQUE INDEX IF NOT EXISTS tareas_render_os_origen_visita_unico
  ON tareas ((propiedades_extra->>'origen_visita_id'))
  WHERE propiedades_extra->>'workspace' = 'render_os'
    AND propiedades_extra->>'origen_visita_id' IS NOT NULL;
