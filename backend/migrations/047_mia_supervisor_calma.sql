-- No tasks or historical receipts are removed. Old-format notices are recoverably cancelled.
ALTER TABLE mia_private_task_notifications ADD COLUMN IF NOT EXISTS batch_parent_id BIGINT REFERENCES mia_private_task_notifications(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mia_notifications_batch ON mia_private_task_notifications(batch_parent_id);
CREATE TABLE IF NOT EXISTS mia_supervisor_conversations (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  last_inbound_at TIMESTAMPTZ NOT NULL,
  report JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY(usuario_id,tarea_id)
);
CREATE TABLE IF NOT EXISTS mia_private_contact_limits (
  actor_hash CHAR(64) PRIMARY KEY,
  last_delivered_at TIMESTAMPTZ,
  supervisor_window TEXT
);
CREATE TABLE IF NOT EXISTS mia_supervisor_inbound (
  actor_hash CHAR(64) PRIMARY KEY,
  last_inbound_at TIMESTAMPTZ NOT NULL,
  message_id TEXT NOT NULL
);
UPDATE mia_private_task_notifications SET cancelled_at=NOW()
WHERE detalles->>'supervisor'='true' AND detalles->>'message_version' IS DISTINCT FROM '2'
  AND estado<>'delivered' AND cancelled_at IS NULL;
-- Seed recipient cooldown and work-window quota from actual receipts already delivered.
INSERT INTO mia_private_contact_limits(actor_hash,last_delivered_at,supervisor_window)
SELECT COALESCE(i.actor_hash,u.whatsapp_id_hash),MAX(n.delivered_at),
 MAX(CASE WHEN n.detalles->>'supervisor'='true' THEN
 to_char(n.delivered_at AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD')||':'||
 CASE WHEN (n.delivered_at AT TIME ZONE 'America/Argentina/Cordoba')::time<TIME '13:00' THEN 'am' ELSE 'pm' END END)
FROM mia_private_task_notifications n
LEFT JOIN mia_whatsapp_identities i ON i.notification_key=n.destinatario_clave AND i.enabled IS TRUE
LEFT JOIN usuarios u ON LOWER(u.usuario)=n.destinatario_clave
WHERE n.estado='delivered' AND COALESCE(i.actor_hash,u.whatsapp_id_hash) IS NOT NULL
GROUP BY COALESCE(i.actor_hash,u.whatsapp_id_hash)
ON CONFLICT(actor_hash) DO NOTHING;
