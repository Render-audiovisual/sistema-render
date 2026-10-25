-- Correlate explicit new task attempts; never infer receipts for old tasks.
-- No task FK: deletion retains the evidence and must not permit recreation.
CREATE TABLE task_create_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT CHECK(actor_user_id>0),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  task_id INTEGER NOT NULL CHECK(task_id>0),
  task_revision BIGINT NOT NULL CHECK(task_revision>0),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE INDEX task_create_receipts_task_idx ON task_create_receipts(task_id);
CREATE FUNCTION task_create_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Task creation receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER task_create_receipt_immutable BEFORE UPDATE OR DELETE ON task_create_receipts
  FOR EACH ROW EXECUTE FUNCTION task_create_receipt_immutable();
