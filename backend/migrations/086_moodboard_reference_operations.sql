-- Add observations/receipts without rewriting existing reference content.
ALTER TABLE moodboard_references ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision>=0);
CREATE FUNCTION moodboard_reference_advance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision+1;
  RETURN NEW;
END $$;
CREATE TRIGGER moodboard_reference_advance_revision BEFORE UPDATE ON moodboard_references
  FOR EACH ROW EXECUTE FUNCTION moodboard_reference_advance_revision();

CREATE UNIQUE INDEX moodboard_categories_id_board_idx ON moodboard_categories(id,board_id);
-- Keep045's simple FK: it still clears historical cross-board category links
-- when their old category is deleted. No validation/backfill of legacy rows.
ALTER TABLE moodboard_references ADD CONSTRAINT moodboard_reference_category_board_fk
  FOREIGN KEY(category_id,board_id) REFERENCES moodboard_categories(id,board_id)
  ON DELETE SET NULL (category_id) NOT VALID;

CREATE TABLE moodboard_reference_operations (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','edit','delete')),
  payload_hash TEXT NOT NULL CHECK(char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  board_id INTEGER NOT NULL REFERENCES moodboard_boards(id) ON DELETE RESTRICT,
  -- No reference FK: deletion must retain replay evidence, never recreate it.
  reference_id INTEGER NOT NULL CHECK(reference_id>0),
  result_revision BIGINT NOT NULL CHECK(result_revision>=0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE INDEX moodboard_reference_operations_board_idx ON moodboard_reference_operations(board_id);
CREATE INDEX moodboard_reference_operations_reference_idx ON moodboard_reference_operations(reference_id);
CREATE FUNCTION moodboard_reference_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='moodboard_reference_operation_immutable',
    MESSAGE='Los recibos de referencias no se pueden modificar ni borrar.';
END $$;
CREATE TRIGGER moodboard_reference_operation_immutable BEFORE UPDATE OR DELETE ON moodboard_reference_operations
  FOR EACH ROW EXECUTE FUNCTION moodboard_reference_operation_immutable();
