-- Prospective, explicit editing-delivery history only. No inference/backfill
-- from task state, files, comments, metadata or existing raw material links.
CREATE TABLE task_editing_deliveries (
  id UUID CONSTRAINT task_editing_deliveries_pk PRIMARY KEY,
  task_id INTEGER NOT NULL CONSTRAINT task_editing_deliveries_task_fk REFERENCES tareas(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL CONSTRAINT task_editing_deliveries_actor_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  task_revision INTEGER NOT NULL,
  url TEXT NOT NULL,
  notes TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task_editing_deliveries_task_positive CHECK (task_id > 0),
  CONSTRAINT task_editing_deliveries_actor_positive CHECK (actor_id > 0),
  CONSTRAINT task_editing_deliveries_revision_positive CHECK (task_revision > 0),
  CONSTRAINT task_editing_deliveries_hash CHECK (
    char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'
  ),
  -- Lexical HTTP(S)/authority boundary. The API additionally parses and
  -- canonicalizes URLs, rejecting credentials and malformed URL components.
  CONSTRAINT task_editing_deliveries_url CHECK (
    char_length(url) BETWEEN 1 AND 2000 AND url=btrim(url)
    AND url !~ '[[:cntrl:]]'
    AND url ~ '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$'
  ),
  -- PostgreSQL TEXT itself rejects NUL; API rejects it before SQL too.
  CONSTRAINT task_editing_deliveries_notes CHECK (char_length(notes) <= 4000),
  CONSTRAINT task_editing_deliveries_request_unique UNIQUE (actor_id,request_id)
);
CREATE INDEX task_editing_deliveries_history_idx ON task_editing_deliveries(task_id,recorded_at,id);

CREATE FUNCTION task_editing_deliveries_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='task_editing_deliveries_immutable',
    MESSAGE='El historial de entregas de edición es inmutable.';
END $$;
CREATE TRIGGER task_editing_deliveries_immutable BEFORE UPDATE OR DELETE ON task_editing_deliveries
  FOR EACH ROW EXECUTE FUNCTION task_editing_deliveries_reject_mutation();
