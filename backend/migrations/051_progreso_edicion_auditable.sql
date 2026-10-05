-- Progreso operativo de edición. Es independiente de Sueldos y conserva la
-- entrega aunque la tarea finalizada se purgue del tablero.
CREATE TABLE IF NOT EXISTS progreso_edicion_entregas (
  id BIGSERIAL PRIMARY KEY,
  tarea_id BIGINT NOT NULL UNIQUE,
  editor_clave TEXT NOT NULL,
  titulo_snapshot TEXT NOT NULL,
  cliente_id INTEGER,
  estado_actual TEXT NOT NULL CHECK (estado_actual IN ('en_revision', 'publicada')),
  entregada_at TIMESTAMPTZ NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  baja_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progreso_edicion_editor_fecha
  ON progreso_edicion_entregas (editor_clave, entregada_at DESC)
  WHERE activa IS TRUE;

CREATE OR REPLACE FUNCTION registrar_progreso_edicion_tarea()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  editor TEXT;
  cuenta_como_entrega BOOLEAN;
  fecha_entrega TIMESTAMPTZ;
BEGIN
  editor := lower(trim(COALESCE(NEW.propiedades_extra->>'edicion_responsable', NEW.asignado_a, '')));
  cuenta_como_entrega :=
    NEW.propiedades_extra->>'workspace' = 'render_os'
    AND NEW.tipo_tarea = 'edicion'
    AND editor IN ('luciano', 'milton', 'milton luciano')
    AND NEW.estado IN ('en_revision', 'publicada');

  IF cuenta_como_entrega THEN
    fecha_entrega := CASE
      WHEN NEW.propiedades_extra->>'finalizada_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        THEN (NEW.propiedades_extra->>'finalizada_at')::timestamptz
      ELSE COALESCE(NEW.updated_at, NOW())
    END;

    INSERT INTO progreso_edicion_entregas
      (tarea_id, editor_clave, titulo_snapshot, cliente_id, estado_actual, entregada_at, activa, baja_at)
    VALUES
      (NEW.id, 'luciano', NEW.titulo, NEW.cliente_id, NEW.estado, fecha_entrega, TRUE, NULL)
    ON CONFLICT (tarea_id) DO UPDATE SET
      editor_clave = EXCLUDED.editor_clave,
      titulo_snapshot = EXCLUDED.titulo_snapshot,
      cliente_id = EXCLUDED.cliente_id,
      estado_actual = EXCLUDED.estado_actual,
      entregada_at = CASE
        WHEN progreso_edicion_entregas.activa IS FALSE THEN EXCLUDED.entregada_at
        ELSE progreso_edicion_entregas.entregada_at
      END,
      activa = TRUE,
      baja_at = NULL,
      updated_at = NOW();
  ELSE
    UPDATE progreso_edicion_entregas SET
      activa = FALSE,
      baja_at = COALESCE(baja_at, NOW()),
      updated_at = NOW()
    WHERE tarea_id = NEW.id AND activa IS TRUE;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS progreso_edicion_tarea_cambio ON tareas;
CREATE TRIGGER progreso_edicion_tarea_cambio
AFTER INSERT OR UPDATE OF estado, asignado_a, tipo_tarea, propiedades_extra ON tareas
FOR EACH ROW EXECUTE FUNCTION registrar_progreso_edicion_tarea();

-- Backfill verificable: sólo tareas reales que todavía existen y ya fueron
-- entregadas. Nunca se inventa una cantidad histórica.
INSERT INTO progreso_edicion_entregas
  (tarea_id, editor_clave, titulo_snapshot, cliente_id, estado_actual, entregada_at)
SELECT
  t.id,
  'luciano',
  t.titulo,
  t.cliente_id,
  t.estado,
  CASE
    WHEN t.propiedades_extra->>'finalizada_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (t.propiedades_extra->>'finalizada_at')::timestamptz
    ELSE t.updated_at
  END
FROM tareas t
WHERE t.propiedades_extra->>'workspace' = 'render_os'
  AND t.tipo_tarea = 'edicion'
  AND lower(trim(COALESCE(t.propiedades_extra->>'edicion_responsable', t.asignado_a, '')))
      IN ('luciano', 'milton', 'milton luciano')
  AND t.estado IN ('en_revision', 'publicada')
ON CONFLICT (tarea_id) DO NOTHING;

-- Revierte el lote de 67 filas creado desde una cifra conversada, sin tocar
-- las entregas salariales que tengan otra procedencia.
DELETE FROM entregas_edicion
WHERE fuente = 'whatsapp-franco-2026-10-05-septiembre';
