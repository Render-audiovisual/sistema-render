-- Corrige definitivamente el apellido de Mariano conservando todos los alias históricos.

UPDATE usuarios
SET nombre = 'Mariano Meza'
WHERE lower(trim(usuario)) = 'mariano'
   OR lower(trim(nombre)) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE tareas
SET asignado_a = 'Mariano Meza'
WHERE lower(trim(asignado_a)) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE tareas
SET propiedades_extra = jsonb_set(
  propiedades_extra,
  '{colaboradores}',
  (SELECT COALESCE(jsonb_agg(
    CASE WHEN lower(trim(value)) IN ('mariano', 'mariano meza', 'mariano mesa')
      THEN to_jsonb('Mariano Meza'::text) ELSE to_jsonb(value) END
  ), '[]'::jsonb)
  FROM jsonb_array_elements_text(propiedades_extra->'colaboradores') AS collaborator(value))
)
WHERE jsonb_typeof(propiedades_extra->'colaboradores') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(propiedades_extra->'colaboradores') AS collaborator(value)
    WHERE lower(trim(value)) IN ('mariano', 'mariano meza', 'mariano mesa')
  );

UPDATE cliente_configuraciones
SET disenador_responsable = 'Mariano Meza'
WHERE lower(trim(disenador_responsable)) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE historias
SET responsable = CASE WHEN lower(trim(responsable)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable END,
    responsable_planificacion = CASE WHEN lower(trim(responsable_planificacion)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_planificacion END,
    responsable_diseño = CASE WHEN lower(trim(responsable_diseño)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_diseño END,
    responsable_revisión = CASE WHEN lower(trim(responsable_revisión)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_revisión END,
    responsable_publicacion = CASE WHEN lower(trim(responsable_publicacion)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_publicacion END
WHERE lower(trim(COALESCE(responsable, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_planificacion, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_diseño, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_revisión, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_publicacion, ''))) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE publicaciones
SET responsable = CASE WHEN lower(trim(responsable)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable END,
    responsable_diseño = CASE WHEN lower(trim(responsable_diseño)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_diseño END,
    responsable_edición = CASE WHEN lower(trim(responsable_edición)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_edición END,
    responsable_revisión = CASE WHEN lower(trim(responsable_revisión)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_revisión END,
    responsable_publicacion = CASE WHEN lower(trim(responsable_publicacion)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE responsable_publicacion END
WHERE lower(trim(COALESCE(responsable, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_diseño, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_edición, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_revisión, ''))) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(COALESCE(responsable_publicacion, ''))) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE tarea_comentarios
SET autor = 'Mariano Meza'
WHERE lower(trim(autor)) IN ('mariano', 'mariano meza', 'mariano mesa');

UPDATE notas_compartidas
SET creado_por = CASE WHEN lower(trim(creado_por)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE creado_por END,
    modificado_por = CASE WHEN lower(trim(modificado_por)) IN ('mariano', 'mariano meza', 'mariano mesa') THEN 'Mariano Meza' ELSE modificado_por END
WHERE lower(trim(creado_por)) IN ('mariano', 'mariano meza', 'mariano mesa')
   OR lower(trim(modificado_por)) IN ('mariano', 'mariano meza', 'mariano mesa');
