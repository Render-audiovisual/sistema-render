-- La primera ejecución del ledger recuperó tareas ya existentes usando su
-- updated_at, fecha que había sido tocada en bloque. Reubica exclusivamente
-- ese backfill inicial según la fecha operativa de cada tarea.
UPDATE progreso_edicion_entregas pe SET
  entregada_at = CASE
    WHEN t.propiedades_extra->>'finalizada_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (t.propiedades_extra->>'finalizada_at')::timestamptz
    ELSE t.fecha_vencimiento::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
  END,
  updated_at = NOW()
FROM tareas t
WHERE pe.tarea_id = t.id
  AND pe.created_at < TIMESTAMPTZ '2026-10-05 18:00:00+00'
  AND t.fecha_vencimiento IS NOT NULL
  AND t.fecha_vencimiento <= CURRENT_DATE;
