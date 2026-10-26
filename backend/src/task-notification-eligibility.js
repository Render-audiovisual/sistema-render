const recipientField = 'destinatario_usuario_id';
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const taskIdText = value => positive(value) ? String(value)
  : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && positive(Number(value)) ? value : null;

// Only fixed, internal aliases may be interpolated. JSON identifiers are never
// cast to integers: malformed/out-of-range persisted metadata must not break a
// queue scan or become a legacy name-based fallback.
export function buildTaskNotificationEligibilityPredicate(alias = 'n') {
  if (!['n', 'notification'].includes(alias)) throw new TypeError('Invalid internal notification SQL alias.');
  return `(CASE WHEN jsonb_typeof(${alias}.detalles) = 'object'
    AND ${alias}.detalles ? '${recipientField}' THEN
    jsonb_typeof(${alias}.detalles->'${recipientField}') = 'number'
    AND ${alias}.destinatario_clave IS NOT NULL AND ${alias}.destinatario_clave <> ''
    AND EXISTS (
      SELECT 1 FROM usuarios recipient
      WHERE recipient.id > 0 AND to_jsonb(recipient.id) = ${alias}.detalles->'${recipientField}'
        AND recipient.activo IS TRUE AND recipient.whatsapp_habilitado IS TRUE
        AND (LOWER(recipient.usuario) = ${alias}.destinatario_clave OR EXISTS (
          SELECT 1 FROM mia_whatsapp_identities own_alias
          WHERE own_alias.usuario_id = recipient.id AND own_alias.notification_key = ${alias}.destinatario_clave
            AND own_alias.enabled IS TRUE))
        AND NOT EXISTS (
          SELECT 1 FROM usuarios other_user
          WHERE other_user.id <> recipient.id AND LOWER(other_user.usuario) = ${alias}.destinatario_clave)
        AND NOT EXISTS (
          SELECT 1 FROM mia_whatsapp_identities other_alias
          WHERE other_alias.usuario_id <> recipient.id AND other_alias.notification_key = ${alias}.destinatario_clave
            AND other_alias.enabled IS TRUE)
        AND ((${alias}.motivo IS DISTINCT FROM 'comentario' AND ${alias}.motivo IS DISTINCT FROM 'bloqueada'
          AND ${alias}.motivo IS DISTINCT FROM 'correcciones') OR EXISTS (
          SELECT 1 FROM tareas task JOIN tarea_asignaciones assignment
            ON assignment.tarea_id = task.id AND assignment.usuario_id = recipient.id
          WHERE task.id = ${alias}.tarea_id AND task.id > 0
            AND task.propiedades_extra->>'workspace' = 'render_os'
            AND task.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
            AND task.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'))
    ) ELSE TRUE END)`;
}

// Read-only delivery check with the exact queue predicate. Capture only needed
// primitives before awaiting DB; callers retain their existing supervisor,
// cooldown and delivery protocol. No ID means legacy, not an inferred identity.
export async function taskNotificationEligible(db, notification) {
  if (!notification || typeof notification !== 'object') return false;
  const details = notification.detalles;
  if (!details || !Object.hasOwn(details, recipientField)) return true;
  if (Array.isArray(details) || typeof details !== 'object') return false;
  const recipientId = details[recipientField], key = notification.destinatario_clave, reason = notification.motivo;
  if (!positive(recipientId) || typeof key !== 'string' || key === '' || typeof reason !== 'string') return false;
  const taskId = taskIdText(notification.tarea_id);
  if (['comentario', 'bloqueada', 'correcciones'].includes(reason) && taskId === null) return false;
  const { rows } = await db.query(`SELECT ${buildTaskNotificationEligibilityPredicate('n')} AS eligible
    FROM (SELECT $1::jsonb AS detalles,$2::text AS destinatario_clave,$3::text AS motivo,$4::bigint AS tarea_id) n`,
  [JSON.stringify({ [recipientField]: recipientId }), key, reason, taskId]);
  return rows?.[0]?.eligible === true;
}
