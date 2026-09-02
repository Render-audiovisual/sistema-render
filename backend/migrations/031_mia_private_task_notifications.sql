CREATE TABLE IF NOT EXISTS mia_private_task_notifications (
  id BIGSERIAL PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  destinatario TEXT NOT NULL,
  destinatario_clave TEXT NOT NULL,
  tarea_id BIGINT NOT NULL,
  motivo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  tarea_url TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pending'
    CHECK (estado IN ('pending', 'sending', 'delivered')),
  intentos INTEGER NOT NULL DEFAULT 0,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mia_private_task_notifications_pending
  ON mia_private_task_notifications (estado, created_at)
  WHERE estado <> 'delivered';

CREATE INDEX IF NOT EXISTS idx_mia_private_task_notifications_recipient
  ON mia_private_task_notifications (destinatario_clave, created_at DESC);
