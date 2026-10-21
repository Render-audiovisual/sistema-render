-- Actor-scoped creation receipts only. No historical payloads, identity/role
-- snapshots, backfill or automatic retention deletion.
CREATE TABLE production_create_receipts (
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  visit_id UUID NOT NULL REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, request_id),
  CHECK (actor_user_id > 0)
);
CREATE INDEX production_create_receipts_visit_idx ON production_create_receipts(visit_id);
