-- Actor-scoped creation correlation only. No backfill or payload storage.
-- Keep list_id without FK so deleting a list cannot erase its creation tombstone.
CREATE TABLE personal_list_create_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT CHECK (actor_user_id>0),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$' AND length(payload_hash)=64),
  list_id BIGINT NOT NULL CHECK (list_id>0),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE INDEX personal_list_create_receipts_list_idx ON personal_list_create_receipts(list_id);
CREATE FUNCTION personal_list_create_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Personal list creation receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER personal_list_create_receipt_immutable BEFORE UPDATE OR DELETE ON personal_list_create_receipts
  FOR EACH ROW EXECUTE FUNCTION personal_list_create_receipt_immutable();
