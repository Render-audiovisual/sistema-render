-- Additive only: no account creation, inferred owner names or historical rewrites.
-- Existing JWTs deliberately require a new login after this migration + API rollout.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1
  CHECK (session_version >= 1);
