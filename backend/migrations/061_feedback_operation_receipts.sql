-- Durable mutation receipts, independent of editable/deletable note metadata.
-- No historical JSON keys are promoted; no content, tokens or snapshots stored.
-- Application inserts once in the mutation/audit/confirmation transaction and
-- never updates/deletes receipts. Retention review is a rollout gate; no expiry
-- or automatic cleanup is installed here.
CREATE TABLE feedback_operation_receipts (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  -- Deliberately no note FK: archive/purge must not erase replay evidence or
  -- prevent note deletion. This immutable ID remains after the note is gone.
  note_id BIGINT NOT NULL,
  note_updated_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_receipts_actor_positive CHECK (actor_user_id > 0),
  CONSTRAINT feedback_receipts_operation CHECK (
    operation IN ('crear_feedback', 'editar_feedback')
  ),
  CONSTRAINT feedback_receipts_key_length CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key = btrim(idempotency_key)
  ),
  CONSTRAINT feedback_receipts_payload_hash CHECK (
    char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT feedback_receipts_note_positive CHECK (note_id > 0),
  CONSTRAINT feedback_receipts_actor_operation_key_unique
    UNIQUE (actor_user_id, operation, idempotency_key)
);

-- Version every future note update at browser ISO millisecond precision.
-- Installation does not touch existing notes. Ignore caller timestamps so all
-- writers, including archive/restore, advance the same CAS token strictly.
CREATE FUNCTION feedback_notes_monotonic_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = GREATEST(
    date_trunc('milliseconds', clock_timestamp()),
    date_trunc('milliseconds', OLD.updated_at) + interval '1 millisecond'
  );
  RETURN NEW;
END $$;

CREATE TRIGGER feedback_notes_monotonic_version
  BEFORE UPDATE ON notas_compartidas
  FOR EACH ROW EXECUTE FUNCTION feedback_notes_monotonic_version();
