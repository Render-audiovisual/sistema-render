ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS email_notificaciones TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_notificaciones_lower
ON usuarios (lower(email_notificaciones))
WHERE email_notificaciones IS NOT NULL;
