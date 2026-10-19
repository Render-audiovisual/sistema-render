-- Expand accepted work states; never rewrite historical rows or publication dates.
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS tareas_estado_check;
ALTER TABLE tareas ADD CONSTRAINT tareas_estado_check CHECK
  (estado IN ('pendiente','en_progreso','en_revision','aprobada','finalizada','programada','publicada'));

-- Shared write boundary: approval covers the reviewed material, not future edits.
-- Runs only on a subsequent write; installation never rewrites historical rows.
CREATE OR REPLACE FUNCTION invalidar_aprobacion_tarea_modificada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contenido_cambio BOOLEAN;
BEGIN
  contenido_cambio := NEW.aclaraciones IS DISTINCT FROM OLD.aclaraciones
    OR NEW.material_referencia IS DISTINCT FROM OLD.material_referencia
    OR NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo';
  IF contenido_cambio AND OLD.estado = 'aprobada' THEN
    NEW.estado := 'en_revision';
  END IF;
  IF (contenido_cambio AND (OLD.estado = 'aprobada' OR OLD.propiedades_extra->'revision_aprobada' = 'true'::jsonb))
    OR (NEW.estado IN ('pendiente','en_progreso','en_revision') AND
      (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.propiedades_extra->'revision_aprobada' IS DISTINCT FROM OLD.propiedades_extra->'revision_aprobada')) THEN
    NEW.propiedades_extra := NEW.propiedades_extra || jsonb_build_object(
      'revision_aprobada', false, 'revision_aprobada_por', NULL,
      'revision_aprobada_por_id', NULL, 'revision_aprobada_at', NULL,
      'finalizada_at', NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tareas_invalidar_aprobacion BEFORE UPDATE ON tareas
  FOR EACH ROW EXECUTE FUNCTION invalidar_aprobacion_tarea_modificada();

CREATE OR REPLACE FUNCTION sincronizar_cliente_objetivo_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pieza cliente_objetivo_piezas%ROWTYPE;
BEGIN
  FOR pieza IN SELECT * FROM cliente_objetivo_piezas WHERE tarea_id = NEW.id FOR UPDATE LOOP
    UPDATE cliente_objetivo_piezas SET
      titulo = NEW.titulo,
      copy = CASE WHEN NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo'
        THEN COALESCE(NEW.propiedades_extra->>'copy_trabajo', '') ELSE copy END,
      responsables = (SELECT COALESCE(jsonb_agg(DISTINCT persona), '[]'::jsonb)
        FROM jsonb_array_elements_text(jsonb_build_array(NEW.asignado_a) ||
          CASE WHEN jsonb_typeof(NEW.propiedades_extra->'colaboradores') = 'array'
            THEN NEW.propiedades_extra->'colaboradores' ELSE '[]'::jsonb END) AS people(persona)
        WHERE trim(persona) <> ''),
      estado = NEW.estado,
      completada_at = CASE WHEN NEW.estado IN ('finalizada','publicada')
        THEN COALESCE(pieza.completada_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = pieza.id;
    IF pieza.publicacion_id IS NOT NULL
      AND NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo' THEN
      UPDATE publicaciones SET copy=COALESCE(NEW.propiedades_extra->>'copy_trabajo',''), updated_at=now()
        WHERE id=pieza.publicacion_id;
    END IF;
    IF pieza.estado IS DISTINCT FROM NEW.estado THEN
      INSERT INTO cliente_objetivo_eventos(pieza_id, estado_anterior, estado_nuevo, tarea_id)
        VALUES(pieza.id, pieza.estado, NEW.estado, NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
