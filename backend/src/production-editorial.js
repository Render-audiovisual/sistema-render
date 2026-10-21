import { isValidProductionDate } from './production-visits.js';
import { isReconciledProductionVideo } from './production-history.js';
import { findProductionAdoptedEditingTask } from './production-editing-adoption.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const stamp = value => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const version = (actual, expected) => actual != null && typeof expected === 'string'
  && Number.isFinite(Date.parse(expected)) && stamp(actual) === stamp(expected);
const period = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const hidden = task => ['archivada_render_os', 'papelera_render_os'].some(key => [true, 'true'].includes(task?.propiedades_extra?.[key]));
const usable = task => task && task.estado === 'pendiente' && task.propiedades_extra?.workspace === 'render_os'
  && !hidden(task) && !task.historia_id && task.tipo_tarea !== 'produccion';
const SLOT = `SELECT s.*,o.clave,o.cuentas,to_char(o.periodo,'YYYY-MM') periodo,
  (s.numero <= CASE s.tipo WHEN 'video' THEN o.reels ELSE o.carruseles END) en_cuota
  FROM cliente_objetivo_piezas s JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id`;
const PUBLICATION = `SELECT p.*,to_char(p.fecha_programada,'YYYY-MM-DD') fecha_programada FROM publicaciones p`;

export async function lockProductionObjectiveLinks(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
}

export async function hasLegacyProductionSource(db, sourceId, source) {
  if (!sourceId) return false;
  const records = source?.propiedades_extra?.produccion_registros;
  // Malformed historical data is not proof that the source is empty/convertible.
  if ((records != null && (!Array.isArray(records) || records.length > 0))
    || source?.propiedades_extra?.produccion_confirmada_at) return true;
  return (await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 LIMIT 1", [String(sourceId)])).rows.length > 0;
}

export async function rejectLegacyProductionSource(db, visit, source, videoId = null) {
  // A persisted review keeps this exact source/visit historical even when its
  // mutable production metadata/children disappear. Operational detection above
  // intentionally remains unchanged for source synchronization callers.
  const requiresReview = await hasLegacyProductionSource(db, visit.tarea_origen_id, source)
    || (visit.tarea_origen_id != null && (await db.query(
      'SELECT id FROM produccion_reconciliaciones WHERE visita_id=$1 AND tarea_origen_id=$2 LIMIT 1',
      [visit.id, visit.tarea_origen_id],
    )).rows.length > 0);
  if (requiresReview) {
    if (await isReconciledProductionVideo(db,visit,source,videoId)) return;
    throw fail('La visita tiene producción agregada histórica. Requiere revisión manual antes de vincular o enviar edición por video.');
  }
}

/** Serializes every association and lineage continuation before any row lock. */
export async function assertProductionLineageAvailable(db, videoId, { includeSelf = false } = {}) {
  const linked = await db.query(`WITH RECURSIVE familia AS (
    SELECT id,video_origen_id FROM produccion_videos WHERE id=$1
    UNION
    SELECT v.id,v.video_origen_id FROM produccion_videos v JOIN familia f
      ON v.id=f.video_origen_id OR v.video_origen_id=f.id
  ) SELECT v.id FROM produccion_videos v JOIN familia f ON f.id=v.id
    WHERE ($2::boolean OR v.id<>$1) AND v.publicacion_id IS NOT NULL LIMIT 1`, [videoId,includeSelf]);
  if (linked.rows.length) throw fail('Esta cadena ya está vinculada a una pieza. No se puede retomar sin una transferencia explícita auditada.');
}

/** Discovery is unlocked; every reference is compared again after ordered locks. */
export async function lockProductionEditorialContext(db, visitId, videoId, selection, { lockVisit }) {
  await lockProductionObjectiveLinks(db);
  const before = (await db.query(`SELECT pv.*,v.tarea_origen_id FROM produccion_videos pv
    JOIN produccion_visitas v ON v.id=pv.visita_id WHERE pv.id=$1 AND pv.visita_id=$2`, [videoId, visitId])).rows[0];
  if (!before) throw fail('Video no encontrado en esta visita.', 404);
  const taskId = selection.tarea_id ?? before.tarea_entrega_id;
  const publicationId = selection.publicacion_id ?? before.publicacion_id;
  const slots = (await db.query(`${SLOT} WHERE s.id=$1 OR s.tarea_id=$2 OR s.publicacion_id=$3 ORDER BY s.id`,
    [selection.objetivo_pieza_id ?? null, taskId ?? null, publicationId ?? null])).rows;
  if (slots.length > 1) throw fail('La tarea y la pieza pertenecen a casilleros diferentes.');
  const discovered = slots[0];
  if (discovered) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`objetivo:${discovered.periodo}:${discovered.clave}`]);
  const adoptedTaskId=await findProductionAdoptedEditingTask(db,visitId);
  const ids = [...new Set([before.tarea_origen_id, before.tarea_edicion_id, before.tarea_entrega_id, taskId, discovered?.tarea_id, adoptedTaskId].filter(positive))].sort((a,b) => a-b);
  const tasks = (await db.query('SELECT t.* FROM tareas t WHERE t.id=ANY($1::int[]) ORDER BY t.id FOR UPDATE', [ids])).rows;
  const publication = publicationId ? (await db.query(`${PUBLICATION} WHERE p.id=$1 FOR UPDATE OF p`, [publicationId])).rows[0] : null;
  const slot = discovered ? (await db.query(`${SLOT} WHERE s.id=$1 FOR UPDATE OF s`, [discovered.id])).rows[0] : null;
  const visit = await lockVisit(db, visitId);
  const video = (await db.query('SELECT * FROM produccion_videos WHERE id=$1 AND visita_id=$2 FOR UPDATE', [videoId, visitId])).rows[0];
  if (!video) throw fail('Video no encontrado en esta visita.', 404);
  for (const key of ['publicacion_id','tarea_entrega_id','tarea_edicion_id']) {
    if ((video[key] ?? null) !== (before[key] ?? null)) throw fail('El vínculo cambió. Recargá la visita.');
  }
  if (visit.tarea_origen_id !== before.tarea_origen_id || (discovered && (!slot || slot.tarea_id !== discovered.tarea_id || slot.publicacion_id !== discovered.publicacion_id))) throw fail('El origen o el objetivo cambió. Recargá los datos.');
  // Goal creation also takes the global lock. Catch writers attaching a different slot during discovery.
  const fresh = (await db.query(`${SLOT} WHERE s.tarea_id=$1 OR s.publicacion_id=$2 ORDER BY s.id`, [taskId ?? null, publicationId ?? null])).rows;
  if (fresh.some(row => row.id !== slot?.id)) throw fail('La pieza o tarea cambió de objetivo.');
  return { visit, video, task: tasks.find(row => row.id === taskId), publication, slot,
    source: tasks.find(row => row.id === visit.tarea_origen_id) };
}

function compatibleSlot(slot, task, visit, month) {
  if (!slot || slot.en_cuota !== true || slot.tipo !== 'video' || slot.estado !== 'pendiente' || slot.completada_at
    || slot.tarea_id !== task.id || slot.periodo !== month || slot.periodo < '2026-10'
    || !Array.isArray(slot.cuentas) || !slot.cuentas.some(account => account.id === visit.cliente_id)) throw fail('Cliente, mes, formato y tarea del casillero deben coincidir.');
}

async function assertCanonicalTask(db, task, publicationId, visit, video) {
  if (!usable(task) || task.cliente_id !== visit.cliente_id || task.id === visit.tarea_origen_id
    || (task.publicacion_id ?? null) !== (publicationId ?? null)) throw fail('La tarea canónica no está pendiente o no es compatible.');
  if (video.tarea_edicion_id && video.tarea_edicion_id !== task.id) throw fail('El video ya tiene otra tarea de edición. No se fusionan tareas.');
  const conflicts = await db.query(`SELECT id FROM produccion_videos WHERE id<>$1
    AND (publicacion_id=$2 OR COALESCE(tarea_entrega_id,tarea_edicion_id)=$3) LIMIT 1`, [video.id, publicationId, task.id]);
  if (conflicts.rows.length) throw fail('La pieza o tarea ya pertenece a otro video.');
  if (publicationId) {
    // Multiple workflow stages are legal, but automatic adoption must never guess.
    const tasks = (await db.query(`SELECT id FROM tareas WHERE publicacion_id=$1
      AND propiedades_extra->>'workspace'='render_os'
      AND propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true' ORDER BY id`, [publicationId])).rows;
    if (tasks.length !== 1 || tasks[0].id !== task.id) throw fail('La pieza tiene etapas ambiguas. Elegí una entrega canónica mediante revisión manual.');
  }
}

export function validateProductionEditorialSelection(body, emptySlot = false) {
  const allowed = ['expected_revision','tarea_id','expected_tarea_revision','objetivo_pieza_id','expected_objetivo_updated_at',
    ...(emptySlot ? ['fecha_programada'] : ['publicacion_id','expected_publicacion_updated_at'])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))
    || !positive(body.expected_revision) || !positive(body.tarea_id) || !positive(body.expected_tarea_revision)) throw fail('Selección o revisiones inválidas.', 400);
  const hasSlot = Object.hasOwn(body, 'objetivo_pieza_id');
  if ((emptySlot || hasSlot) && (!positive(body.objetivo_pieza_id) || typeof body.expected_objetivo_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_objetivo_updated_at)))) throw fail('Falta la versión del casillero.', 400);
  if (!hasSlot && Object.hasOwn(body,'expected_objetivo_updated_at')) throw fail('Falta el casillero.',400);
  if (emptySlot ? typeof body.fecha_programada !== 'string' || !isValidProductionDate(body.fecha_programada)
    : !positive(body.publicacion_id) || typeof body.expected_publicacion_updated_at !== 'string' || !Number.isFinite(Date.parse(body.expected_publicacion_updated_at))) throw fail('Pieza o fecha de programación inválida.', 400);
  return body;
}

export async function associateProductionEditorial(db, visitId, videoId, body, actorId, deps, emptySlot = false) {
  validateProductionEditorialSelection(body, emptySlot);
  const context = await lockProductionEditorialContext(db, visitId, videoId, body, deps);
  const { visit,video,task,slot } = context;
  let { publication } = context;
  await rejectLegacyProductionSource(db, visit, context.source, video.id);
  await assertProductionLineageAvailable(db, video.id);
  const result = async created => ({ visita: (await deps.readVisits(db,'WHERE v.id=$1',[visit.id]))[0],
    publicacion_id: publication.id, tarea_id: task.id, objetivo_pieza_id: slot?.id ?? null, created });
  if (video.publicacion_id) {
    if (video.tarea_entrega_id !== body.tarea_id || (!emptySlot && video.publicacion_id !== body.publicacion_id)
      || (slot?.id ?? null) !== (body.objetivo_pieza_id ?? null) || !publication || !task
      || (emptySlot && publication.fecha_programada !== body.fecha_programada)) throw fail('El video ya tiene otro vínculo.');
    return result(false);
  }
  if (visit.revision !== body.expected_revision || !task || task.revision !== body.expected_tarea_revision) throw fail('La visita o tarea cambió. Recargá sus versiones.');
  if ((slot?.id ?? null) !== (body.objetivo_pieza_id ?? null)
    || (slot && !version(slot.updated_at, body.expected_objetivo_updated_at))) throw fail('Confirmá el casillero actual y su versión.');
  await deps.activeClient(db,visit.cliente_id);
  if (emptySlot) {
    compatibleSlot(slot,task,visit,body.fecha_programada.slice(0,7));
    if (slot.publicacion_id || task.publicacion_id) throw fail('El casillero ya tiene una publicación.');
    await assertCanonicalTask(db,task,null,visit,video);
    publication = (await db.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
      VALUES($1,'video','pendiente',$2,$3,$4) RETURNING id,to_char(fecha_programada,'YYYY-MM-DD') fecha_programada`,
    [visit.cliente_id,body.fecha_programada,video.titulo,slot.copy || ''])).rows[0];
    await db.query('UPDATE tareas SET publicacion_id=$2,updated_at=now() WHERE id=$1',[task.id,publication.id]);
    await db.query('UPDATE cliente_objetivo_piezas SET publicacion_id=$2,updated_at=now() WHERE id=$1',[slot.id,publication.id]);
  } else {
    if (!publication || !version(publication.updated_at,body.expected_publicacion_updated_at)
      || publication.cliente_id !== visit.cliente_id || !['video','reel'].includes(publication.tipo)
      || publication.estado !== 'pendiente') throw fail('La publicación no está pendiente, cambió o es incompatible.');
    await assertCanonicalTask(db,task,publication.id,visit,video);
    if (slot) {
      compatibleSlot(slot,task,visit,publication.fecha_programada.slice(0,7));
      if (slot.publicacion_id !== publication.id) throw fail('La publicación no coincide con el casillero.');
    }
  }
  await db.query(`UPDATE produccion_videos SET publicacion_id=$3,tarea_entrega_id=$4,cliente_editorial_id=$5,
    actualizado_por_id=$6,updated_at=now() WHERE id=$1 AND visita_id=$2`, [video.id,visit.id,publication.id,task.id,visit.cliente_id,actorId]);
  await deps.bump(db,visit.id,actorId);
  return result(emptySlot);
}

export async function productionEditorialCandidates(db, visitId, videoId, month) {
  if (!period(month) || month < '2026-10') throw fail('Elegí un período YYYY-MM válido.',400);
  const current = (await db.query(`SELECT pv.*,v.cliente_id,v.tarea_origen_id FROM produccion_videos pv
    JOIN produccion_visitas v ON v.id=pv.visita_id WHERE pv.id=$1 AND pv.visita_id=$2`,[videoId,visitId])).rows[0];
  if (!current) throw fail('Video no encontrado en esta visita.',404);
  const actualSlot = current.publicacion_id ? (await db.query('SELECT id FROM cliente_objetivo_piezas WHERE publicacion_id=$1',[current.publicacion_id])).rows[0] : null;
  const actual = current.publicacion_id ? {publicacion_id:current.publicacion_id,tarea_entrega_id:current.tarea_entrega_id,
    ...(actualSlot ? {objetivo_pieza_id:actualSlot.id} : {})} : null;
  if (actual) return {actual,publicaciones:[],casilleros:[]};
  await assertProductionLineageAvailable(db,videoId);
  const source = current.tarea_origen_id ? (await db.query('SELECT propiedades_extra FROM tareas WHERE id=$1',[current.tarea_origen_id])).rows[0] : null;
  await rejectLegacyProductionSource(db,{id:visitId,tarea_origen_id:current.tarea_origen_id},source,videoId);
  const publications = (await db.query(`SELECT p.id publicacion_id,p.idea titulo,to_char(p.fecha_programada,'YYYY-MM-DD') fecha_programada,
    p.updated_at publicacion_updated_at,t.id tarea_id,t.revision tarea_revision,s.id objetivo_pieza_id,s.updated_at objetivo_updated_at,
    to_char(o.periodo,'YYYY-MM') periodo FROM publicaciones p JOIN tareas t ON t.publicacion_id=p.id
    LEFT JOIN cliente_objetivo_piezas s ON s.publicacion_id=p.id OR s.tarea_id=t.id
    LEFT JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id
    WHERE p.cliente_id=$1 AND p.tipo IN ('video','reel') AND p.estado='pendiente'
      AND to_char(p.fecha_programada,'YYYY-MM')=$2 AND t.cliente_id=$1
      AND t.estado='pendiente' AND t.historia_id IS NULL AND t.tipo_tarea IS DISTINCT FROM 'produccion'
      AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.id IS DISTINCT FROM $3::int AND ($4::int IS NULL OR t.id=$4)
      AND (SELECT count(*) FROM tareas other WHERE other.publicacion_id=p.id
        AND other.propiedades_extra->>'workspace'='render_os'
        AND other.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
        AND other.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true')=1
      AND (s.id IS NULL OR (s.publicacion_id=p.id AND s.tarea_id=t.id AND s.tipo='video' AND s.numero<=o.reels AND s.estado='pendiente'
        AND s.completada_at IS NULL AND to_char(o.periodo,'YYYY-MM')=$2 AND o.cuentas @> $5::jsonb))
      AND NOT EXISTS(SELECT 1 FROM produccion_videos v WHERE v.id<>$6 AND
        (v.publicacion_id=p.id OR COALESCE(v.tarea_entrega_id,v.tarea_edicion_id)=t.id)) ORDER BY p.fecha_programada,p.id`,
  [current.cliente_id,month,current.tarea_origen_id,current.tarea_edicion_id,JSON.stringify([{id:current.cliente_id}]),videoId])).rows;
  const slots = (await db.query(`SELECT s.id objetivo_pieza_id,s.titulo,s.numero,to_char(o.periodo,'YYYY-MM') periodo,
    s.updated_at objetivo_updated_at,t.id tarea_id,t.revision tarea_revision FROM cliente_objetivo_piezas s
    JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id JOIN tareas t ON t.id=s.tarea_id
    WHERE s.tipo='video' AND s.numero<=o.reels AND s.estado='pendiente' AND s.completada_at IS NULL AND s.publicacion_id IS NULL
      AND to_char(o.periodo,'YYYY-MM')=$1 AND o.cuentas @> $2::jsonb AND t.cliente_id=$3
      AND t.publicacion_id IS NULL AND t.historia_id IS NULL AND t.estado='pendiente'
      AND t.tipo_tarea IS DISTINCT FROM 'produccion' AND t.propiedades_extra->>'workspace'='render_os'
      AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
      AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
      AND t.id IS DISTINCT FROM $4::int AND ($5::int IS NULL OR t.id=$5)
      AND NOT EXISTS(SELECT 1 FROM produccion_videos v WHERE v.id<>$6 AND COALESCE(v.tarea_entrega_id,v.tarea_edicion_id)=t.id)
      ORDER BY s.numero,s.id`,[month,JSON.stringify([{id:current.cliente_id}]),current.cliente_id,current.tarea_origen_id,current.tarea_edicion_id,videoId])).rows;
  // SQL selects only candidate display/identity/version fields, never raw JSON.
  return {actual,publicaciones:publications,casilleros:slots};
}

export function registerProductionEditorialRoutes(router, {pool,handle,transaction,...deps}) {
  const ids = req => {
    if (req.auth?.rol !== 'admin') throw fail('Solo admin puede vincular piezas u objetivos.',403);
    if (!uuid(req.params.id) || !uuid(req.params.videoId)) throw fail('Visita o video inválido.',400);
  };
  router.get('/:id/videos/:videoId/vinculo',handle(async(req,res) => {
    ids(req); return res.json(await productionEditorialCandidates(pool,req.params.id,req.params.videoId,req.query.periodo));
  }));
  for (const emptySlot of [false,true]) router.post(`/:id/videos/:videoId/${emptySlot ? 'vincular-objetivo' : 'vincular-pieza'}`,handle(async(req,res) => {
    ids(req); validateProductionEditorialSelection(req.body,emptySlot);
    const result = await transaction(pool,req.auth,true,db => associateProductionEditorial(db,req.params.id,req.params.videoId,req.body,req.auth.id,deps,emptySlot));
    return res.status(result.created ? 201 : 200).json(result);
  }));
}
