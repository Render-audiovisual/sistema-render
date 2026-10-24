-- Creation correlation only: no content copies, backfill or inferred receipts.
-- No task/comment FK: cascading deletion must retain the immutable tombstone.
CREATE TABLE task_comment_create_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT CHECK(actor_user_id>0),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  tarea_id INTEGER NOT NULL CHECK(tarea_id>0),
  comment_id INTEGER NOT NULL CHECK(comment_id>0),
  workspace TEXT NOT NULL CHECK(workspace IN ('render_os','historical')),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE INDEX task_comment_create_receipts_comment_idx ON task_comment_create_receipts(comment_id);
CREATE FUNCTION task_comment_create_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Task comment creation receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER task_comment_create_receipt_immutable BEFORE UPDATE OR DELETE ON task_comment_create_receipts
  FOR EACH ROW EXECUTE FUNCTION task_comment_create_receipt_immutable();
