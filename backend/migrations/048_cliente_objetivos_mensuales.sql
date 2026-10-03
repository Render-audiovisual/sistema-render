-- Seguimiento operativo, sin importes. No modifica objetivos ni tareas anteriores.
CREATE TABLE cliente_objetivos_mensuales (
  id SERIAL PRIMARY KEY,
  clave TEXT NOT NULL,
  periodo DATE NOT NULL CHECK (EXTRACT(DAY FROM periodo) = 1),
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  cuentas JSONB NOT NULL DEFAULT '[]',
  reels INTEGER NOT NULL CHECK (reels BETWEEN 0 AND 100),
  carruseles INTEGER NOT NULL CHECK (carruseles BETWEEN 0 AND 100),
  preparado_por TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clave, periodo)
);

CREATE TABLE cliente_objetivo_piezas (
  id SERIAL PRIMARY KEY,
  objetivo_id INTEGER NOT NULL REFERENCES cliente_objetivos_mensuales(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('video','carrusel')),
  numero INTEGER NOT NULL CHECK (numero > 0),
  tarea_id INTEGER UNIQUE REFERENCES tareas(id) ON DELETE SET NULL,
  publicacion_id INTEGER UNIQUE REFERENCES publicaciones(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  copy TEXT NOT NULL DEFAULT '',
  responsables JSONB NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'pendiente',
  completada_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(objetivo_id, tipo, numero)
);

CREATE TABLE cliente_objetivo_eventos (
  id BIGSERIAL PRIMARY KEY,
  pieza_id INTEGER NOT NULL REFERENCES cliente_objetivo_piezas(id),
  estado_anterior TEXT NOT NULL,
  estado_nuevo TEXT NOT NULL,
  tarea_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Se ejecuta dentro de la misma transacción que actualiza la tarea, incluso
-- si el cambio llega por Mía. Una subtarea no puede completar otra casilla.
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
    IF pieza.publicacion_id IS NOT NULL AND NEW.estado IS DISTINCT FROM pieza.estado
      AND (NEW.estado = 'publicada' OR pieza.estado = 'publicada') THEN
      UPDATE publicaciones SET
        estado = CASE WHEN NEW.estado = 'publicada' THEN 'publicada' ELSE 'pendiente' END,
        fecha_publicación_real = CASE WHEN NEW.estado = 'publicada'
          THEN COALESCE(fecha_publicación_real, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = pieza.publicacion_id;
    END IF;
    IF pieza.estado IS DISTINCT FROM NEW.estado THEN
      INSERT INTO cliente_objetivo_eventos(pieza_id, estado_anterior, estado_nuevo, tarea_id)
        VALUES(pieza.id, pieza.estado, NEW.estado, NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER cliente_objetivo_tarea_cambio AFTER UPDATE OF estado, titulo, asignado_a, propiedades_extra ON tareas
  FOR EACH ROW EXECUTE FUNCTION sincronizar_cliente_objetivo_tarea();

-- Título/copy siguen visibles después de la limpieza definitiva de tareas.
-- Al eliminar la tarea sólo se pierde el enlace, no el resultado registrado.
CREATE OR REPLACE FUNCTION sincronizar_cliente_objetivo_publicacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cliente_objetivo_piezas SET copy = COALESCE(NEW.copy, ''), updated_at = now()
    WHERE publicacion_id = NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER cliente_objetivo_publicacion_cambio AFTER UPDATE OF copy ON publicaciones
  FOR EACH ROW EXECUTE FUNCTION sincronizar_cliente_objetivo_publicacion();
