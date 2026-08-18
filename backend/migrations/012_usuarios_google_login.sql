ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS google_id TEXT,
ADD COLUMN IF NOT EXISTS google_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_google_id
ON usuarios (google_id)
WHERE google_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_google_email_lower
ON usuarios (lower(google_email))
WHERE google_email IS NOT NULL;
