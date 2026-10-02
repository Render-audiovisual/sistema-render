-- Identidades adicionales de una cuenta compartida. Los permisos provienen
-- siempre de usuarios.rol, nunca del nombre del remitente.
CREATE TABLE IF NOT EXISTS mia_whatsapp_identities (
  actor_hash CHAR(64) PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name)
SELECT identity.hash,u.id,identity.key,identity.name
FROM (VALUES
  ('778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2','lider_agustin','Agustín'),
  ('6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a','lider_franco','Franco socio')
) AS identity(hash,key,name)
JOIN usuarios u ON lower(u.usuario)='lider' AND u.rol IN ('admin','lider')
ON CONFLICT(actor_hash) DO NOTHING;

CREATE TABLE IF NOT EXISTS mia_supervisor_proposals (
  id UUID PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  razon TEXT NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pending' CHECK (estado IN ('pending','accepted','superseded')),
  accepted_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mia_supervisor_proposal_open
  ON mia_supervisor_proposals(tarea_id) WHERE estado='pending';

CREATE TABLE IF NOT EXISTS mia_supervisor_followups (
  id BIGSERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cycle_key CHAR(64) NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('missing_date','overdue')),
  due_date DATE,
  estado TEXT NOT NULL DEFAULT 'waiting' CHECK (estado IN ('waiting','answered','escalated','closed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  last_delivered_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tarea_id,usuario_id,cycle_key)
);
CREATE INDEX IF NOT EXISTS idx_mia_supervisor_followups_waiting
  ON mia_supervisor_followups(next_attempt_at) WHERE estado='waiting';

ALTER TABLE mia_private_task_notifications
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supervisor_followup_id BIGINT REFERENCES mia_supervisor_followups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supervisor_attempt INTEGER CHECK (supervisor_attempt BETWEEN 1 AND 3);
CREATE INDEX IF NOT EXISTS idx_mia_supervisor_notifications_followup
  ON mia_private_task_notifications(supervisor_followup_id,supervisor_attempt);

CREATE TABLE IF NOT EXISTS mia_supervisor_replies (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  actor_hash CHAR(64) NOT NULL,
  message_id TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  contenido TEXT NOT NULL,
  reporte JSONB NOT NULL,
  resultado JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_hash,message_id)
);
CREATE TABLE IF NOT EXISTS mia_supervisor_signals (
  fingerprint CHAR(64) PRIMARY KEY,
  tipo TEXT NOT NULL,
  tarea_ids INTEGER[] NOT NULL,
  detalles JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  generation INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
