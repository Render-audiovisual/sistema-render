-- Forward-only creation receipts. No historical rows or assignments are mapped.
CREATE TABLE editorial_create_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  dominio TEXT NOT NULL CHECK (dominio IN ('historia','publicacion')),
  -- Tombstone identities deliberately have no business FK, as in task receipts.
  -- A legitimate later deletion must not remove this proof or allow recreation.
  pieza_id INTEGER NOT NULL CHECK (pieza_id > 0),
  tarea_id INTEGER NOT NULL CHECK (tarea_id > 0),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_user_id,request_id),
  CHECK (actor_user_id > 0)
);
CREATE INDEX editorial_create_receipts_piece_idx ON editorial_create_receipts(dominio,pieza_id);
CREATE INDEX editorial_create_receipts_task_idx ON editorial_create_receipts(tarea_id);

CREATE FUNCTION editorial_create_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='editorial_create_receipt_immutable',
    MESSAGE='El recibo de creación editorial es inmutable.';
END $$;
CREATE TRIGGER editorial_create_receipt_immutable BEFORE UPDATE OR DELETE ON editorial_create_receipts
  FOR EACH ROW EXECUTE FUNCTION editorial_create_receipt_immutable();
