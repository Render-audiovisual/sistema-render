-- Prospective invalidation only: preserve 058 rules and existing trigger.
-- No approval/delivery inference or historical row rewriting on installation.
-- A finalized delivery-bound approval covers only its reviewed content; later
-- content edits reopen review. Unbound historical finals keep 058 semantics.
CREATE OR REPLACE FUNCTION invalidar_aprobacion_tarea_modificada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contenido_cambio BOOLEAN;
BEGIN
  contenido_cambio := NEW.aclaraciones IS DISTINCT FROM OLD.aclaraciones
    OR NEW.material_referencia IS DISTINCT FROM OLD.material_referencia
    OR NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo'
    OR (OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL
      AND NEW.propiedades_extra->'guiones' IS DISTINCT FROM OLD.propiedades_extra->'guiones');
  IF contenido_cambio AND (OLD.estado = 'aprobada'
    OR (OLD.estado IN ('finalizada','publicada') AND OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL)) THEN
    NEW.estado := 'en_revision';
  END IF;
  IF (contenido_cambio AND (OLD.estado = 'aprobada' OR OLD.propiedades_extra->'revision_aprobada' = 'true'::jsonb))
    OR (NEW.estado IN ('pendiente','en_progreso','en_revision') AND
      (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.propiedades_extra->'revision_aprobada' IS DISTINCT FROM OLD.propiedades_extra->'revision_aprobada')) THEN
    NEW.propiedades_extra := NEW.propiedades_extra || jsonb_build_object(
      'revision_aprobada', false, 'revision_aprobada_por', NULL,
      'revision_aprobada_por_id', NULL, 'revision_aprobada_at', NULL,
      'revision_aprobada_entrega_id', NULL,
      'finalizada_at', NULL);
  END IF;
  RETURN NEW;
END $$;
