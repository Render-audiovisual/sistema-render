-- Operational receipts only. No legacy tokens or history are imported.
CREATE TABLE drive_upload_intents (
  id UUID PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  session_version INTEGER NOT NULL CHECK(session_version>0),
  task_id INTEGER REFERENCES tareas(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 1000),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 255),
  size BIGINT NOT NULL CHECK(size>=0 AND size<=9007199254740991),
  parent_id TEXT NOT NULL,
  replace_id TEXT,
  upload_url TEXT,
  state TEXT NOT NULL CHECK(state IN ('starting','ready','in_flight','completed','uncertain')),
  phase_id UUID NOT NULL,
  next_offset BIGINT NOT NULL DEFAULT 0 CHECK(next_offset>=0 AND next_offset<=size),
  last_range TEXT,
  last_chunk_hash TEXT CHECK(last_chunk_hash IS NULL OR (length(last_chunk_hash)=64 AND last_chunk_hash ~ '^[a-f0-9]{64}$')),
  last_status INTEGER CHECK(last_status IN (200,202)),
  last_ack JSONB CHECK(last_ack IS NULL OR jsonb_typeof(last_ack)='object'),
  replacement_state TEXT NOT NULL CHECK(replacement_state IN ('none','pending','in_flight','completed','uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK((last_status IS NULL)=(last_ack IS NULL)),
  CHECK(state<>'completed' OR (last_status=200 AND last_ack IS NOT NULL)),
  CHECK(replace_id IS NOT NULL OR replacement_state='none')
);
CREATE INDEX drive_upload_intents_actor_idx ON drive_upload_intents(actor_id);
CREATE INDEX drive_upload_intents_task_idx ON drive_upload_intents(task_id);
CREATE INDEX drive_upload_intents_expiry_idx ON drive_upload_intents(expires_at);

CREATE TABLE drive_oauth_nonces (
  id UUID PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  session_version INTEGER NOT NULL CHECK(session_version>0),
  purpose TEXT NOT NULL DEFAULT 'google_drive' CHECK(purpose='google_drive'),
  claim_id UUID,
  consumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK((claim_id IS NULL)=(consumed_at IS NULL)),
  CHECK(completed_at IS NULL OR consumed_at IS NOT NULL)
);
CREATE INDEX drive_oauth_nonces_actor_idx ON drive_oauth_nonces(actor_id);
CREATE INDEX drive_oauth_nonces_expiry_idx ON drive_oauth_nonces(expires_at);
