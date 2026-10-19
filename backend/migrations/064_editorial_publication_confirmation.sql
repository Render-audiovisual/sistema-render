-- Forward-only evidence. No existing editorial columns or historical rows are
-- changed; missing version rows mean revision zero until the next piece UPDATE.
CREATE TABLE editorial_publicacion_versiones (
  dominio TEXT NOT NULL,
  pieza_id INTEGER NOT NULL,
  historia_id INTEGER CONSTRAINT editorial_publicacion_version_historia_fk REFERENCES historias(id) ON DELETE CASCADE,
  publicacion_id INTEGER CONSTRAINT editorial_publicacion_version_publicacion_fk REFERENCES publicaciones(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL CONSTRAINT editorial_publicacion_version_revision CHECK (revision >= 1),
  current_event_id UUID,
  CONSTRAINT editorial_publicacion_version_pk PRIMARY KEY (dominio,pieza_id),
  CONSTRAINT editorial_publicacion_version_tuple CHECK (
    pieza_id > 0 AND ((dominio='historia' AND historia_id IS NOT NULL AND historia_id=pieza_id AND publicacion_id IS NULL)
      OR (dominio='publicacion' AND publicacion_id IS NOT NULL AND publicacion_id=pieza_id AND historia_id IS NULL))
  )
);
CREATE INDEX editorial_publicacion_version_historia_idx ON editorial_publicacion_versiones(historia_id);
CREATE INDEX editorial_publicacion_version_publicacion_idx ON editorial_publicacion_versiones(publicacion_id);

CREATE TABLE editorial_publicacion_eventos (
  id UUID CONSTRAINT editorial_publicacion_evento_pk PRIMARY KEY,
  dominio TEXT NOT NULL,
  pieza_id INTEGER NOT NULL,
  historia_id INTEGER CONSTRAINT editorial_publicacion_evento_historia_fk REFERENCES historias(id) ON DELETE RESTRICT,
  publicacion_id INTEGER CONSTRAINT editorial_publicacion_evento_publicacion_fk REFERENCES publicaciones(id) ON DELETE RESTRICT,
  cliente_id INTEGER NOT NULL CONSTRAINT editorial_publicacion_evento_cliente_fk REFERENCES clientes(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL CONSTRAINT editorial_publicacion_evento_actor_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CONSTRAINT editorial_publicacion_evento_action CHECK (action IN ('confirmar','retirar')),
  source TEXT NOT NULL CONSTRAINT editorial_publicacion_evento_source CHECK (source='manual'),
  request_id UUID NOT NULL,
  intent_hash TEXT NOT NULL CONSTRAINT editorial_publicacion_evento_hash CHECK (length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'),
  expected_revision BIGINT NOT NULL CONSTRAINT editorial_publicacion_evento_revision CHECK (expected_revision >= 0),
  occurred_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  previous_event_id UUID,
  CONSTRAINT editorial_publicacion_evento_tuple CHECK (
    pieza_id > 0 AND ((dominio='historia' AND historia_id IS NOT NULL AND historia_id=pieza_id AND publicacion_id IS NULL)
      OR (dominio='publicacion' AND publicacion_id IS NOT NULL AND publicacion_id=pieza_id AND historia_id IS NULL))
  ),
  CONSTRAINT editorial_publicacion_evento_occurred CHECK (
    (action='confirmar' AND occurred_at IS NOT NULL) OR (action='retirar' AND occurred_at IS NULL)
  ),
  CONSTRAINT editorial_publicacion_evento_request_unique UNIQUE (actor_id,request_id),
  CONSTRAINT editorial_publicacion_evento_tuple_unique UNIQUE (id,dominio,pieza_id),
  CONSTRAINT editorial_publicacion_evento_previous_fk FOREIGN KEY (previous_event_id,dominio,pieza_id)
    REFERENCES editorial_publicacion_eventos(id,dominio,pieza_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT editorial_publicacion_evento_not_self CHECK (previous_event_id IS NULL OR previous_event_id<>id)
);
CREATE INDEX editorial_publicacion_evento_historia_idx ON editorial_publicacion_eventos(historia_id);
CREATE INDEX editorial_publicacion_evento_publicacion_idx ON editorial_publicacion_eventos(publicacion_id);
CREATE INDEX editorial_publicacion_evento_cliente_idx ON editorial_publicacion_eventos(cliente_id);
CREATE INDEX editorial_publicacion_evento_piece_idx ON editorial_publicacion_eventos(dominio,pieza_id,recorded_at,id);
CREATE INDEX editorial_publicacion_evento_previous_idx ON editorial_publicacion_eventos(previous_event_id,dominio,pieza_id);

ALTER TABLE editorial_publicacion_versiones ADD CONSTRAINT editorial_publicacion_version_current_fk
  FOREIGN KEY (current_event_id,dominio,pieza_id) REFERENCES editorial_publicacion_eventos(id,dominio,pieza_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX editorial_publicacion_version_current_idx ON editorial_publicacion_versiones(current_event_id,dominio,pieza_id);

CREATE FUNCTION editorial_publicacion_immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_publicacion_evento_immutable',
    MESSAGE='El historial de confirmación editorial es inmutable.';
END $$;
CREATE TRIGGER editorial_publicacion_evento_immutable BEFORE UPDATE OR DELETE ON editorial_publicacion_eventos
  FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_immutable_event();

-- Service already holds piece -> version. Read the piece without acquiring any
-- reverse row lock here; ordinary updates follow the same piece-first order.
CREATE FUNCTION editorial_publicacion_guard_current() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_row editorial_publicacion_eventos%ROWTYPE; piece_row RECORD;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.dominio,NEW.pieza_id,NEW.historia_id,NEW.publicacion_id) IS DISTINCT FROM
      ROW(OLD.dominio,OLD.pieza_id,OLD.historia_id,OLD.publicacion_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_publicacion_version_identity',
        MESSAGE='La identidad de la versión editorial no se puede reemplazar.';
    END IF;
    -- Preserve a confirmation through unrelated future copy/planning updates.
    IF NEW.current_event_id IS NOT DISTINCT FROM OLD.current_event_id THEN RETURN NEW; END IF;
  END IF;
  IF NEW.current_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO event_row FROM editorial_publicacion_eventos WHERE id=NEW.current_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_publicacion_current_event',
      MESSAGE='La confirmación editorial vigente no es válida.';
  END IF;
  IF NEW.dominio='historia' THEN
    SELECT cliente_id,estado,fecha_publicación_real AS actual_at,metadata->>'archivado_tablero' AS archived
      INTO piece_row FROM historias WHERE id=NEW.pieza_id;
  ELSE
    SELECT cliente_id,estado,fecha_publicación_real AS actual_at,metadata->>'archivado_tablero' AS archived
      INTO piece_row FROM publicaciones WHERE id=NEW.pieza_id;
  END IF;
  IF NOT FOUND OR event_row.action<>'confirmar' OR event_row.source<>'manual'
    OR event_row.dominio IS DISTINCT FROM NEW.dominio OR event_row.pieza_id IS DISTINCT FROM NEW.pieza_id
    OR event_row.cliente_id IS DISTINCT FROM piece_row.cliente_id
    OR piece_row.estado IS DISTINCT FROM 'publicada' OR piece_row.actual_at IS DISTINCT FROM event_row.occurred_at
    OR piece_row.archived='true' OR NEW.revision<>event_row.expected_revision+1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_publicacion_current_matches_piece',
      MESSAGE='La evidencia debe corresponder a la publicación y revisión actuales.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER editorial_publicacion_version_current_guard BEFORE INSERT OR UPDATE ON editorial_publicacion_versiones
  FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_guard_current();

-- Piece -> version only. This function never updates a piece, creates evidence,
-- or touches task/goal/advisory locks. Type is publication-only in the old schema.
CREATE FUNCTION editorial_publicacion_piece_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE piece_domain TEXT; type_changed BOOLEAN := false; invalidate BOOLEAN;
BEGIN
  piece_domain := CASE WHEN TG_TABLE_NAME='historias' THEN 'historia' ELSE 'publicacion' END;
  IF TG_TABLE_NAME='publicaciones' THEN type_changed := NEW.tipo IS DISTINCT FROM OLD.tipo; END IF;
  invalidate := type_changed OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
    OR NEW.estado IS DISTINCT FROM OLD.estado
    OR NEW.fecha_publicación_real IS DISTINCT FROM OLD.fecha_publicación_real
    OR NEW.metadata->'archivado_tablero' IS DISTINCT FROM OLD.metadata->'archivado_tablero';
  INSERT INTO editorial_publicacion_versiones(dominio,pieza_id,historia_id,publicacion_id,revision,current_event_id)
    VALUES(piece_domain,NEW.id,CASE WHEN piece_domain='historia' THEN NEW.id ELSE NULL END,
      CASE WHEN piece_domain='publicacion' THEN NEW.id ELSE NULL END,1,NULL)
  ON CONFLICT (dominio,pieza_id) DO UPDATE SET revision=editorial_publicacion_versiones.revision+1,
    current_event_id=CASE WHEN invalidate THEN NULL ELSE editorial_publicacion_versiones.current_event_id END;
  RETURN NEW;
END $$;
CREATE TRIGGER editorial_publicacion_historia_version AFTER UPDATE ON historias
  FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_piece_version();
CREATE TRIGGER editorial_publicacion_publicacion_version AFTER UPDATE ON publicaciones
  FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_piece_version();
