import crypto from 'node:crypto';
import { lockFeedbackActor } from './feedback-receipts.js';
import { isProductionVisitTask, isValidProductionDate } from './production-visits.js';
import { lockProductionObjectiveLinks, rejectLegacyProductionSource } from './production-editorial.js';
import { productionValueHash } from './production-history-hash.js';

const OPERATION = 'wilson_video_editing_v1';
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const hidden = task => ['archivada_render_os', 'papelera_render_os'].some(key => [true, 'true'].includes(task?.propiedades_extra?.[key]));
const reconciliation = () => fail('El origen agregado no identifica un video. Consultá /produccion/visitas/:visitaId/videos y elegí visita_id/video_id canónicos. Si la visita es histórica, requiere conciliación explícita en Producciones; no se creó ninguna tarea.', 409, 'WILSON_VIDEO_RECONCILIATION_REQUIRED');

/** Main must call BEFORE closed-intent parsing in /tareas/validar,
 * /confirmaciones and /tareas. Never reinterpret a legacy parent as a video.
 */
export function assertNoLegacyWilsonEditingSource(body) {
  for (const input of [body, body?.payload]) {
    if (input && typeof input === 'object' && ['tarea_origen_id', 'tarea_padre_id', 'origen_visita_parcial_id'].some(key => Object.hasOwn(input, key))) throw reconciliation();
  }
}

export function normalizeWilsonVideoEditingIntent(body, { confirmation = false } = {}) {
  assertNoLegacyWilsonEditingSource(body);
  const fields = ['visita_id', 'video_id', 'expected_revision', 'editor_id', 'fecha_entrega', 'notificar_asignacion', ...(confirmation ? ['confirmacion_token'] : [])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw fail('Campos de edición por video no permitidos.');
  if (!uuid(body.visita_id) || !uuid(body.video_id)) throw reconciliation();
  if (!positive(body.expected_revision) || !positive(body.editor_id)) throw fail('Elegí revisión observada y editor por ID explícitos.');
  if (typeof body.fecha_entrega !== 'string' || !isValidProductionDate(body.fecha_entrega)) throw fail('Elegí fecha_entrega válida YYYY-MM-DD.');
  if (Object.hasOwn(body, 'notificar_asignacion') && typeof body.notificar_asignacion !== 'boolean') throw fail('notificar_asignacion debe ser booleano.');
  if (confirmation && !uuid(body.confirmacion_token)) throw fail('Falta confirmacion_token válido.');
  return Object.freeze({ visita_id: body.visita_id.toLowerCase(), video_id: body.video_id.toLowerCase(),
    expected_revision: body.expected_revision, editor_id: body.editor_id, fecha_entrega: body.fecha_entrega,
    notificar_asignacion: body.notificar_asignacion ?? true });
}

// One statement observes source/video/task together. Raw rows never become DTOs.
const OBSERVE = `SELECT v.id AS visita_id,v.revision,v.cliente_id,c.nombre AS cliente_nombre,c.activo AS cliente_activo,
  v.tarea_origen_id,v.drive_url,pv.id AS video_id,pv.estado AS video_estado,pv.titulo AS video_titulo,
  pv.guion,pv.material_url,pv.video_origen_id,pv.publicacion_id,pv.tarea_entrega_id,
  pv.tarea_edicion_id,pv.editor_id,to_char(pv.fecha_entrega,'YYYY-MM-DD') AS fecha_entrega,
  CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'revision',s.revision,'cliente_id',s.cliente_id,
    'titulo',s.titulo,'tipo_tarea',s.tipo_tarea,'subtipo',s.subtipo,'propiedades_extra',s.propiedades_extra) END AS source,
  CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'revision',t.revision,'cliente_id',t.cliente_id,
    'tipo_tarea',t.tipo_tarea,'estado',t.estado,'material_referencia',t.material_referencia,
    'fecha_vencimiento',to_char(t.fecha_vencimiento,'YYYY-MM-DD'),'propiedades_extra',t.propiedades_extra,
    'owner_id',(SELECT a.usuario_id FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.tipo='responsable' LIMIT 1)) END AS task
  FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id
  JOIN produccion_videos pv ON pv.visita_id=v.id
  LEFT JOIN tareas s ON s.id=v.tarea_origen_id LEFT JOIN tareas t ON t.id=pv.tarea_edicion_id
  WHERE v.id=$1 AND pv.id=$2`;

function materialOf(row) {
  const value = row.material_url || row.drive_url;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error();
    return value;
  } catch { throw fail('Vinculá material HTTP(S) válido al video o la visita.', 409); }
}

async function observe(db, intent, { expectedRevision = true } = {}) {
  const row = (await db.query(OBSERVE, [intent.visita_id, intent.video_id])).rows[0];
  if (!row) throw fail('Video no encontrado en esta visita.', 404);
  if (row.cliente_activo !== true) throw fail('El cliente ya no está activo.', 409);
  if (expectedRevision && row.revision !== intent.expected_revision) throw fail('La visita cambió. Prepará un resumen nuevo.', 409);
  if (row.video_estado !== 'grabado') throw fail('El video debe estar grabado; no hace falta completar toda la visita.', 409);
  if (row.tarea_origen_id && (!row.source || row.source.id !== row.tarea_origen_id || row.source.cliente_id !== row.cliente_id
    || row.source.propiedades_extra?.workspace !== 'render_os' || hidden(row.source) || !isProductionVisitTask(row.source))) throw fail('La visita origen cambió o está archivada/en papelera.', 409);
  try {
    await rejectLegacyProductionSource(db, { id: row.visita_id, tarea_origen_id: row.tarea_origen_id }, row.source, row.video_id);
  } catch (error) {
    if (error.status === 409) throw reconciliation();
    throw error;
  }
  const material = materialOf(row);
  if (row.tarea_edicion_id && (!row.task || row.task.id !== row.tarea_edicion_id || row.task.cliente_id !== row.cliente_id
    || row.task.tipo_tarea !== 'edicion' || row.task.propiedades_extra?.workspace !== 'render_os' || hidden(row.task)
    || row.task.propiedades_extra?.origen_produccion_video_id !== row.video_id
    || row.task.propiedades_extra?.produccion_visita_id !== row.visita_id
    || row.task.material_referencia !== material || row.task.owner_id !== intent.editor_id
    || row.task.fecha_vencimiento !== intent.fecha_entrega || row.editor_id !== intent.editor_id || row.fecha_entrega !== intent.fecha_entrega)) throw fail('La edición vinculada cambió. Revisá su cliente, material, editor y fecha.', 409);
  return row;
}

async function editor(db, id) {
  const row = (await db.query("SELECT id,nombre,rol FROM usuarios WHERE id=$1 AND activo IS TRUE AND rol IN ('admin','edicion') FOR SHARE", [id])).rows[0];
  if (!row) throw fail('Elegí un editor activo por ID.', 409);
  return row;
}

function capture(request) {
  const wilson = Object.freeze({ ...request.wilson });
  if (wilson.channel !== 'whatsapp' || wilson.privateChat !== true || wilson.systemActor || !positive(wilson.userId)) throw fail('Esta operación requiere WhatsApp privado y una identidad humana vinculada.', 403);
  return wilson;
}

async function transact(pool, wilson, work) {
  if (typeof pool?.connect !== 'function') throw new TypeError('Transactional pool.connect is required for video editing.');
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const actor = await lockFeedbackActor(db, wilson);
    if (actor.rol !== 'admin') throw fail('Solo administración puede asignar edición por video.', 403);
    const result = await work(db, actor);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally { db.release(discard); }
}

const intentHash = (intent, userId) => productionValueHash({ operation: OPERATION, userId, intent });
const observationHash = (row, person) => productionValueHash({ row, editor: person });

/**
 * Integration (Main owns Wilson router + CLI):
 * registerWilsonVideoEditingRoutes(router, { pool, dispatchProductionVideoEditing, notifyAssignment? })
 * Call AFTER requireWilsonService (signature v2) and resolveWilsonUser. No HTTP
 * self-request, environment lookup, new table, browser credential or system actor.
 *
 * REQUIRED canonical dependency, extracted by Main from production-registry:
 * async dispatchProductionVideoEditing(db, auth, input, { beforeDispatch })
 * input={visita_id,video_id,expected_revision,editor_id,fecha_entrega}.
 * Uses existing ordered global/task/visit/video locks, ID assignments, title,
 * lineage, material/client checks and replay semantics. Does NOT BEGIN/COMMIT,
 * notify, or swallow callback errors. MUST await beforeDispatch({db,visit,video})
 * AFTER locking the source AND existing editing task in canonical task-ID order
 * (before visit/video), and BEFORE either replay return OR mutation. Holds these
 * locks until our COMMIT. Missing/late callback fails closed (rollback).
 * Returns {created,task,visita}. Our observation rejects drift/trash even on replay.
 *
 * Notification default true, visible/bound in preview. false suppresses only the
 * optional post-commit assignment notifier, not audit/authority. No notifier on
 * replay; notifier failure never changes a committed ACK. No title override.
 */
export function registerWilsonVideoEditingRoutes(router, { pool, dispatchProductionVideoEditing, notifyAssignment } = {}) {
  // Registration must remain inert for read-only router fixtures. The lease is
  // required only when a video route actually invokes a transaction.
  if (!pool || (typeof pool.query !== 'function' && typeof pool.connect !== 'function') || typeof dispatchProductionVideoEditing !== 'function') throw new TypeError('Canonical video dispatch and pool are required.');
  const handle = fn => async (req, res, next) => {
    try { return await fn(req, res); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      if (error.code === '23505') return res.status(409).json({ error: 'El video ya tiene otro vínculo. Recargá Producciones.' });
      return next(error);
    }
  };

  router.get('/produccion/visitas/:visitaId/videos', handle(async (req, res) => {
    const wilson = capture(req), id = req.params.visitaId;
    if (!uuid(id)) throw reconciliation();
    const result = await transact(pool, wilson, async db => {
      const rows = (await db.query(`SELECT v.id,v.revision,v.cliente_id,c.nombre AS cliente_nombre,
        pv.id AS video_id,pv.titulo,pv.estado,pv.tarea_edicion_id,pv.editor_id,to_char(pv.fecha_entrega,'YYYY-MM-DD') AS fecha_entrega
        FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id LEFT JOIN produccion_videos pv ON pv.visita_id=v.id
        WHERE v.id=$1 AND c.activo IS TRUE AND (v.tarea_origen_id IS NULL OR EXISTS(SELECT 1 FROM tareas s WHERE s.id=v.tarea_origen_id
          AND s.propiedades_extra->>'workspace'='render_os' AND s.cliente_id=v.cliente_id
          AND s.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
          AND s.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true')) ORDER BY pv.id`, [id.toLowerCase()])).rows;
      if (!rows.length) throw fail('Visita no disponible.', 404);
      return { visita_id: rows[0].id, expected_revision: rows[0].revision, cliente_id: rows[0].cliente_id,
        cliente_nombre: rows[0].cliente_nombre, videos: rows.filter(row => row.video_id).map(row => ({ video_id: row.video_id,
          titulo: row.titulo, estado: row.estado, tarea_edicion_id: row.tarea_edicion_id, editor_id: row.editor_id, fecha_entrega: row.fecha_entrega })),
        instruction: 'Elegí un video grabado, editor_id activo y fecha_entrega explícitos; previsualizá y confirmá. Un conteo histórico requiere conciliación, no crea edición.' };
    });
    return res.json(result);
  }));

  router.post('/produccion/edicion/previsualizar', handle(async (req, res) => {
    const wilson = capture(req), intent = normalizeWilsonVideoEditingIntent(req.body);
    const result = await transact(pool, wilson, async (db, actor) => {
      await lockProductionObjectiveLinks(db);
      const row = await observe(db, intent), person = await editor(db, intent.editor_id);
      const token = crypto.randomUUID();
      const payload = { version: 1, user_id: actor.id, intent, observation: observationHash(row, person) };
      const saved = (await db.query(`INSERT INTO integracion_confirmaciones
        (token,integracion,canal,actor_id,grupo_id,operacion,payload_hash,expires_at,payload,informante_actor_id,informante_actor_nombre)
        VALUES($1,'wilson','whatsapp',$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',$6::jsonb,$2,$7) RETURNING expires_at`,
      [token, wilson.actorId, wilson.groupId || '', OPERATION, intentHash(intent, actor.id), JSON.stringify(payload), actor.nombre])).rows[0];
      return { confirmacion_token: token, expires_at: saved.expires_at, ...intent,
        summary: { cliente: row.cliente_nombre, video: row.video_titulo, editor: person.nombre, material: materialOf(row),
          fecha_entrega: intent.fecha_entrega, notificar_asignacion: intent.notificar_asignacion, tarea_existente_id: row.tarea_edicion_id ?? null },
        text: `Asignar edición de “${row.video_titulo}” (${row.cliente_nombre}) a ${person.nombre}, entrega ${intent.fecha_entrega}. Aviso de asignación: ${intent.notificar_asignacion ? 'sí' : 'no'}. No finaliza la visita ni publica contenido. ¿Confirmás?` };
    });
    return res.status(201).json(result);
  }));

  router.post('/produccion/edicion/confirmar', handle(async (req, res) => {
    const wilson = capture(req), intent = normalizeWilsonVideoEditingIntent(req.body, { confirmation: true });
    const token = req.body.confirmacion_token.toLowerCase();
    const committed = await transact(pool, wilson, async (db, actor) => {
      // Serialize same-token recovery before canonical locks; never hold a token
      // row while waiting for a task lock. Preview does not acquire this mutex.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${OPERATION}:${token}`]);
      const receipt = (await db.query(`SELECT payload,payload_hash,used_at FROM integracion_confirmaciones
        WHERE token=$1 AND integracion='wilson' AND canal='whatsapp' AND actor_id=$2 AND grupo_id=$3 AND operacion=$4`,
      [token, wilson.actorId, wilson.groupId || '', OPERATION])).rows[0];
      if (!receipt || receipt.payload_hash !== intentHash(intent, actor.id) || receipt.payload?.user_id !== actor.id
        || productionValueHash(receipt.payload.intent) !== productionValueHash(intent)) throw fail('La confirmación no corresponde a esta intención y actor.', 409);
      const replay = receipt.used_at != null;
      if (replay && !positive(receipt.payload.task_id)) throw fail('La confirmación ya fue utilizada sin recibo recuperable.', 409);
      let guarded = false;
      const { notificar_asignacion, ...input } = intent;
      const result = await dispatchProductionVideoEditing(db, { id: actor.id, rol: actor.rol, nombre: actor.nombre, activo: true }, input, {
        beforeDispatch: async context => {
          if (guarded || context?.db !== db || context.visit?.id !== intent.visita_id || context.video?.id !== intent.video_id) throw fail('Despacho canónico sin contexto retenido.', 500);
          const row = await observe(db, intent, { expectedRevision: !replay }), person = await editor(db, intent.editor_id);
          if (observationHash(row, person) !== (replay ? receipt.payload.completed_observation : receipt.payload.observation)) throw fail('El resumen cambió. Previsualizá y confirmá nuevamente.', 409);
          if (replay && row.tarea_edicion_id !== receipt.payload.task_id) throw fail('El recibo ya no corresponde al video.', 409);
          if (!replay) {
            const claimed = await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp()
              WHERE token=$1 AND actor_id=$2 AND grupo_id=$3 AND operacion=$4 AND payload_hash=$5
              AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING token`,
            [token, wilson.actorId, wilson.groupId || '', OPERATION, receipt.payload_hash]);
            if (claimed.rows.length !== 1) throw fail('La confirmación venció o ya fue usada. Prepará otra.', 409);
          }
          guarded = true;
        },
      });
      if (!guarded || !positive(result?.task?.id) || (replay && (result.created !== false || result.task.id !== receipt.payload.task_id))) throw fail('Despacho sin confirmación canónica verificable.', 500);
      if (!replay) {
        const completed = await observe(db, intent, { expectedRevision: false });
        if (completed.tarea_edicion_id !== result.task.id) throw fail('El despacho no conservó el vínculo del video.', 500);
        await db.query('UPDATE integracion_confirmaciones SET payload=payload||$2::jsonb WHERE token=$1',
          [token, JSON.stringify({ task_id: result.task.id, completed_observation: observationHash(completed, await editor(db, intent.editor_id)) })]);
        await db.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,grupo_id,accion,tarea_id,resultado,detalles)
          VALUES('wilson','whatsapp',$1,$2,$3,$4,$5,'ok',$6::jsonb)`,
        [wilson.actorId, actor.nombre, wilson.groupId || null, OPERATION, result.task.id, JSON.stringify({ ...intent, actor_user_id: actor.id, token, created: result.created })]);
      }
      return { result, replay, actor };
    });
    if (!committed.replay && committed.result.created && intent.notificar_asignacion && notifyAssignment) {
      try { await notifyAssignment({ pool, tarea: committed.result.task, motivo: 'creada', actor: committed.actor.nombre, actorId: committed.actor.id }); }
      catch { /* Committed dispatch is authoritative; notification is best effort, never resent on replay. */ }
    }
    return res.status(committed.result.created ? 201 : 200).json({ ...committed.result, idempotent: committed.replay || !committed.result.created });
  }));
  return router;
}
