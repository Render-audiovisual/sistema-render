-- Depend on the established global millisecond CAS trigger from061. Never
-- repair it here or rewrite historical note timestamps to manufacture versions.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND c.relname='notas_compartidas'
      AND t.tgname='feedback_notes_monotonic_version' AND NOT t.tgisinternal
      AND t.tgenabled IN ('O','A') AND t.tgtype=19 AND t.tgnargs=0
      AND pn.nspname='public' AND p.proname='feedback_notes_monotonic_version'
  ) THEN RAISE EXCEPTION 'Required061 feedback version trigger is missing or disabled'; END IF;
END $$;

CREATE TABLE feedback_browser_operations (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','edit','trash','restore','purge')),
  payload_hash TEXT NOT NULL CHECK (char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  -- Deliberately no note FK: purge cannot erase a receipt or recreate its note.
  note_id BIGINT NOT NULL CHECK (note_id>0),
  note_updated_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
CREATE INDEX feedback_browser_operations_note_idx ON feedback_browser_operations(note_id);

CREATE FUNCTION feedback_browser_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='feedback_browser_operation_immutable',
    MESSAGE='Los recibos de feedback no se pueden modificar ni borrar.';
END $$;
CREATE TRIGGER feedback_browser_operation_immutable BEFORE UPDATE OR DELETE ON feedback_browser_operations
  FOR EACH ROW EXECUTE FUNCTION feedback_browser_operation_immutable();
