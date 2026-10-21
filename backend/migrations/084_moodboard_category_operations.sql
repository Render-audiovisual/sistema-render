-- Add observations/receipts only. Existing boards/categories/references keep
-- their IDs, content, order and relationships; there is no inventory backfill.
ALTER TABLE moodboard_boards ADD COLUMN category_revision BIGINT NOT NULL DEFAULT 0
  CHECK (category_revision >= 0);

CREATE TABLE moodboard_category_operations (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  board_id INTEGER NOT NULL REFERENCES moodboard_boards(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL CHECK (char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  result_revision BIGINT NOT NULL CHECK (result_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
CREATE INDEX moodboard_category_operations_board_idx ON moodboard_category_operations(board_id);

CREATE FUNCTION moodboard_category_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='moodboard_category_operation_immutable',
    MESSAGE='Los recibos de categorías no se pueden modificar ni borrar.';
END $$;
CREATE TRIGGER moodboard_category_operation_immutable BEFORE UPDATE OR DELETE ON moodboard_category_operations
  FOR EACH ROW EXECUTE FUNCTION moodboard_category_operation_immutable();

CREATE FUNCTION moodboard_category_advance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE board_ids INTEGER[];
BEGIN
  IF TG_OP='INSERT' THEN board_ids := ARRAY[NEW.board_id];
  ELSIF TG_OP='DELETE' THEN board_ids := ARRAY[OLD.board_id];
  ELSE board_ids := ARRAY[OLD.board_id,NEW.board_id];
  END IF;
  -- API batches and the initializer already own the board observation lock.
  -- Keep cross-board SQL moves ordered too, without rewriting any category.
  PERFORM id FROM moodboard_boards WHERE id=ANY(board_ids) ORDER BY id FOR NO KEY UPDATE;
  UPDATE moodboard_boards SET category_revision=category_revision+1 WHERE id=ANY(board_ids);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moodboard_category_advance_revision AFTER INSERT OR UPDATE OR DELETE ON moodboard_categories
  FOR EACH ROW EXECUTE FUNCTION moodboard_category_advance_revision();
