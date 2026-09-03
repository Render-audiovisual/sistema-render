WITH avance_visitas AS (
  SELECT
    t.id,
    (t.propiedades_extra->>'produccion_videos_previstos')::integer AS previstos,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN registro->>'cantidad' ~ '^[0-9]+$' THEN (registro->>'cantidad')::integer
          ELSE 0
        END
      )
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(t.propiedades_extra->'produccion_registros') = 'array'
            THEN t.propiedades_extra->'produccion_registros'
          ELSE '[]'::jsonb
        END
      ) AS registro
    ), 0) AS grabados
  FROM tareas AS t
  WHERE t.propiedades_extra->>'workspace' = 'render_os'
    AND t.tipo_tarea = 'produccion'
    AND LOWER(COALESCE(t.titulo, '') || ' ' || COALESCE(t.subtipo, '')) LIKE '%visita%'
    AND t.propiedades_extra->>'produccion_videos_previstos' ~ '^[1-9][0-9]*$'
    AND t.propiedades_extra->>'produccion_confirmada_at' IS NULL
    AND t.estado IN ('pendiente', 'en_progreso')
)
UPDATE tareas AS t
SET estado = 'en_revision', updated_at = NOW()
FROM avance_visitas AS avance
WHERE t.id = avance.id
  AND avance.grabados >= avance.previstos;
