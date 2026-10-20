-- Explicit reviewed reconciliation only: no automatic conversion or backfill.
-- First implementation accepts historical sources without legacy editing children;
-- that eligibility and same-visit membership are validated by the backend transaction.
-- Application inserts once and never updates/deletes these receipts or mappings.
-- Fingerprints only: never snapshot source metadata or sensitive content here.
CREATE TABLE produccion_reconciliaciones (
  id UUID PRIMARY KEY,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  tarea_origen_id INTEGER NOT NULL UNIQUE REFERENCES tareas(id) ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL,
  source_history_hash CHAR(64) NOT NULL,
  visita_id UUID NOT NULL UNIQUE REFERENCES produccion_visitas(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT produccion_reconciliaciones_payload_hash_hex
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT produccion_reconciliaciones_source_revision_positive
    CHECK (source_revision > 0),
  CONSTRAINT produccion_reconciliaciones_source_history_hash_hex
    CHECK (source_history_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT produccion_reconciliaciones_actor_request_unique
    UNIQUE (actor_user_id, request_id)
);

CREATE TABLE produccion_reconciliacion_videos (
  reconciliacion_id UUID NOT NULL REFERENCES produccion_reconciliaciones(id) ON DELETE RESTRICT,
  video_id UUID NOT NULL UNIQUE REFERENCES produccion_videos(id) ON DELETE RESTRICT,
  ordinal SMALLINT NOT NULL,
  PRIMARY KEY (reconciliacion_id, video_id),
  CONSTRAINT produccion_reconciliacion_videos_ordinal_range
    CHECK (ordinal BETWEEN 1 AND 50),
  CONSTRAINT produccion_reconciliacion_videos_ordinal_unique
    UNIQUE (reconciliacion_id, ordinal)
);
