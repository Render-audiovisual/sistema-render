import { createHash, randomUUID } from 'node:crypto';
import { lockFeedbackActor } from './feedback-receipts.js';
import { annotateTaskAssignments } from './task-assignments.js';
import { isTaskFinalized, taskTransitionError } from './workflow-contract.js';
import { getProductionProgress, isProductionVisitTask } from './production-visits.js';
import { assertProductionTaskFinalization } from './production-task-finalization.js';

const OPERATION = 'finalizar_lote';
const CONTRACT = 'wilson-private-finalization-v1';
const LIMIT = 20;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const text = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function bodyOnly(body, field) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, field))
    throw fail('La operación requiere únicamente su selección explícita.');
  return body[field];
}

function idsFrom(values) {
  if (!Array.isArray(values) || !values.length || values.length > LIMIT) throw fail('Elegí entre 1 y 20 tareas.');
  const ids = values.map(value => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value);
  if (ids.some(id => !positive(id)) || new Set(ids).size !== ids.length) throw fail('Los IDs deben ser positivos y no repetidos.');
  return ids.sort((a,b) => a-b);
}

function capture(request) {
  const subject = Object.freeze({ ...request.wilson });
  // Crypto/exact-target verification is performed by the mandatory upstream
  // requireWilsonService middleware, never by this header alone.
  if (request.headers?.['x-wilson-signature-version'] !== '2') throw fail('Wilson requiere firma versión 2.', 401);
  const privateScope = typeof subject.actorId === 'string'
    ? `private:${sha(subject.actorId.replace(/^\+/, '')).slice(0,16)}` : '';
  if (subject.channel !== 'whatsapp' || subject.privateChat !== true || subject.groupId !== privateScope
      || !positive(subject.userId) || subject.systemActor || subject.groupParticipantOnly)
    throw fail('La finalización requiere una identidad humana vinculada en un chat privado.', 403);
  return subject;
}

function visible(task) {
  const properties = task.propiedades_extra;
  return properties?.workspace === 'render_os' && ![true,'true'].includes(properties.archivada_render_os)
    && ![true,'true'].includes(properties.papelera_render_os);
}

function owns(task, actor) {
  return actor.rol === 'admin' || task.asignado_a_id === actor.id || task.colaborador_ids.includes(actor.id);
}

function authorize(tasks, actor) {
  if (tasks.some(task => !visible(task))) throw fail('Una o más tareas no están disponibles.', 404);
  if (tasks.some(task => !owns(task, actor))) throw fail('La selección no pertenece a tu alcance actual.', 403);
  // Check even on receipt replay: taskTransitionError permits same-state no-ops.
  if (tasks.some(task => !['admin','community'].includes(actor.rol)
      && !(actor.rol === 'produccion' && isProductionVisitTask(task))))
    throw fail('Tu rol actual no permite finalizar esta selección.', 403);
}

function transition(task, actor) {
  if (isTaskFinalized(task)) throw fail('Una tarea ya fue finalizada. Prepará un listado nuevo.', 409);
  const error = taskTransitionError(task, 'finalizada', actor);
  if (error) throw fail(error.error, error.status);
}

function dto(task) {
  return { id:task.id, revision:task.revision, titulo:task.titulo, estado:task.estado,
    cliente_nombre:task.cliente_nombre ?? null, fecha_vencimiento:task.fecha_vencimiento ?? null,
    url:`/workspace/tareas?task=${task.id}` };
}

const fields = `t.id,t.revision,t.titulo,t.estado,t.tipo_tarea,t.subtipo,t.cliente_id,t.propiedades_extra,
  to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_vencimiento,c.nombre cliente_nombre`;

async function lockedTasks(db, ids, actor) {
  // All selected task locks precede ALL visit/video locks. Assignment writers
  // share these parent task locks; do not substitute historical display names.
  const rows = (await db.query(`SELECT ${fields} FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
    WHERE t.id=ANY($1::int[]) ORDER BY t.id FOR UPDATE OF t`, [ids])).rows;
  if (rows.length !== ids.length) throw fail('Una o más tareas no están disponibles.', 404);
  const tasks = await annotateTaskAssignments(db, rows);
  authorize(tasks, actor);
  return tasks;
}

async function observedVisit(db, task) {
  if (!isProductionVisitTask(task)) return null;
  const visit = (await db.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1 FOR UPDATE', [task.id])).rows[0];
  return visit ? {id:visit.id,revision:visit.revision} : null;
}

async function productionEvidence(db, task, visit) {
  if (!isProductionVisitTask(task)) return null;
  const progress = getProductionProgress(task);
  if (!visit) return {source:'legacy_aggregate',planned:progress.planned,recorded:progress.recorded};
  const videos = (await db.query('SELECT estado FROM produccion_videos WHERE visita_id=$1 ORDER BY id', [visit.id])).rows;
  return {source:'canonical_visit',visit_id:visit.id,visit_revision:visit.revision,planned:progress.planned,
    total:videos.length,recorded:videos.filter(video => video.estado === 'grabado').length};
}

function previewText(tasks, evidence) {
  const line = value => String(value).replace(/[\r\n\t]/g,' ');
  const lines = tasks.map((task,index) => {
    const production = evidence[index];
    const proof = !production ? '' : production.source === 'canonical_visit'
      ? ` — Visita ${production.visit_id}, revisión ${production.visit_revision}: ${production.recorded}/${production.total} videos grabados; previstos ${production.planned}`
      : ` — Registro histórico agregado: ${production.recorded} videos grabados; previstos ${production.planned}. Sin identidad canónica de video`;
    return `${index+1}. #${task.id} ${line(task.titulo)} — ${line(task.cliente_nombre ?? 'Sin cliente')} — Fecha: ${line(task.fecha_vencimiento ?? 'sin fecha')}${proof}`;
  });
  return `Voy a finalizar estas tareas:\n${lines.join('\n')}\n\nNo aprobaré trabajos ni publicaré piezas ni confirmaré visitas. ¿Confirmás este listado exacto?`;
}

const snapshot = (task, expectedVisit) => ({id:task.id,revision:task.revision,estado:task.estado,
  asignado_a_id:task.asignado_a_id,colaborador_ids:[...task.colaborador_ids].sort((a,b) => a-b),
  expected_production_visit:expectedVisit});
const basePayload = payload => ({contract:payload?.contract,actor_user_id:payload?.actor_user_id,
  actor_role:payload?.actor_role,actor_id:payload?.actor_id,private_scope:payload?.private_scope,tasks:payload?.tasks});
const payloadHash = payload => sha(stable(basePayload(payload)));

async function transaction(pool, subject, work) {
  let db, discard;
  try {
    db = await pool.connect();
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const actor = await lockFeedbackActor(db, subject);
    // Exact human and role are read and retained before any batch/domain lock.
    if (actor.id !== subject.userId) throw fail('La identidad cambió.', 403);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [JSON.stringify([CONTRACT,subject.actorId,subject.groupId])]);
    const result = await work(db, actor);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    if (db) try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally { db?.release(discard); }
}

/**
 * Register AFTER requireWilsonService(v2 exact target) + resolveWilsonUser.
 * Optional assignment notifier runs after commit, only on first execution.
 * No environment lookup, provider or publication callback. Token is the idempotency key.
 * Confirmation payload stores both immutable intent and an atomic receipt.
 */
export function registerWilsonFinalizationRoutes(router, { pool, notifyAssignment }) {
  router.post('/tareas/resolver-finalizacion', async (request, res, next) => {
    try {
      const subject = capture(request), references = bodyOnly(request.body, 'referencias');
      if (!Array.isArray(references) || !references.length || references.length > LIMIT
          || references.some(value => typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)))
        throw fail('Indicá entre 1 y 20 referencias válidas.');
      const captured = references.map(value => value.trim());
      const result = await transaction(pool, subject, async (db, actor) => {
        const tasks = (await db.query(`SELECT ${fields} FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
          WHERE t.propiedades_extra->>'workspace'='render_os'
            AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
            AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
            AND t.estado IN ('pendiente','en_progreso','en_revision','aprobada')
            AND ($1::boolean OR EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=$2))
          ORDER BY t.id`, [actor.rol === 'admin',actor.id])).rows;
        const results = captured.map(reference => {
          const numeric = /^#?[1-9]\d*$/.test(reference) ? Number(reference.replace(/^#/,'')) : null;
          const query = text(reference);
          const matches = tasks.filter(task => numeric !== null ? task.id === numeric
            : query && text(`${task.titulo} ${task.cliente_nombre ?? ''}`).includes(query));
          return {reference,status:matches.length === 1 ? 'resolved' : matches.length ? 'ambiguous' : 'not_found',
            matches:matches.slice(0,LIMIT).map(task => ({...dto(task),
              puede_finalizar:!taskTransitionError(task,'finalizada',actor),
              requiere_validacion_produccion:isProductionVisitTask(task)}))};
        });
        return {results,task_ids:[...new Set(results.filter(row => row.status === 'resolved').map(row => row.matches[0].id))],
          can_preview:results.every(row => row.status === 'resolved' && row.matches[0].puede_finalizar),
          updated:false,text:'No finalicé ninguna tarea. La previsualización valida aprobación y evidencia de producción.'};
      });
      return res.json(result);
    } catch (error) { return next(error); }
  });

  router.post('/lotes/finalizacion/previsualizar', async (request, res, next) => {
    try {
      const subject = capture(request), ids = idsFrom(bodyOnly(request.body, 'task_ids'));
      const result = await transaction(pool, subject, async (db, actor) => {
        const tasks = await lockedTasks(db,ids,actor), snapshots = [], evidence = [];
        for (const task of tasks) {
          transition(task,actor);
          const expected = await observedVisit(db,task);
          await assertProductionTaskFinalization(db,task,task,expected ?? undefined);
          snapshots.push(snapshot(task,expected));
          evidence.push(await productionEvidence(db,task,expected));
        }
        const payload = {contract:CONTRACT,actor_user_id:actor.id,actor_role:actor.rol,
          actor_id:subject.actorId,private_scope:subject.groupId,tasks:snapshots};
        const token = randomUUID();
        // Conversation corrections replace ONLY outstanding previews, never
        // already committed receipts. Same actor/private gate serializes both.
        await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
          WHERE integracion='wilson' AND canal='whatsapp' AND actor_id=$1 AND grupo_id=$2
            AND operacion='finalizar_lote' AND used_at IS NULL`, [subject.actorId,subject.groupId]);
        const inserted = await db.query(`INSERT INTO integracion_confirmaciones
          (token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at,
            payload,informante_actor_id,informante_actor_nombre)
          VALUES($1,'wilson','whatsapp',$2,$3,'finalizar_lote',NULL,$4,clock_timestamp()+interval '15 minutes',$5::jsonb,$2,$6)
          RETURNING expires_at`, [token,subject.actorId,subject.groupId,payloadHash(payload),JSON.stringify(payload),actor.nombre]);
        return {confirmacion_token:token,expires_at:new Date(inserted.rows[0].expires_at).toISOString(),
          task_ids:ids,tasks:tasks.map((task,index) => ({...dto(task),expected_production_visit:snapshots[index].expected_production_visit,
            production_evidence:evidence[index]})),updated:false,text:previewText(tasks,evidence)};
      });
      return res.status(201).json(result);
    } catch (error) { return next(error); }
  });

  router.post('/lotes/finalizacion/confirmar', async (request, res, next) => {
    try {
      let postCommit;
      const subject = capture(request), token = bodyOnly(request.body,'confirmacion_token');
      if (typeof token !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) throw fail('Falta una confirmación válida.');
      const result = await transaction(pool, subject, async (db, actor) => {
        const scope = [token,subject.actorId,subject.groupId];
        // No TTL predicate before row lock: waiting may invalidate it. Same
        // actor/private scope is required even for admins and receipt replay.
        const confirmation = (await db.query(`SELECT token,payload,payload_hash,used_at FROM integracion_confirmaciones
          WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3
            AND operacion='finalizar_lote' AND tarea_id IS NULL FOR UPDATE`, scope)).rows[0];
        if (!confirmation) throw fail('La confirmación no está disponible para este actor.',409);
        const payload = confirmation.payload;
        if (payload?.contract !== CONTRACT || payload.actor_user_id !== actor.id || payload.actor_role !== actor.rol
            || payload.actor_id !== subject.actorId || payload.private_scope !== subject.groupId)
          throw fail('La identidad o el rol cambió. Prepará una confirmación nueva.',403);
        if (confirmation.payload_hash !== payloadHash(payload)) throw fail('La intención de finalización cambió.',409);
        const ids = idsFrom(payload.tasks?.map(task => task.id));
        if (stable(ids) !== stable(payload.tasks.map(task => task.id))) throw fail('La selección almacenada no es válida.',409);
        const tasks = await lockedTasks(db,ids,actor);
        if (confirmation.used_at) {
          const receipt = payload.receipt;
          if (!receipt || receipt.contract !== CONTRACT || stable(receipt.task_ids) !== stable(ids)
              || receipt.actor_user_id !== actor.id || !Array.isArray(receipt.tasks)
              || receipt.tasks.length !== ids.length) throw fail('La confirmación ya fue usada sin recibo compatible.',409);
          return {updated:false,idempotent:true,task_ids:ids,receipt,
            text:'Esta finalización ya fue confirmada. No modifiqué nuevamente las tareas ni publiqué piezas.'};
        }
        for (let index=0;index<tasks.length;index++) {
          const task = tasks[index], observed = payload.tasks[index];
          transition(task,actor);
          if (stable(snapshot(task,observed.expected_production_visit)) !== stable(observed))
            throw fail('La revisión o asignación del listado cambió. Prepará una confirmación nueva.',409);
          await assertProductionTaskFinalization(db,task,task,observed.expected_production_visit ?? undefined);
        }
        // Claim AFTER actor, scope, token, task and production waits. The claim,
        // task CAS, audit and receipt all roll back together on any failure.
        const claimed = (await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
          WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3
            AND operacion='finalizar_lote' AND tarea_id IS NULL AND payload_hash=$4
            AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING used_at`, [...scope,confirmation.payload_hash])).rows[0];
        if (!claimed) throw fail('La confirmación venció o fue usada. Prepará una nueva.',409);
        const finalizedAt = new Date(claimed.used_at).toISOString(), completed = [];
        for (let index=0;index<tasks.length;index++) {
          const source = tasks[index];
          const task = (await db.query(`UPDATE tareas SET estado='finalizada',updated_at=clock_timestamp(),
            propiedades_extra=propiedades_extra||$3::jsonb WHERE id=$1 AND revision=$2
            RETURNING id,revision,estado,titulo,tipo_tarea,subtipo,propiedades_extra`,
          [source.id,source.revision,JSON.stringify({finalizada_at:finalizedAt,origen_integracion:'wilson',
            mia_finalizada_por_id:actor.id,mia_finalizada_por:actor.nombre})])).rows[0];
          if (!task) throw fail('La tarea cambió antes de finalizarse.',409);
          await assertProductionTaskFinalization(db,task,source,payload.tasks[index].expected_production_visit ?? undefined);
          await db.query(`INSERT INTO integracion_auditoria
            (integracion,canal,actor_id,actor_nombre,grupo_id,accion,tarea_id,resultado,detalles)
            VALUES('wilson','whatsapp',$1,$2,$3,'finalizar_tarea_desde_mia',$4,'ok',$5::jsonb)`,
          [subject.actorId,actor.nombre,subject.groupId,source.id,JSON.stringify({actor_user_id:actor.id,
            previous_revision:source.revision,task_revision:task.revision,previous_state:source.estado})]);
          completed.push({id:task.id,revision:task.revision,estado:task.estado});
        }
        const receipt = {contract:CONTRACT,actor_user_id:actor.id,task_ids:ids,tasks:completed,confirmed_at:finalizedAt};
        const stored = await db.query(`UPDATE integracion_confirmaciones SET payload=jsonb_set(payload,'{receipt}',$4::jsonb,true)
          WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3
            AND operacion='finalizar_lote' AND used_at IS NOT NULL RETURNING token`, [...scope,JSON.stringify(receipt)]);
        if (stored.rows.length !== 1) throw fail('No se pudo guardar el recibo de finalización.',409);
        postCommit = { actor: { id: actor.id, nombre: actor.nombre }, tasks: completed.map((task,index) => ({...tasks[index],...task})) };
        return {updated:true,idempotent:false,task_ids:ids,receipt,
          text:`Finalicé ${ids.length} tarea(s). No publiqué piezas ni confirmé visitas.`};
      });
      if (postCommit && notifyAssignment) {
        // Restore the operational leader notice without treating transport
        // labels as identities. Notification failure cannot undo the receipt,
        // trigger a mutation retry or cause renotification on replay.
        try {
          const leaders = (await pool.query("SELECT id FROM usuarios WHERE activo IS TRUE AND rol='admin' ORDER BY id")).rows.map(row => row.id);
          for (const task of postCommit.tasks) {
            try { await notifyAssignment({ pool, tarea: task, motivo: 'finalizada', destinatarioIds: leaders,
              actorId: postCommit.actor.id, actor: postCommit.actor.nombre }); }
            catch { /* The task is already committed. */ }
          }
        } catch { /* Best-effort notification, never report a committed close as failed. */ }
      }
      return res.json(result);
    } catch (error) { return next(error); }
  });
  return router;
}
