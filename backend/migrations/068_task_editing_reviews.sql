-- Prospective decisions only; never infer approvals or rewrite delivery history.
-- The composite reference binds each decision to its exact task and delivery.
ALTER TABLE task_editing_deliveries
  ADD CONSTRAINT task_editing_deliveries_task_id_unique UNIQUE (task_id,id);

CREATE TABLE task_editing_reviews (
  id UUID CONSTRAINT task_editing_reviews_pk PRIMARY KEY,
  task_id INTEGER NOT NULL CONSTRAINT task_editing_reviews_task_fk REFERENCES tareas(id) ON DELETE RESTRICT,
  delivery_id UUID NOT NULL,
  actor_id INTEGER NOT NULL CONSTRAINT task_editing_reviews_actor_fk REFERENCES usuarios(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  task_revision INTEGER NOT NULL,
  notes TEXT NOT NULL,
  request_id UUID,
  payload_hash TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task_editing_reviews_delivery_fk FOREIGN KEY (task_id,delivery_id)
    REFERENCES task_editing_deliveries(task_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT task_editing_reviews_task_positive CHECK (task_id > 0),
  CONSTRAINT task_editing_reviews_actor_positive CHECK (actor_id > 0),
  CONSTRAINT task_editing_reviews_revision_positive CHECK (task_revision > 0),
  CONSTRAINT task_editing_reviews_action CHECK (action IN ('aprobada','correcciones')),
  -- PostgreSQL TEXT rejects NUL before constraints; the API rejects it as input.
  CONSTRAINT task_editing_reviews_notes CHECK (
    char_length(notes) <= 4000 AND (
      (action='aprobada' AND notes='') OR
      (action='correcciones' AND char_length(notes) > 0 AND notes=btrim(notes)
        AND notes !~ '^[[:space:]]|[[:space:]]$')
    )
  ),
  -- Explicit null branches avoid SQL CHECK's unknown/null acceptance loophole.
  CONSTRAINT task_editing_reviews_request_pair CHECK (
    (action='aprobada' AND request_id IS NULL AND payload_hash IS NULL) OR
    (action='correcciones' AND request_id IS NOT NULL AND payload_hash IS NOT NULL)
  ),
  CONSTRAINT task_editing_reviews_hash CHECK (
    payload_hash IS NULL OR
    (char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT task_editing_reviews_request_unique UNIQUE (actor_id,request_id),
  CONSTRAINT task_editing_reviews_task_revision_unique UNIQUE (task_id,task_revision)
);

CREATE INDEX task_editing_reviews_history_idx ON task_editing_reviews(task_id,task_revision DESC,id DESC);

CREATE FUNCTION task_editing_reviews_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='task_editing_reviews_immutable',
    MESSAGE='El historial de revisiones de edición es inmutable.';
END $$;
CREATE TRIGGER task_editing_reviews_immutable BEFORE UPDATE OR DELETE ON task_editing_reviews
  FOR EACH ROW EXECUTE FUNCTION task_editing_reviews_reject_mutation();
