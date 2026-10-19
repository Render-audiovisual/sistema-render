-- Forward-only definition replacement: no historical rows or dates are changed.
-- Task completion/reopening tracks delivery, never actual editorial publication.
-- Keep the existing trigger attached and preserve goal and copy synchronization.
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
      completada_at = CASE WHEN NEW.estado = 'publicada'
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
