-- Durable creation identity, not a copy of project content. Retain tombstones.
CREATE TABLE project_child_create_receipts (
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT CHECK(actor_id>0),
  request_id UUID NOT NULL,
  proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE RESTRICT,
  recurso_tipo TEXT NOT NULL CHECK(recurso_tipo IN ('etapas','hitos','entregables')),
  recurso_id UUID NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>0),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_id)
);
CREATE INDEX project_child_create_receipts_project_idx ON project_child_create_receipts(proyecto_id);
CREATE FUNCTION project_child_create_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Project child creation receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER project_child_create_receipt_immutable BEFORE UPDATE OR DELETE ON project_child_create_receipts
  FOR EACH ROW EXECUTE FUNCTION project_child_create_receipt_immutable();
