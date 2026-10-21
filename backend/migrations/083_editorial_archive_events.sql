-- Explicit reversible visibility operations only. No historical flags, pieces,
-- task states, publication evidence or objective slots are backfilled/changed.
CREATE TABLE editorial_archive_events (
  id UUID PRIMARY KEY,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  dominio TEXT NOT NULL,
  pieza_id INTEGER NOT NULL CHECK (pieza_id > 0),
  historia_id INTEGER CONSTRAINT editorial_archive_historia_fk REFERENCES historias(id) ON DELETE RESTRICT,
  publicacion_id INTEGER CONSTRAINT editorial_archive_publicacion_fk REFERENCES publicaciones(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('archivar','restaurar')),
  expected_revision BIGINT NOT NULL CHECK (expected_revision >= 0),
  result_revision BIGINT NOT NULL CHECK (result_revision > expected_revision),
  motivo TEXT NOT NULL DEFAULT '' CHECK (char_length(motivo) <= 1000),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_user_id,request_id),
  CHECK (actor_user_id > 0),
  CONSTRAINT editorial_archive_identity CHECK (
    (dominio='historia' AND historia_id=pieza_id AND historia_id IS NOT NULL AND publicacion_id IS NULL)
    OR (dominio='publicacion' AND publicacion_id=pieza_id AND publicacion_id IS NOT NULL AND historia_id IS NULL)
  )
);
CREATE INDEX editorial_archive_events_piece_idx ON editorial_archive_events(dominio,pieza_id,recorded_at,id);
CREATE INDEX editorial_archive_events_historia_idx ON editorial_archive_events(historia_id);
CREATE INDEX editorial_archive_events_publicacion_idx ON editorial_archive_events(publicacion_id);
CREATE FUNCTION editorial_archive_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_archive_event_immutable',
    MESSAGE='El historial de archivo editorial es inmutable.';
END $$;
CREATE TRIGGER editorial_archive_event_immutable BEFORE UPDATE OR DELETE ON editorial_archive_events
  FOR EACH ROW EXECUTE FUNCTION editorial_archive_event_immutable();
