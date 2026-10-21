-- Shared presentation only. No task UPDATE/backfill, business-state trigger,
-- task FK/cascade, per-person ordering or raw receipt payload snapshots.
CREATE FUNCTION task_board_order_valid_ids(ids INTEGER[]) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN ids IS NULL OR cardinality(ids) > 100000 THEN FALSE
    WHEN cardinality(ids) = 0 THEN TRUE
    ELSE array_ndims(ids) = 1 AND array_lower(ids,1) = 1
      AND NOT EXISTS (SELECT 1 FROM unnest(ids) item WHERE item IS NULL OR item <= 0)
      AND cardinality(ids) = (SELECT count(DISTINCT item) FROM unnest(ids) item)
  END
$$;
CREATE TABLE task_board_order (
  scope TEXT PRIMARY KEY CHECK (scope = 'render_os'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  task_ids INTEGER[] NOT NULL DEFAULT '{}' CHECK (task_board_order_valid_ids(task_ids))
);
INSERT INTO task_board_order(scope) VALUES ('render_os');
CREATE TABLE task_board_order_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  task_id INTEGER NOT NULL CHECK (task_id > 0),
  before_id INTEGER CHECK (before_id > 0 AND before_id <> task_id),
  order_revision BIGINT NOT NULL CHECK (order_revision > 0),
  changed BOOLEAN NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
