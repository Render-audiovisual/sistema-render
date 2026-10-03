import crypto from 'node:crypto';
import { supervisorReasoning } from './mia-supervisor-reasoning.js';
import {followupMessage,taskLabel,batchMessage,shortText,supervisorWindow,nextSupervisorWindow} from './mia-supervisor-messages.js';
import {
  addSupervisorWorkMinutes, detectSupervisorSignals, fingerprint, isSupervisorLeader,
  isSupervisorWorkTime, localClock, normalize, proposalSnapshot, proposeSupervisorDeadline,
  supervisorTaskActive, userOwnsSupervisorTask, validDate, validateSupervisorReport,
} from './mia-supervisor-policy.js';

const ACTIVE_SQL = `t.propiedades_extra->>'workspace'='render_os'
  AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`;
const APP_URL = 'https://sistema.rendercorrientes.com';
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const enabled = (env) => env.MIA_SUPERVISOR_ENABLED === 'true';
const urlFor = (task, env) => `${(env.APP_URL || APP_URL).replace(/\/$/, '')}/workspace/tareas?task=${task.id}`;
const cycleKey = (task, user, proposal = null) => fingerprint([task.id, user.id, task.fecha_vencimiento || ['missing_date',proposalSnapshot(task),proposal?.fecha]]);
const supervisorBlockerAllowed = (user,task) => {
  const block = task.propiedades_extra?.supervisor_bloqueo;
  return Boolean(block) && [block.usuario_id,...(Array.isArray(block.usuario_ids) ? block.usuario_ids : [])].some((id) => Number(id) === Number(user.id));
};

async function loadSnapshot(db, lock = false) {
  const tasks = await db.query(`SELECT t.id,t.titulo,t.asignado_a,t.estado,t.prioridad,t.tipo_tarea,t.subtipo,
    t.cliente_id,t.tarea_padre_id,t.propiedades_extra,t.aclaraciones,t.created_at,t.updated_at,
    to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,
    to_char(p.fecha_programada,'YYYY-MM-DD') publicacion_fecha_programada,c.nombre cliente_nombre
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id LEFT JOIN publicaciones p ON p.id=t.publicacion_id
    WHERE ${ACTIVE_SQL} ORDER BY t.id${lock ? ' FOR UPDATE OF t' : ''}`);
  const users = await db.query(`SELECT id,usuario,nombre,rol,whatsapp_id_hash,whatsapp_habilitado FROM usuarios ORDER BY id`);
  const identities = await db.query(`SELECT actor_hash,usuario_id,notification_key,display_name FROM mia_whatsapp_identities WHERE enabled IS TRUE`);
  const replies = await db.query(`SELECT usuario_id,tarea_id,reporte,created_at FROM mia_supervisor_replies WHERE created_at >= NOW()-INTERVAL '14 days'`);
  return { tasks: tasks.rows, users: users.rows, identities: identities.rows, replies: replies.rows };
}

function recipientsFor(user, identities) {
  if (user.whatsapp_habilitado === false) return [];
  const extra = identities.filter((identity) => Number(identity.usuario_id) === Number(user.id));
  if (extra.length) return extra.map((identity) => ({ clave: identity.notification_key, nombre: identity.display_name }));
  return user.whatsapp_id_hash ? [{ clave: normalize(user.usuario), nombre: user.nombre }] : [];
}

async function audit(db, action, taskId, details, actor = {}) {
  await db.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,tarea_id,detalles)
    VALUES('mia_supervisor','whatsapp',$1,$2,$3,$4,$5::jsonb)`,
  [actor.actorId ? fingerprint([actor.actorId]) : 'mia-system', actor.actorName || 'Mía · Supervisor', action, taskId, JSON.stringify(details)]);
}

async function comment(db, taskId, content, author = 'Mía · Supervisor') {
  await db.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)`, [taskId, author, content]);
}

async function queue(db, task, recipient, reason, text, dedupe, details, env, followup = null, attempt = null) {
  const fp = fingerprint(['mia-supervisor-v2', dedupe, recipient.clave]);
  const result = await db.query(`INSERT INTO mia_private_task_notifications
    (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles,supervisor_followup_id,supervisor_attempt)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT(fingerprint) DO UPDATE
      SET cancelled_at=NULL,estado='pending',batch_parent_id=NULL,mensaje=EXCLUDED.mensaje,detalles=EXCLUDED.detalles
      WHERE mia_private_task_notifications.cancelled_at IS NOT NULL AND mia_private_task_notifications.estado<>'delivered' RETURNING id`,
    [fp, recipient.nombre, recipient.clave, task.id, `supervisor_${reason}`, text, urlFor(task, env), JSON.stringify({ supervisor: true,message_version:2,label:taskLabel(task), ...details }), followup, attempt]);
  return result.rows.length;
}

async function queueLeaders(db, snapshot, task, reason, text, dedupe, details, env) {
  let count = 0;
  for (const leader of snapshot.users.filter(isSupervisorLeader)) {
    for (const recipient of recipientsFor(leader, snapshot.identities)) count += await queue(db, task, recipient, reason, text, dedupe, details, env);
  }
  return count;
}

function followupText(task, user, followup, proposal) {
  return followupMessage(task,followup.tipo,proposal);
}

/** A shared account has two people; legacy aliases resolve to the same actual person. */
export async function notificationContactAllowed(db,notification,now=new Date()) {
  if(notification.batch_parent_id) return true;
  const limits=await db.query(`SELECT l.* FROM mia_private_contact_limits l WHERE actor_hash=COALESCE(
    (SELECT actor_hash FROM mia_whatsapp_identities WHERE notification_key=$1 AND enabled IS TRUE),
    (SELECT whatsapp_id_hash FROM usuarios WHERE LOWER(usuario)=$1 LIMIT 1))`,[notification.destinatario_clave]);
  const limit=limits.rows[0];
  if(limit?.last_delivered_at && new Date(now)-new Date(limit.last_delivered_at)<10*60000) return false;
  if(notification.detalles?.supervisor) {
    const inbound=await db.query(`SELECT 1 FROM mia_supervisor_inbound WHERE actor_hash=COALESCE(
      (SELECT actor_hash FROM mia_whatsapp_identities WHERE notification_key=$1 AND enabled IS TRUE),
      (SELECT whatsapp_id_hash FROM usuarios WHERE LOWER(usuario)=$1 LIMIT 1))
      AND last_inbound_at>$2::timestamptz-INTERVAL '4 hours'`,[notification.destinatario_clave,now]);
    if(inbound.rows.length) return false;
  }
  return !notification.detalles?.supervisor || !limit?.supervisor_window || limit.supervisor_window!==supervisorWindow(now);
}

export async function consolidateSupervisorNotifications(db,now=new Date()) {
  const pending=(await db.query(`SELECT * FROM mia_private_task_notifications WHERE detalles->>'supervisor'='true'
    AND batch_parent_id IS NULL AND cancelled_at IS NULL AND estado='pending' ORDER BY
    CASE WHEN motivo='supervisor_escalacion' THEN 0 WHEN motivo='supervisor_seguimiento' THEN 1 ELSE 2 END,created_at,id`)).rows;
  // Recheck all pending messages; after edits/completion, obsolete notices never remain deliverable.
  const available=[];
  for(const notice of pending) {
    if(await supervisorNotificationDeliverable(db,notice,{env:{MIA_SUPERVISOR_ENABLED:'true'},now,ignoreContact:true})) available.push(notice);
    else {
      await db.query(`UPDATE mia_private_task_notifications SET cancelled_at=$2 WHERE id=$1`,[notice.id,now]);
      await db.query(`UPDATE mia_private_task_notifications SET batch_parent_id=NULL WHERE batch_parent_id=$1 AND estado='pending'`,[notice.id]);
    }
  }
  const groups=new Map();
  for(const notice of available.filter(n=>!n.detalles.members)) {
    const key=notice.destinatario_clave;
    const list=groups.get(key)||[];list.push(notice);groups.set(key,list);
  }
  for(const rows of groups.values()) {
    const first=rows[0];
    const leaders=first.motivo!=='supervisor_seguimiento' && !first.detalles.source_message_id;
    const compatible=leaders?rows.filter(n=>n.motivo!=='supervisor_seguimiento'&&!n.detalles.source_message_id)
      :rows.filter(n=>n.motivo===first.motivo && n.detalles.type===first.detalles.type
        && (first.detalles.type==='overdue' || n.detalles.proposed_date===first.detalles.proposed_date)).slice(0,2);
    if(compatible.length<2) continue;
    const fp=fingerprint(['supervisor-batch-v2',compatible.map(n=>n.id)]);
    const inserted=await db.query(`INSERT INTO mia_private_task_notifications
      (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(fingerprint) DO UPDATE SET cancelled_at=NULL,estado='pending'
      WHERE mia_private_task_notifications.estado<>'delivered' RETURNING id`,
      [fp,first.destinatario,first.destinatario_clave,first.tarea_id,first.motivo,batchMessage(compatible),first.tarea_url,
        JSON.stringify({supervisor:true,message_version:2,members:compatible.map(n=>n.id)})]);
    if(inserted.rows[0]) await db.query(`UPDATE mia_private_task_notifications SET batch_parent_id=$1 WHERE id=ANY($2::bigint[])`,[inserted.rows[0].id,compatible.map(n=>n.id)]);
  }
}

/** Dry-run always performs SELECTs only, including when production is disabled. */
export async function runMiaSupervisor(pool, { dryRun = true, now = new Date(), env = process.env, maxEvents = 50 } = {}) {
  if (!dryRun && !enabled(env)) return { enabled: false, writes: 0, reason: 'disabled' };
  const db = dryRun ? pool : await pool.connect();
  const result = { enabled: enabled(env), dry_run: dryRun, within_work_hours: isSupervisorWorkTime(now), tasks_checked: 0, proposals: [], signals: [], queued: 0, escalated: 0,
    communication_policy:{version:2,max_proactive_per_person_per_window:1,global_private_cooldown_minutes:10,active_conversation_pause_hours:4} };
  try {
    if (!dryRun) {
      await db.query('BEGIN');
      const lock = await db.query(`SELECT pg_try_advisory_xact_lock(hashtext('mia-supervisor:scan')) acquired`);
      if (!lock.rows[0]?.acquired) { await db.query('ROLLBACK'); return { ...result, busy: true }; }
    }
    const snapshot = await loadSnapshot(db, !dryRun);
    const reachableLeaders = snapshot.users.filter(isSupervisorLeader).flatMap((user) => recipientsFor(user,snapshot.identities));
    result.leader_destinations = reachableLeaders.length;
    const active = snapshot.tasks.filter(supervisorTaskActive);
    result.tasks_checked = active.length;
    const today = localClock(now).date;
    const proposals = await db.query(`SELECT *,to_char(fecha,'YYYY-MM-DD') fecha FROM mia_supervisor_proposals WHERE estado='pending'`);
    const follows = await db.query(`SELECT * FROM mia_supervisor_followups WHERE estado IN ('waiting','escalated') ORDER BY id`);
    const conversations=(await db.query(`SELECT * FROM mia_supervisor_conversations WHERE last_inbound_at>$1::timestamptz-INTERVAL '4 hours'`,[now])).rows;
    const current = new Set();
    for (const task of active) {
      const owners = snapshot.users.filter((u) => userOwnsSupervisorTask(u, task));
      const overdue = task.fecha_vencimiento && task.fecha_vencimiento < today;
      let proposal = proposals.rows.find((p) => Number(p.tarea_id) === Number(task.id));
      if (!task.fecha_vencimiento) {
        const hash = proposalSnapshot(task);
        if (!proposal || proposal.snapshot_hash !== hash || proposal.fecha < today) {
          const plan = proposeSupervisorDeadline(task, snapshot.tasks, snapshot.users, now);
          result.proposals.push({ tarea_id: Number(task.id), ...plan });
          if (!dryRun && plan.fecha && result.queued < maxEvents) {
            if (proposal) await db.query(`UPDATE mia_supervisor_proposals SET estado='superseded' WHERE id=$1`, [proposal.id]);
            proposal = { id: crypto.randomUUID(), tarea_id: task.id, ...plan, snapshot_hash: hash };
            await db.query(`INSERT INTO mia_supervisor_proposals(id,tarea_id,fecha,razon,snapshot_hash) VALUES($1,$2,$3,$4,$5)`,
              [proposal.id,task.id,plan.fecha,plan.razon,hash]);
            await comment(db, task.id, `${owners.map((u) => '@' + u.nombre).join(' ')}\nPropuesta de entrega: ${plan.fecha}. ${plan.razon}\nID de propuesta: ${proposal.id}`);
            await audit(db, 'proponer_fecha', task.id, plan);
          }
          if (!plan.fecha) result.signals.push({ tipo: 'dependencia_circular', task_ids: [Number(task.id)], problema: plan.razon, causa: 'Dependencias sin resolución.', accion: 'Revisar la relación entre tareas.', fingerprint: fingerprint(['dependency_cycle', task.id]) });
          if (plan.conflicto_publicacion) result.signals.push({ tipo: 'fecha_irreal', task_ids: [Number(task.id)], problema: `La tarea #${task.id} no llega a la publicación prevista.`, causa: plan.razon, accion: 'Redistribuir carga o acordar otro plazo.', fingerprint: fingerprint(['unrealistic',task.id,task.publicacion_fecha_programada]) });
        }
      } else if (proposal && !dryRun) {
        await db.query(`UPDATE mia_supervisor_proposals SET estado='superseded' WHERE id=$1`, [proposal.id]);
      }
      if (task.fecha_vencimiento && !overdue) continue;
      for (const owner of owners) {
        const key = cycleKey(task, owner, proposal);
        current.add(key);
        let followup = follows.rows.find((f) => f.cycle_key === key);
        if (dryRun || !result.within_work_hours || result.queued >= maxEvents) continue;
        if (!followup) {
          const created = await db.query(`INSERT INTO mia_supervisor_followups(tarea_id,usuario_id,cycle_key,tipo,due_date)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(tarea_id,usuario_id,cycle_key) DO NOTHING RETURNING *`,
            [task.id,owner.id,key,overdue ? 'overdue' : 'missing_date',task.fecha_vencimiento]);
          followup = created.rows[0];
          if (!followup) continue;
        }
        if (followup.estado !== 'waiting' || (followup.next_attempt_at && new Date(followup.next_attempt_at) > new Date(now))) continue;
        if(conversations.some(c=>Number(c.usuario_id)===Number(owner.id))) continue;
        if(followup.attempts>0 && task.updated_at && new Date(task.updated_at)>new Date(followup.last_delivered_at)
          && new Date(now)-new Date(task.updated_at)<4*3600000) continue;
        if (followup.attempts >= 3) {
          if (!reachableLeaders.length) continue;
          const overdueDays = task.fecha_vencimiento ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.fecha_vencimiento}T12:00:00Z`)) / 86400000) : null;
          const text = `${taskLabel(task)} sigue sin actualización después de 3 avisos entregados a ${shortText(owner.nombre,32)}. Necesito que revisen el bloqueo con esa persona.`;
          result.queued += await queueLeaders(db, snapshot, task, 'escalacion', text, ['escalation',followup.id], { followup_id: followup.id, attempts: 3, overdue_days: overdueDays }, env);
          await db.query(`UPDATE mia_supervisor_followups SET estado='escalated',updated_at=$2 WHERE id=$1`, [followup.id,now]);
          await audit(db, 'escalar_sin_respuesta', task.id, { responsable_id: owner.id, attempts: 3 });
          result.escalated++;
          continue;
        }
        if (!overdue && !proposal?.id) continue;
        const recipients = recipientsFor(owner, snapshot.identities);
        if (!recipients.length) {
          result.queued += await queueLeaders(db, snapshot, task, 'contacto_faltante', `No pude avisarle a ${shortText(owner.nombre,32)} por ${taskLabel(task)}: falta vincular su WhatsApp. Vinculen su número en Usuarios y accesos.`, ['unlinked',task.id,owner.id], { usuario_id: owner.id }, env);
          continue;
        }
        for (const recipient of recipients) result.queued += await queue(db, task, recipient, 'seguimiento', followupText(task, owner, followup, proposal),
          [followup.id,followup.attempts + 1], { cycle_key: key, proposal_id: proposal?.id || null, due_date: task.fecha_vencimiento,type:followup.tipo,proposed_date:proposal?.fecha }, env, followup.id, followup.attempts + 1);
      }
      if (!owners.length && !dryRun && result.within_work_hours) result.queued += await queueLeaders(db, snapshot, task, 'responsable_faltante',
        `${taskLabel(task)} no tiene responsables vinculados. Asignen al menos una persona desde la tarea.`, ['missing_owner',task.id,task.asignado_a], {}, env);
    }
    if (!dryRun) {
      // Close obsolete deadline/ownership cycles and invalidate messages still in the outbox.
      for (const followup of follows.rows.filter((f) => !current.has(f.cycle_key))) {
        await db.query(`UPDATE mia_supervisor_followups SET estado='closed',updated_at=$2 WHERE id=$1`, [followup.id,now]);
        await db.query(`UPDATE mia_private_task_notifications SET cancelled_at=$2 WHERE supervisor_followup_id=$1 AND estado<>'delivered'`, [followup.id,now]);
      }
    }
    result.signals.push(...detectSupervisorSignals(snapshot.tasks, snapshot.users, snapshot.replies, now));
    // Signals recur only after resolution, not just because a clock/calendar ticked.
    if (!dryRun && result.within_work_hours) {
      const keys = result.signals.map((s) => s.fingerprint);
      await db.query(`UPDATE mia_supervisor_signals SET active=FALSE,resolved_at=$2 WHERE active IS TRUE AND NOT(fingerprint=ANY($1::text[]))`, [keys,now]);
      for (const signal of result.signals) {
        if (result.queued >= maxEvents) break;
        if (!reachableLeaders.length) break;
        const stored = await db.query(`INSERT INTO mia_supervisor_signals(fingerprint,tipo,tarea_ids,detalles)
          VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(fingerprint) DO UPDATE SET active=TRUE,generation=mia_supervisor_signals.generation+1,resolved_at=NULL,detalles=EXCLUDED.detalles
          WHERE mia_supervisor_signals.active IS FALSE RETURNING generation`, [signal.fingerprint,signal.tipo,signal.task_ids,JSON.stringify(signal)]);
        if (!stored.rows[0]) continue;
        const task = snapshot.tasks.find((t) => Number(t.id) === signal.task_ids[0]);
        if (!task) continue;
        const advice = result.reasoning_checked ? { status:'budget_deferred' } : await supervisorReasoning(signal,snapshot.tasks,{ env });
        result.reasoning_checked = true;
        const signalText=signal.tipo==='saturacion'?`${shortText(snapshot.users.find(u=>Number(u.id)===signal.user_id)?.nombre,32)} tiene ${signal.task_ids.length} tareas vencidas. Revisen prioridades y carga con esa persona.`
          :`${taskLabel(task)} necesita revisión de prioridades. ${shortText(signal.accion,110)}`;
        result.queued += await queueLeaders(db, snapshot, task, 'senal', signalText,
          [signal.fingerprint,stored.rows[0].generation], { signal: signal.fingerprint,generation:stored.rows[0].generation }, env);
        await audit(db, 'detectar_senal', task.id, { ...signal,reasoning:advice });
      }
    }
    if (!dryRun && result.within_work_hours) await consolidateSupervisorNotifications(db,now);
    if (!dryRun) await db.query('COMMIT');
    return result;
  } catch (error) {
    if (!dryRun) await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { if (!dryRun) db.release(); }
}

export async function acknowledgeSupervisorDelivery(db, notification, now = new Date()) {
  if(!notification.batch_parent_id) await db.query(`INSERT INTO mia_private_contact_limits(actor_hash,last_delivered_at,supervisor_window)
    SELECT COALESCE((SELECT actor_hash FROM mia_whatsapp_identities WHERE notification_key=$1 AND enabled IS TRUE),
      (SELECT whatsapp_id_hash FROM usuarios WHERE LOWER(usuario)=$1 LIMIT 1)),$2,$3
    WHERE COALESCE((SELECT actor_hash FROM mia_whatsapp_identities WHERE notification_key=$1 AND enabled IS TRUE),
      (SELECT whatsapp_id_hash FROM usuarios WHERE LOWER(usuario)=$1 LIMIT 1)) IS NOT NULL
    ON CONFLICT(actor_hash) DO UPDATE SET last_delivered_at=EXCLUDED.last_delivered_at,
      supervisor_window=COALESCE(EXCLUDED.supervisor_window,mia_private_contact_limits.supervisor_window)`,
    [notification.destinatario_clave,now,notification.detalles?.supervisor?supervisorWindow(now):null]);
  if(notification.detalles?.members) {
    const children=(await db.query(`UPDATE mia_private_task_notifications SET estado='delivered',delivered_at=$2
      WHERE batch_parent_id=$1 AND estado<>'delivered' RETURNING *`,[notification.id,now])).rows;
    for(const child of children.sort((a,b)=>Number(a.supervisor_followup_id)-Number(b.supervisor_followup_id))) await acknowledgeSupervisorDelivery(db,child,now);
    return;
  }
  if (!notification.supervisor_followup_id) return;
  // Serialize distinct recipients of a shared account before checking all ACKs.
  // Otherwise concurrent transactions can each see the other's delivery pending.
  await db.query(`SELECT id FROM mia_supervisor_followups WHERE id=$1 FOR UPDATE`, [notification.supervisor_followup_id]);
  const attempt = Number(notification.supervisor_attempt);
  await db.query(`UPDATE mia_supervisor_followups SET attempts=$2,last_delivered_at=$3,next_attempt_at=$4,updated_at=$3
    WHERE id=$1 AND estado='waiting' AND attempts=$2-1
      AND NOT EXISTS(SELECT 1 FROM mia_private_task_notifications n
        WHERE n.supervisor_followup_id=$1 AND n.supervisor_attempt=$2
          AND n.cancelled_at IS NULL AND n.estado<>'delivered')`,
    [notification.supervisor_followup_id, attempt, now, nextSupervisorWindow(now)]);
}

export async function supervisorNotificationDeliverable(db, notification, { env = process.env, now = new Date(),ignoreContact=false } = {}) {
  if(!notification) return false;
  if(!ignoreContact && !await notificationContactAllowed(db,notification,now)) return false;
  if (!notification.detalles?.supervisor) return true;
  if (!enabled(env) || !isSupervisorWorkTime(now)) return false;
  if(notification.detalles.message_version!==2) return false;
  if(notification.detalles.members) {
    const children=(await db.query(`SELECT * FROM mia_private_task_notifications WHERE batch_parent_id=$1`,[notification.id])).rows;
    if(children.length!==notification.detalles.members.length) return false;
    for(const child of children) if(child.cancelled_at || !await supervisorNotificationDeliverable(db,child,{env,now,ignoreContact:true})) return false;
    return true;
  }
  const taskResult = await db.query(`SELECT t.*,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,
    to_char(p.fecha_programada,'YYYY-MM-DD') publicacion_fecha_programada
    FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id WHERE t.id=$1`, [notification.tarea_id]);
  const task = taskResult.rows[0];
  if (!supervisorTaskActive(task)) return false;
  if (!notification.supervisor_followup_id) {
    if (notification.detalles.signal) {
      const signal = await db.query(`SELECT active,generation FROM mia_supervisor_signals WHERE fingerprint=$1`, [notification.detalles.signal]);
      return signal.rows[0]?.active === true && Number(signal.rows[0].generation) === Number(notification.detalles.generation);
    }
    if (notification.detalles.source_message_id) {
      return task.propiedades_extra?.supervisor_bloqueo?.source_message_id === notification.detalles.source_message_id;
    }
    if (!notification.detalles.followup_id) return true;
  }
  const followupId = notification.supervisor_followup_id || notification.detalles.followup_id;
  const followup = await db.query(`SELECT f.*,u.nombre,u.usuario,u.rol FROM mia_supervisor_followups f JOIN usuarios u ON u.id=f.usuario_id WHERE f.id=$1`, [followupId]);
  const f = followup.rows[0];
  if (!f || f.estado !== (notification.supervisor_followup_id ? 'waiting' : 'escalated') || !userOwnsSupervisorTask(f,task)
    || (notification.supervisor_followup_id && Number(f.attempts) >= Number(notification.supervisor_attempt))) return false;
  if(notification.supervisor_followup_id) {
    const conversation=await db.query(`SELECT 1 FROM mia_supervisor_conversations WHERE usuario_id=$1 AND tarea_id=$2
      AND last_inbound_at>$3::timestamptz-INTERVAL '4 hours'`,[f.usuario_id,task.id,now]);
    if(conversation.rows.length) return false;
    if(Number(f.attempts)>0 && task.updated_at && new Date(task.updated_at)>new Date(f.last_delivered_at)
      && new Date(now)-new Date(task.updated_at)<4*3600000) return false;
  }
  if (f.tipo === 'missing_date') {
    const proposal = await db.query(`SELECT snapshot_hash,to_char(fecha,'YYYY-MM-DD') fecha FROM mia_supervisor_proposals WHERE tarea_id=$1 AND estado='pending'`, [task.id]);
    return proposal.rows[0]?.snapshot_hash === proposalSnapshot(task) && f.cycle_key === cycleKey(task,{ id:f.usuario_id },proposal.rows[0]);
  }
  return f.cycle_key === cycleKey(task,{ id:f.usuario_id }) && task.fecha_vencimiento < localClock(now).date;
}

async function currentActor(db, actor) {
  if (!actor.privateChat || !actor.userId) throw fail('El seguimiento se responde por WhatsApp privado con una cuenta vinculada.',403);
  const user = await db.query(`SELECT id,usuario,nombre,rol FROM usuarios WHERE id=$1 AND whatsapp_habilitado IS TRUE
    AND (whatsapp_id_hash=$2 OR EXISTS(SELECT 1 FROM mia_whatsapp_identities i WHERE i.usuario_id=usuarios.id AND i.actor_hash=$2 AND i.enabled IS TRUE))`,
    [actor.userId,crypto.createHash('sha256').update(String(actor.actorId).replace(/^\+/, '')).digest('hex')]);
  if (!user.rows[0]) throw fail('La cuenta de WhatsApp no está vinculada o fue deshabilitada.',403);
  return user.rows[0];
}

async function loadTask(db, id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw fail('Tarea inválida.');
  const result = await db.query(`SELECT t.*,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,
    to_char(p.fecha_programada,'YYYY-MM-DD') publicacion_fecha_programada
    FROM tareas t LEFT JOIN publicaciones p ON p.id=t.publicacion_id
    WHERE t.id=$1 AND ${ACTIVE_SQL} FOR UPDATE OF t`, [id]);
  if (!result.rows[0] || !supervisorTaskActive(result.rows[0])) throw fail('La tarea no está activa en RENDER OS.',404);
  return result.rows[0];
}

export async function acceptSupervisorDeadline(pool, { actor, taskId, proposalId, date, messageId, env = process.env, now = new Date() }) {
  if (!enabled(env)) throw fail('El supervisor todavía no está activado.',503);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(proposalId || ''))) throw fail('Propuesta inválida.');
  return supervisorReplyTransaction(pool, { actor, taskId, messageId, payload: { proposalId, date }, now }, async (db,user,task) => {
    const proposal = await db.query(`SELECT *,to_char(fecha,'YYYY-MM-DD') fecha FROM mia_supervisor_proposals WHERE id=$1 AND tarea_id=$2 AND estado='pending' FOR UPDATE`, [proposalId,task.id]);
    const p = proposal.rows[0];
    if (!p || p.snapshot_hash !== proposalSnapshot(task)) throw fail('La propuesta cambió; pedí una nueva fecha antes de confirmar.',409);
    const chosen = date || p.fecha;
    if (!validDate(chosen) || chosen < localClock(now).date) throw fail('La fecha acordada debe ser válida y desde hoy en adelante.');
    await db.query(`UPDATE tareas SET fecha_vencimiento=$2,updated_at=$3 WHERE id=$1`, [task.id,chosen,now]);
    await db.query(`UPDATE mia_supervisor_proposals SET estado='accepted',accepted_by=$2,accepted_at=$3 WHERE id=$1`, [p.id,user.id,now]);
    await comment(db,task.id,`${user.nombre} acordó la entrega para ${chosen}. Propuesta ${p.id}.`);
    await audit(db,'aceptar_fecha',task.id,{ fecha: chosen, proposal_id: p.id, user_id: user.id },actor);
    return { accepted: true, tarea_id: Number(task.id), fecha_vencimiento: chosen, message: 'Listo, la fecha acordada quedó cargada en la tarea.' };
  });
}

async function supervisorReplyTransaction(pool, { actor,taskId,messageId,payload,now,allowBlocker=false }, operation) {
  if (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 200) throw fail('Falta el ID estable del mensaje de WhatsApp.');
  const actorHash = crypto.createHash('sha256').update(String(actor.actorId).replace(/^\+/, '')).digest('hex');
  const payloadHash = fingerprint([taskId,payload]);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`mia-supervisor:reply:${actorHash}:${messageId}`]);
    const user = await currentActor(db,actor);
    const previous = await db.query(`SELECT payload_hash,resultado FROM mia_supervisor_replies WHERE actor_hash=$1 AND message_id=$2`, [actorHash,messageId]);
    if (previous.rows[0]) {
      if (previous.rows[0].payload_hash !== payloadHash) throw fail('Ese mensaje ya se usó con otro contenido.',409);
      await db.query('COMMIT');
      return { ...previous.rows[0].resultado, idempotent: true };
    }
    await db.query(`INSERT INTO mia_supervisor_inbound(actor_hash,last_inbound_at,message_id) VALUES($1,$2,$3)
      ON CONFLICT(actor_hash) DO UPDATE SET last_inbound_at=EXCLUDED.last_inbound_at,message_id=EXCLUDED.message_id`,[actorHash,now,messageId]);
    const task = await loadTask(db,taskId);
    const blocker = allowBlocker && supervisorBlockerAllowed(user,task);
    if (!userOwnsSupervisorTask(user,task) && !isSupervisorLeader(user) && !blocker) throw fail('Solo los responsables o un Líder pueden responder por esta tarea.',403);
    const result = await operation(db,user,task);
    if(!result.needs_more) await db.query(`UPDATE mia_supervisor_followups SET estado='answered',updated_at=$3 WHERE tarea_id=$1 AND (usuario_id=$2 OR $4) AND estado IN ('waiting','escalated')`, [task.id,user.id,now,isSupervisorLeader(user)]);
    await db.query(`UPDATE mia_private_task_notifications n SET cancelled_at=$3 FROM mia_supervisor_followups f
      WHERE n.supervisor_followup_id=f.id AND f.tarea_id=$1 AND (f.usuario_id=$2 OR $4) AND n.estado<>'delivered'`, [task.id,user.id,now,isSupervisorLeader(user)]);
    await db.query(`INSERT INTO mia_supervisor_replies(usuario_id,tarea_id,actor_hash,message_id,payload_hash,contenido,reporte,resultado,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [user.id,task.id,actorHash,messageId,payloadHash,payload.texto || 'Confirmación de fecha',JSON.stringify(payload),JSON.stringify(result),now]);
    await db.query('COMMIT');
    return result;
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}

export async function recordSupervisorReply(pool, { actor, taskId, messageId, input, env = process.env, now = new Date() }) {
  if (!enabled(env)) throw fail('El supervisor todavía no está activado.',503);
  return supervisorReplyTransaction(pool,{ actor,taskId,messageId,payload:input,now },async (db,user,task) => {
    const previous=(await db.query(`SELECT report FROM mia_supervisor_conversations WHERE usuario_id=$1 AND tarea_id=$2 FOR UPDATE`,[user.id,task.id])).rows[0]?.report||{};
    const combined={...previous,...Object.fromEntries(Object.entries(input).filter(([key,value])=>!['message_id','texto'].includes(key)&&value!==undefined&&value!==null&&value!=='')),texto:[previous.texto,input.texto].filter(Boolean).join('\n')};
    const parsed = validateSupervisorReport(combined,task,now);
    await db.query(`INSERT INTO mia_supervisor_conversations(usuario_id,tarea_id,last_inbound_at,report) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(usuario_id,tarea_id) DO UPDATE SET last_inbound_at=EXCLUDED.last_inbound_at,report=EXCLUDED.report`,[user.id,task.id,now,JSON.stringify(combined)]);
    if (!parsed.valid) return {recorded:false,needs_more:true,tarea_id:Number(task.id),message:parsed.errors[0]};
    await db.query(`UPDATE mia_supervisor_conversations SET report='{}'::jsonb WHERE usuario_id=$1 AND tarea_id=$2`,[user.id,task.id]);
    const r = parsed.report;
    const nextState = ['pendiente','en_progreso'].includes(r.estado) ? r.estado : task.estado;
    const props = { ...task.propiedades_extra, supervisor_ultimo_reporte: { ...r,usuario_id:Number(user.id),fecha:new Date(now).toISOString() } };
    if (r.estado === 'bloqueada') props.supervisor_bloqueo = { motivo:r.motivo,usuario_id:r.bloqueo_usuario_id,source_message_id:messageId,desde:new Date(now).toISOString() };
    else delete props.supervisor_bloqueo;
    await db.query(`UPDATE tareas SET estado=$2,fecha_vencimiento=COALESCE($3::date,fecha_vencimiento),propiedades_extra=$4::jsonb,updated_at=$5 WHERE id=$1`,
      [task.id,nextState,r.nueva_fecha,JSON.stringify(props),now]);
    await comment(db,task.id,`Actualización de ${user.nombre} por WhatsApp:\n${r.texto}`);
    await audit(db,'registrar_reporte',task.id,{ ...r,usuario_id:Number(user.id),message_id:messageId },actor);
    let contacted = 0;
    if (r.estado === 'bloqueada') {
      const snapshot = await loadSnapshot(db);
      // Explicit blocker, or a pending parent task's responsible. No arbitrary name matching.
      const parent = snapshot.tasks.find((t) => Number(t.id) === Number(task.tarea_padre_id));
      const people = r.bloqueo_usuario_id ? snapshot.users.filter((u) => Number(u.id) === r.bloqueo_usuario_id)
        : parent ? snapshot.users.filter((u) => userOwnsSupervisorTask(u,parent)) : [];
      if (r.bloqueo_usuario_id && !people.length) throw fail('La persona que puede ayudar no existe.');
      props.supervisor_bloqueo.usuario_ids = people.filter((p) => Number(p.id) !== Number(user.id)).map((p) => Number(p.id));
      await db.query(`UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1`, [task.id,JSON.stringify(props)]);
      for (const person of people.filter((p) => Number(p.id) !== Number(user.id))) {
        for (const recipient of recipientsFor(person,snapshot.identities)) contacted += await queue(db,task,recipient,'destrabar',
          `${taskLabel(task)} está bloqueada: ${shortText(r.motivo,100)}. ¿Qué necesitás para destrabarla?`,
          ['blocker',task.id,messageId,person.id],{ blocker_user_id:person.id,source_message_id:messageId },env);
      }
      if (!contacted) contacted += await queueLeaders(db,snapshot,task,'destrabar',`${taskLabel(task)} está bloqueada: ${shortText(r.motivo,90)}. Definan quién puede ayudar y vinculen su WhatsApp.`,['blocker-leaders',task.id,messageId],{ source_message_id:messageId },env);
    }
    return { recorded:true,tarea_id:Number(task.id),fecha_vencimiento:r.nueva_fecha || task.fecha_vencimiento,contacted,
      requires_review_flow:r.estado==='lista_para_revision',message:r.estado==='lista_para_revision' ? 'Registré el avance. Para pasar a Revisar se conservan los controles de material y confirmación habituales.' : 'Registré tu actualización y la fecha en la tarea.' };
  });
}

export async function recordSupervisorBlockerReply(pool, { actor,taskId,messageId,input,env=process.env,now=new Date() }) {
  if (!enabled(env)) throw fail('El supervisor todavía no está activado.',503);
  return supervisorReplyTransaction(pool,{ actor,taskId,messageId,payload:input,now,allowBlocker:true },async (db,user,task) => {
    if (!supervisorBlockerAllowed(user,task) && !isSupervisorLeader(user)) throw fail('Esta ayuda no fue solicitada a tu cuenta.',403);
    const text = typeof input.texto === 'string' ? input.texto.trim() : '';
    const detail = typeof input.motivo === 'string' ? input.motivo.trim() : '';
    if (text.length<12 || text.length>6000 || detail.length<8 || !normalize(text).includes(normalize(detail))) throw fail('Necesito el material o bloqueo concreto y cuándo podrá resolverse.');
    await comment(db,task.id,`Respuesta para destrabar de ${user.nombre}:\n${text}`);
    const snapshot = await loadSnapshot(db);
    let queued = 0;
    for (const owner of snapshot.users.filter((u) => userOwnsSupervisorTask(u,task))) {
      for (const recipient of recipientsFor(owner,snapshot.identities)) queued += await queue(db,task,recipient,'respuesta_bloqueo',
        `${shortText(user.nombre,32)} respondió por ${taskLabel(task)}: ${shortText(detail,100)}. ¿Podés continuar?`,['blocker-reply',task.id,messageId],{ source_message_id:task.propiedades_extra?.supervisor_bloqueo?.source_message_id },env);
    }
    await audit(db,'responder_bloqueo',task.id,{ usuario_id:Number(user.id),message_id:messageId },actor);
    return { recorded:true,tarea_id:Number(task.id),contacted:queued,message:'Compartí tu respuesta en privado con los responsables y quedó registrada en la tarea.' };
  });
}

export function scheduleMiaSupervisor(pool, { env = process.env, intervalMs = 300000, logger = console } = {}) {
  if (!enabled(env)) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runMiaSupervisor(pool,{ dryRun:false,env }); }
    catch (error) { logger.error('Supervisor de Mía: no se pudo completar el control.',error.message); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick,intervalMs);
  timer.unref?.();
  return timer;
}

export function createMiaSupervisorRouter({ express,pool,isSystemActor,env=process.env }) {
  const router = express.Router();
  const handler = (fn) => (req,res,next) => Promise.resolve(fn(req,res)).catch((error) => error.status ? res.status(error.status).json({ error:error.message }) : next(error));
  router.get('/comunicaciones',handler(async(req,res)=>{
    if (!isSystemActor(req)) throw fail('Lectura exclusiva del proceso operativo de Mía.',403);
    const rows = (await pool.query(`SELECT n.destinatario_clave,n.mensaje,n.motivo,n.delivered_at,t.titulo,c.nombre cliente
      FROM mia_private_task_notifications n LEFT JOIN tareas t ON t.id=n.tarea_id LEFT JOIN clientes c ON c.id=t.cliente_id
      WHERE n.detalles->>'supervisor'='true' AND n.batch_parent_id IS NULL AND n.estado='delivered' AND n.delivered_at>=NOW()-INTERVAL '7 days'
      ORDER BY n.delivered_at,n.id LIMIT 1000`)).rows;
    const users=(await pool.query('SELECT nombre,usuario FROM usuarios')).rows;
    const titles=(await pool.query(`SELECT DISTINCT titulo FROM tareas WHERE titulo IS NOT NULL`)).rows;
    const clients=(await pool.query(`SELECT nombre FROM clientes WHERE nombre IS NOT NULL`)).rows;
    const people=new Map(),tasks=new Map();
    const samples=rows.slice(0,30).map((row)=>{
      if(!people.has(row.destinatario_clave)) people.set(row.destinatario_clave,`Persona ${people.size+1}`);
      let text=row.mensaje;
      if(row.titulo) {
        if(!tasks.has(row.titulo)) tasks.set(row.titulo,`Tarea ${tasks.size+1}`);
        text=text.split(row.titulo).join(tasks.get(row.titulo));
      }
      if(row.cliente) text=text.split(row.cliente).join('Cliente');
      for(const title of titles.map(t=>t.titulo).filter(Boolean).sort((a,b)=>b.length-a.length)) {
        if(!tasks.has(title)) tasks.set(title,`Tarea ${tasks.size+1}`);
        text=text.split(title).join(tasks.get(title));
      }
      for(const client of clients.map(c=>c.nombre).sort((a,b)=>b.length-a.length)) text=text.split(client).join('Cliente');
      for(const name of [...users.flatMap(u=>[u.nombre,u.usuario]),'Agustín','Franco socio'].filter(Boolean).sort((a,b)=>b.length-a.length)) {
        const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        text=text.replace(new RegExp(`\\b${escaped}\\b`,'gi'),'Persona');
      }
      return {persona:people.get(row.destinatario_clave),fecha:row.delivered_at,motivo:row.motivo,
        caracteres:row.mensaje.length,preguntas:(row.mensaje.match(/\?/g)||[]).length,
        codigos_tecnicos:/[0-9a-f]{8}-[0-9a-f-]{27,}|Tarea #\d+|Propuesta:/.test(row.mensaje),
        texto:text.replace(/https?:\/\/\S+/gi,'[enlace]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[correo]')
          .replace(/\+?\d[\d ()-]{9,}\d/g,'[teléfono]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[código]').replace(/#\d+/g,'[número]')};
    });
    const byPerson=new Map();
    for(const row of rows) {
      const list=byPerson.get(row.destinatario_clave)||[];list.push(row);byPerson.set(row.destinatario_clave,list);
    }
    const frequencies=[...byPerson.values()].map((list,i)=>({persona:`Persona ${i+1}`,enviados:list.length,
      minimo_entre_mensajes_segundos:list.length>1?Math.min(...list.slice(1).map((row,index)=>(new Date(row.delivered_at)-new Date(list[index].delivered_at))/1000)):null,
      texto_repetido:list.length-new Set(list.map(row=>row.mensaje)).size}));
    const readiness=(await pool.query(`SELECT
      COUNT(*) FILTER(WHERE estado<>'delivered' AND cancelled_at IS NULL AND detalles->>'message_version' IS DISTINCT FROM '2')::int legacy_pending,
      COUNT(*) FILTER(WHERE cancelled_at IS NOT NULL AND detalles->>'message_version' IS DISTINCT FROM '2')::int legacy_cancelled,
      COUNT(*) FILTER(WHERE estado='pending' AND cancelled_at IS NULL AND detalles->>'message_version'='2')::int current_pending
      FROM mia_private_task_notifications WHERE detalles->>'supervisor'='true' AND batch_parent_id IS NULL`)).rows[0];
    return res.json({readonly:true,enabled:enabled(env),policy_version:2,readiness,enviados:rows.length,personas:byPerson.size,frecuencias:frequencies,muestras:samples});
  }));
  router.post('/tick',handler(async (req,res) => {
    if (!isSystemActor(req)) throw fail('El control global es exclusivo del proceso automático de Mía.',403);
    return res.json(await runMiaSupervisor(pool,{ dryRun:req.body?.dry_run !== false,env }));
  }));
  router.post('/conversacion',handler(async(req,res)=>{
    await currentActor(pool,req.wilson);
    const messageId=req.body?.message_id;
    if(typeof messageId!=='string'||!messageId.trim()||messageId.length>200) throw fail('Falta el identificador real del mensaje.');
    const actorHash=crypto.createHash('sha256').update(String(req.wilson.actorId).replace(/^\+/, '')).digest('hex');
    await pool.query(`INSERT INTO mia_supervisor_inbound(actor_hash,last_inbound_at,message_id) VALUES($1,NOW(),$2)
      ON CONFLICT(actor_hash) DO UPDATE SET last_inbound_at=EXCLUDED.last_inbound_at,message_id=EXCLUDED.message_id
      WHERE mia_supervisor_inbound.message_id<>EXCLUDED.message_id`,[actorHash,messageId]);
    return res.json({paused_proactive:true});
  }));
  router.get('/contexto',handler(async (req,res) => {
    const actor = await currentActor(pool,req.wilson);
    const snapshot = await loadSnapshot(pool);
    const tasks = snapshot.tasks.filter(supervisorTaskActive).filter((task) => isSupervisorLeader(actor) || userOwnsSupervisorTask(actor,task) || supervisorBlockerAllowed(actor,task));
    const proposals = await pool.query(`SELECT id,tarea_id,to_char(fecha,'YYYY-MM-DD') fecha,razon FROM mia_supervisor_proposals WHERE estado='pending' AND tarea_id=ANY($1::integer[])`, [tasks.map((t) => Number(t.id))]);
    return res.json({ scope:isSupervisorLeader(actor)?'leader':'employee',tasks:tasks.map((t) => ({ id:t.id,titulo:t.titulo,cliente:t.cliente_nombre,estado:t.estado,fecha_vencimiento:t.fecha_vencimiento,prioridad:t.prioridad,dependencia:t.tarea_padre_id })),proposals:proposals.rows,
      reasoning_model:env.MIA_SUPERVISOR_REASONING_MODEL || 'gpt-6.1-sol', instruction:'Mía coordina. El supervisor opera por reglas comprobables. Usá el modelo indicado para recomendar prioridades y desbloqueos complejos; no inventes roles, fechas acordadas ni respuestas. Solo tareas, sin finanzas ni listas privadas.' });
  }));
  router.post('/tareas/:id/fecha',handler(async (req,res) => res.json(await acceptSupervisorDeadline(pool,{ actor:req.wilson,taskId:Number(req.params.id),proposalId:req.body?.proposal_id,date:req.body?.fecha,messageId:req.body?.message_id,env }))));
  router.post('/tareas/:id/respuesta',handler(async (req,res) => res.json(await recordSupervisorReply(pool,{ actor:req.wilson,taskId:Number(req.params.id),messageId:req.body?.message_id,input:req.body || {},env }))));
  router.post('/tareas/:id/bloqueo',handler(async (req,res) => res.json(await recordSupervisorBlockerReply(pool,{ actor:req.wilson,taskId:Number(req.params.id),messageId:req.body?.message_id,input:req.body || {},env }))));
  return router;
}
