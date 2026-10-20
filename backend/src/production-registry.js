import crypto from 'node:crypto';
import { isProductionVisitTask, isValidProductionDate } from './production-visits.js';
import { annotateTaskAssignments, replaceTaskAssignments } from './task-assignments.js';
import { taskOperationalDto } from './operational-dto.js';
import { productionEditorialConflict } from './production-link-errors.js';
import { registerProductionReconciliationRoutes } from './production-reconciliation.js';
import { registerProductionEditorialRoutes, lockProductionEditorialContext, lockProductionObjectiveLinks, rejectLegacyProductionSource, hasLegacyProductionSource, assertProductionLineageAvailable } from './production-editorial.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0;
const own = (value, key) => Object.hasOwn(value, key);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = value => typeof value === 'string' && isValidProductionDate(value);
const taskDate = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const VIDEO_STATES = ['planificado', 'grabado', 'pendiente', 'repetir'];
const PHOTO_STATES = ['realizada', 'pendiente', 'repetir'];
const unresolved = ['planificado', 'pendiente', 'repetir'];

function text(value, label, max = 20000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`Revisá ${label}.`);
  return value.trim();
}
function url(value) {
  const result = text(value, 'el enlace', 4000);
  if (!result) return '';
  try { const parsed = new URL(result); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); }
  catch { throw fail('El material debe ser un enlace HTTP(S) válido.'); }
  return result;
}
function keys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw fail('Campos no permitidos.');
}
function revision(body) { if (!positive(body.expected_revision)) throw fail('Falta una revisión válida de la visita.'); }
function participants(value) {
  if (!Array.isArray(value) || value.some(id => !positive(id))) throw fail('Elegí participantes por ID válido.');
  return [...new Set(value)];
}
export function validateProductionVisit(body, { partial = false } = {}) {
  keys(body, ['cliente_id', 'fecha', 'titulo', 'participante_ids', 'observaciones', 'drive_url', ...(partial ? ['expected_revision'] : ['tarea_origen_id'])]);
  if (partial) revision(body);
  const result = {};
  for (const key of ['cliente_id', 'fecha', 'titulo', 'participante_ids', 'observaciones', 'drive_url', ...(!partial ? ['tarea_origen_id'] : [])]) {
    if (!own(body, key)) {
      if (!partial && ['cliente_id', 'fecha', 'titulo'].includes(key)) throw fail(`Falta ${key}.`);
      continue;
    }
    const value = body[key];
    if (key === 'cliente_id' && !positive(value)) throw fail('Cliente inválido.');
    if (key === 'tarea_origen_id' && value !== null && !positive(value)) throw fail('Tarea origen inválida.');
    if (key === 'fecha' && !date(value)) throw fail('Fecha inválida.');
    result[key] = key === 'titulo' ? text(value, 'el título', 250, true)
      : key === 'observaciones' ? text(value, 'las observaciones')
        : key === 'drive_url' ? url(value) : key === 'participante_ids' ? participants(value) : value;
  }
  if (!partial) return { participante_ids: [], observaciones: '', drive_url: '', tarea_origen_id: null, ...result };
  if (!Object.keys(result).length) throw fail('No se enviaron cambios.');
  return result;
}
export function validateProductionItem(body, kind, { partial = false, reuse = false } = {}) {
  const fields = kind === 'videos' ? ['titulo', 'guion', 'estado', 'material_url', 'observaciones'] : ['tipo', 'estado', 'drive_url', 'observaciones'];
  keys(body, ['expected_revision', ...fields, ...(kind === 'videos' && !partial ? ['video_origen_id'] : [])]);
  revision(body);
  const result = {};
  for (const key of fields) if (own(body, key)) {
    const value = body[key];
    if (key === 'estado') { if (!(kind === 'videos' ? VIDEO_STATES : PHOTO_STATES).includes(value)) throw fail('Estado inválido.'); result[key] = value; }
    else result[key] = key.endsWith('_url') ? url(value) : text(value, key, ['titulo', 'tipo'].includes(key) ? 250 : 20000, ['titulo', 'tipo'].includes(key));
  }
  if (!partial && !reuse && !own(result, kind === 'videos' ? 'titulo' : 'tipo')) throw fail('Falta el título o tipo.');
  if (!partial && own(body, 'video_origen_id')) { if (!uuid(body.video_origen_id)) throw fail('Video origen inválido.'); result.video_origen_id = body.video_origen_id; }
  if (partial && !Object.keys(result).length) throw fail('No se enviaron cambios.');
  return partial ? result : { estado: kind === 'videos' ? 'planificado' : 'realizada', observaciones: '', ...(kind === 'videos' ? { guion: '', material_url: '' } : { drive_url: '' }), ...result };
}

const VISITS = `SELECT v.id,v.tarea_origen_id,v.cliente_id,c.nombre cliente_nombre,
  to_char(v.fecha,'YYYY-MM-DD') fecha,v.titulo,v.observaciones,v.drive_url,v.revision,
  EXISTS(SELECT 1 FROM produccion_reconciliaciones r WHERE r.visita_id=v.id) contexto_historico_revisado,
  ARRAY(SELECT p.usuario_id FROM produccion_visita_participantes p WHERE p.visita_id=v.id ORDER BY p.usuario_id) participante_ids
  FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id`;
const VIDEOS = `SELECT pv.id,pv.visita_id,pv.video_origen_id,pv.titulo,pv.guion,pv.estado,pv.material_url,pv.observaciones,
  pv.publicacion_id,pv.tarea_entrega_id,pv.cliente_editorial_id,
  pv.tarea_edicion_id,pv.editor_id,to_char(pv.fecha_entrega,'YYYY-MM-DD') fecha_entrega,t.estado tarea_estado,
  (SELECT a.usuario_id FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.tipo='responsable' LIMIT 1) editor_actual_id,
  to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_entrega_actual,t.cliente_id tarea_cliente_id
  FROM produccion_videos pv LEFT JOIN tareas t ON t.id=pv.tarea_edicion_id`;
const PHOTOS = `SELECT id,visita_id,tipo,estado,drive_url,observaciones FROM produccion_fotos`;
const scalarFields = (row, fields) => Object.fromEntries(fields.filter(key => row[key] === null || ['string', 'number', 'boolean'].includes(typeof row[key])).map(key => [key, row[key]]));
const videoDto = row => ({...scalarFields(row, ['id', 'visita_id', 'video_origen_id', 'titulo', 'guion', 'estado', 'material_url', 'observaciones', 'tarea_edicion_id', 'editor_id', 'fecha_entrega', 'tarea_estado', 'fecha', 'cliente_id', 'cliente_nombre', 'editor_actual_id', 'fecha_entrega_actual', 'tarea_cliente_id']),
  ...Object.fromEntries(['publicacion_id','tarea_entrega_id','cliente_editorial_id'].map(key => [key,positive(row[key]) ? row[key] : null])),
  editor_handoff_id: positive(row.editor_id) ? row.editor_id : null,
  fecha_entrega_handoff: date(row.fecha_entrega) ? row.fecha_entrega : null });
function visitDto(row, videos, photos) {
  return { ...scalarFields(row, ['id', 'tarea_origen_id', 'cliente_id', 'cliente_nombre', 'fecha', 'titulo', 'observaciones', 'drive_url', 'revision']),
    contexto_historico_revisado: row.contexto_historico_revisado === true,
    participante_ids: (row.participante_ids || []).filter(positive),
    videos: videos.filter(video => video.visita_id === row.id).map(videoDto),
    fotos: photos.filter(photo => photo.visita_id === row.id).map(photo => scalarFields(photo, ['id', 'visita_id', 'tipo', 'estado', 'drive_url', 'observaciones'])) };
}
async function readVisits(db, where, values) {
  const rows = (await db.query(`${VISITS} ${where} ORDER BY v.fecha,v.id`, values)).rows;
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const videos = (await db.query(`${VIDEOS} WHERE pv.visita_id=ANY($1::uuid[]) ORDER BY pv.created_at,pv.id`, [ids])).rows;
  const photos = (await db.query(`${PHOTOS} WHERE visita_id=ANY($1::uuid[]) ORDER BY created_at,id`, [ids])).rows;
  return rows.map(row => visitDto(row, videos, photos));
}
async function activeClient(db, id) {
  const row = (await db.query('SELECT id,nombre FROM clientes WHERE id=$1 AND activo IS TRUE FOR SHARE', [id])).rows[0];
  if (!row) throw fail('Cliente activo no encontrado.', 404);
  return row;
}
async function activePeople(db, ids, editor = false) {
  if (!ids.length) return [];
  const rows = (await db.query(`SELECT id,nombre,rol FROM usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE${editor ? " AND rol IN ('admin','edicion')" : ''} ORDER BY id FOR SHARE`, [ids])).rows;
  if (rows.length !== ids.length) throw fail(editor ? 'Elegí un editor activo de Edición o Administración.' : 'Uno de los participantes no está activo.');
  return rows;
}
async function replaceParticipants(db, id, ids) {
  await activePeople(db, ids);
  await db.query('DELETE FROM produccion_visita_participantes WHERE visita_id=$1', [id]);
  if (ids.length) await db.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) SELECT $1,unnest($2::int[])', [id, ids]);
}
async function sourceTask(db, id, { available = true } = {}) {
  const task = (await db.query("SELECT * FROM tareas WHERE id=$1 AND propiedades_extra->>'workspace'='render_os' FOR UPDATE", [id])).rows[0];
  if (!task || !isProductionVisitTask(task) || (available && (['true', true].includes(task.propiedades_extra?.papelera_render_os) || ['true', true].includes(task.propiedades_extra?.archivada_render_os)))) throw fail('La tarea origen no es una visita disponible de RENDER OS.', 404);
  return task;
}
async function lockVisit(db, id) {
  const link = (await db.query('SELECT tarea_origen_id FROM produccion_visitas WHERE id=$1', [id])).rows[0];
  if (!link) throw fail('Visita no encontrada.', 404);
  if (link.tarea_origen_id) await sourceTask(db, link.tarea_origen_id, { available: false });
  const row = (await db.query(`${VISITS} WHERE v.id=$1 FOR UPDATE OF v`, [id])).rows[0];
  if (!row) throw fail('Visita no encontrada.', 404);
  return row;
}
function checkRevision(visit, expected) { if (visit.revision !== expected) throw fail('La visita cambió. Recargá su revisión.', 409); }
async function bump(db, id, actorId) {
  await db.query('UPDATE produccion_visitas SET revision=revision+1,actualizado_por_id=$2,updated_at=now() WHERE id=$1', [id, actorId]);
}
async function transaction(pool, fn) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}

/** Caller owns the task transaction. Never commit, update task metadata, or backfill history. */
export async function syncProductionVisitFromTask(db, task, actorId) {
  if (!positive(actorId) || !positive(task.id)) throw fail('Identidad de origen inválida.');
  await db.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);
  const editing = (await db.query('SELECT v.cliente_id FROM produccion_videos pv JOIN produccion_visitas v ON v.id=pv.visita_id WHERE pv.tarea_edicion_id=$1',[task.id])).rows[0];
  if(editing && editing.cliente_id!==task.cliente_id) throw fail('La tarea pertenece a una visita de Producciones. No cambies su cliente desde Tareas.',409);
  const existing = (await db.query('SELECT id,cliente_id,to_char(fecha,\'YYYY-MM-DD\') fecha FROM produccion_visitas WHERE tarea_origen_id=$1 FOR UPDATE', [task.id])).rows[0];
  if (existing) {
    if (!isProductionVisitTask(task) || task.propiedades_extra?.workspace!=='render_os' || existing.cliente_id !== task.cliente_id || existing.fecha !== taskDate(task.fecha_vencimiento)) throw fail('Cambiá la visita desde Producciones.', 409);
    return null;
  }
  if (!isProductionVisitTask(task) || task.propiedades_extra?.workspace!=='render_os' || !positive(task.cliente_id) || !date(taskDate(task.fecha_vencimiento))
    || ['true',true].includes(task.propiedades_extra?.archivada_render_os) || ['true',true].includes(task.propiedades_extra?.papelera_render_os)) return null;
  // A normal task edit must not silently reinterpret aggregate historical work
  // as a new per-video registry. Explicit reviewed reconciliation is separate.
  if (await hasLegacyProductionSource(db, task.id, task)) return null;
  await activeClient(db, task.cliente_id);
  const [assigned] = await annotateTaskAssignments(db, [task]);
  const ids = [...new Set([assigned.asignado_a_id, ...assigned.colaborador_ids].filter(positive))];
  const id = crypto.randomUUID();
  const inserted = await db.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,drive_url,creado_por_id,actualizado_por_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT(tarea_origen_id) DO NOTHING RETURNING id`,
  [id, task.id, task.cliente_id, taskDate(task.fecha_vencimiento), text(task.titulo, 'el título', 250, true), '', '', actorId]);
  if (!inserted.rows.length) return null;
  await replaceParticipants(db, id, ids);
  return (await readVisits(db, 'WHERE v.id=$1', [id]))[0];
}

export function createProductionRegistryRouter({ express, pool }) {
  const router = express.Router();
  router.use((req, res, next) => positive(req.auth?.id) && req.auth.activo !== false ? next() : res.status(403).json({ error: 'Necesitás una identidad activa verificada.' }));
  const handle = fn => async (req, res, next) => {
    try { return await fn(req, res); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'El origen ya está vinculado. Recargá la visita.' });
      if (productionEditorialConflict(error)) return res.status(409).json({ error: 'El vínculo cambió o es incompatible. Recargá los datos antes de continuar.' });
      return next(error); }
  };
  const routeId = req => { if (!uuid(req.params.id)) throw fail('Visita inválida.'); return req.params.id; };
  registerProductionReconciliationRoutes(router,{pool,handle});
  registerProductionEditorialRoutes(router,{pool,handle,transaction,readVisits,bump,lockVisit,activeClient});
  router.get('/', handle(async (req, res) => {
    if (typeof req.query.mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.mes)) throw fail('Elegí un mes YYYY-MM válido.');
    const client = req.query.cliente_id;
    if (client !== undefined && (typeof client !== 'string' || !/^[1-9]\d*$/.test(client) || !positive(Number(client)))) throw fail('Cliente inválido.');
    const visitas = await readVisits(pool, "WHERE v.fecha >= $1::date AND v.fecha < $1::date + INTERVAL '1 month'" + (client ? ' AND v.cliente_id=$2' : ''), client ? [`${req.query.mes}-01`, Number(client)] : [`${req.query.mes}-01`]);
    return res.json({ visitas });
  }));
  router.get('/pendientes', handle(async (req, res) => {
    const filter = req.query.cliente_id;
    if (filter !== undefined && (typeof filter !== 'string' || !/^[1-9]\d*$/.test(filter) || !positive(Number(filter)))) throw fail('Cliente inválido.');
    const rows = (await pool.query(`${VIDEOS.replace(' FROM produccion_videos', ",to_char(v.fecha,'YYYY-MM-DD') fecha,v.cliente_id,c.nombre cliente_nombre FROM produccion_videos")}
      JOIN produccion_visitas v ON v.id=pv.visita_id JOIN clientes c ON c.id=v.cliente_id
      WHERE pv.estado IN ('planificado','pendiente','repetir') AND NOT EXISTS(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id)
      ${filter ? 'AND v.cliente_id=$1' : ''} ORDER BY v.fecha,pv.created_at,pv.id`, filter ? [Number(filter)] : [])).rows;
    return res.json({ videos: rows.map(videoDto) });
  }));
  router.get('/:id', handle(async (req, res) => {
    const visit = (await readVisits(pool, 'WHERE v.id=$1', [routeId(req)]))[0];
    if (!visit) throw fail('Visita no encontrada.', 404);
    return res.json({ visita: visit });
  }));
  router.post('/', handle(async (req, res) => {
    const input = validateProductionVisit(req.body);
    const visita = await transaction(pool, async db => {
      if (input.tarea_origen_id) {
        const source = await sourceTask(db, input.tarea_origen_id);
        // Do not create a mixed registry that neither legacy nor per-video
        // handoff can safely operate. Historical reconciliation is explicit.
        await rejectLegacyProductionSource(db, { tarea_origen_id: source.id }, source);
        if (source.cliente_id !== input.cliente_id) throw fail('El cliente debe coincidir con la tarea origen.');
        if (taskDate(source.fecha_vencimiento) !== input.fecha) await db.query('UPDATE tareas SET fecha_vencimiento=$2,updated_at=now() WHERE id=$1',[source.id,input.fecha]);
      }
      await activeClient(db, input.cliente_id);
      const id = crypto.randomUUID();
      await db.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,drive_url,creado_por_id,actualizado_por_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [id,input.tarea_origen_id,input.cliente_id,input.fecha,input.titulo,input.observaciones,input.drive_url,req.auth.id]);
      await replaceParticipants(db,id,input.participante_ids);
      return (await readVisits(db,'WHERE v.id=$1',[id]))[0];
    });
    return res.status(201).json({ visita });
  }));
  router.patch('/:id', handle(async (req, res) => {
    const id=routeId(req), input=validateProductionVisit(req.body,{partial:true});
    const visita=await transaction(pool,async db=>{
      const current=await lockVisit(db,id);checkRevision(current,req.body.expected_revision);
      const changedReviewedDimensions=(own(input,'cliente_id')&&input.cliente_id!==current.cliente_id)
        ||(own(input,'fecha')&&input.fecha!==current.fecha);
      if(changedReviewedDimensions&&(await db.query('SELECT id FROM produccion_reconciliaciones WHERE visita_id=$1',[id])).rows.length) {
        throw fail('La fecha y el cliente de una conciliación histórica requieren una nueva revisión explícita.',409);
      }
      if (own(input,'cliente_id')) {
        await activeClient(db,input.cliente_id);
        if (input.cliente_id!==current.cliente_id) {
          // Reuse locks its source video. Hold every own video before checking
          // lineage, so a concurrent resume either commits first or observes
          // the new source client in its fresh post-lock read below.
          await db.query('SELECT id FROM produccion_videos WHERE visita_id=$1 ORDER BY id FOR UPDATE',[id]);
          if ((await db.query(`SELECT pv.id FROM produccion_videos pv WHERE pv.visita_id=$1 AND
            (pv.tarea_edicion_id IS NOT NULL OR pv.publicacion_id IS NOT NULL OR pv.video_origen_id IS NOT NULL OR EXISTS(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id)) LIMIT 1`,[id])).rows.length) throw fail('La visita tiene edición, vínculo editorial o videos retomados. Revisá manualmente el cambio de cliente.',409);
        }
      }
      if (current.tarea_origen_id && (own(input,'fecha') || own(input,'cliente_id'))) await db.query('UPDATE tareas SET fecha_vencimiento=$2,cliente_id=$3,updated_at=now() WHERE id=$1',[current.tarea_origen_id,input.fecha??current.fecha,input.cliente_id??current.cliente_id]);
      if (own(input,'participante_ids')) await replaceParticipants(db,id,input.participante_ids);
      const fields=Object.keys(input).filter(key=>key!=='participante_ids');
      if(fields.length) await db.query(`UPDATE produccion_visitas SET ${fields.map((key,i)=>`${key}=$${i+2}`).join(',')} WHERE id=$1`,[id,...fields.map(key=>input[key])]);
      await bump(db,id,req.auth.id);return (await readVisits(db,'WHERE v.id=$1',[id]))[0];
    });return res.json({visita});
  }));
  for(const kind of ['videos','fotos']) {
    for(const partial of [false,true]) router[partial?'patch':'post'](`/:id/${kind}${partial?'/:itemId':''}`,handle(async(req,res)=>{
      const id=routeId(req);
      if(partial&&!uuid(req.params.itemId)) throw fail('Registro inválido.');
      const input=validateProductionItem(req.body,kind,{partial,reuse:!!req.body?.video_origen_id});
      const visita=await transaction(pool,async db=>{
        if(input.video_origen_id) await lockProductionObjectiveLinks(db);
        const current=await lockVisit(db,id);checkRevision(current,req.body.expected_revision);
        const table=kind==='videos'?'produccion_videos':'produccion_fotos';
        if(partial) {
          const child=(await db.query(`SELECT id FROM ${table} WHERE id=$1 AND visita_id=$2 FOR UPDATE`,[req.params.itemId,id])).rows[0];
          if(!child) throw fail('Registro no encontrado en esta visita.',404);
        } else if(input.video_origen_id) {
          const source=(await db.query(`SELECT pv.id,pv.visita_id,pv.titulo,pv.guion,pv.estado FROM produccion_videos pv JOIN produccion_visitas v ON v.id=pv.visita_id
            WHERE pv.id=$1 AND v.cliente_id=$2 FOR UPDATE OF pv`,[input.video_origen_id,current.cliente_id])).rows[0];
          if(!source||source.visita_id===id||!unresolved.includes(source.estado)) throw fail('El video pendiente no pertenece a otra visita de este cliente.',404);
          // No implicit editorial transfer: neither a bound source nor a bound
          // ancestor/descendant may spawn another independent delivery task.
          await assertProductionLineageAvailable(db,source.id,{includeSelf:true});
          // The joined visit was not locked: READ COMMITTED may have used its
          // old client while waiting for the source video lock. Read afresh.
          const sourceVisit=(await db.query('SELECT cliente_id FROM produccion_visitas WHERE id=$1',[source.visita_id])).rows[0];
          if(!sourceVisit||sourceVisit.cliente_id!==current.cliente_id) throw fail('El cliente de la visita origen cambió. Recargá los pendientes.',409);
          if((await db.query('SELECT id FROM produccion_videos WHERE video_origen_id=$1',[source.id])).rows.length) throw fail('Este pendiente ya fue retomado.',409);
          if(!own(req.body,'titulo')) input.titulo=source.titulo;
          if(!own(req.body,'guion')) input.guion=source.guion;
        }
        const fields=Object.keys(input);
        if(partial) await db.query(`UPDATE ${table} SET ${fields.map((key,i)=>`${key}=$${i+3}`).join(',')},actualizado_por_id=$${fields.length+3},updated_at=now() WHERE id=$1 AND visita_id=$2`,[req.params.itemId,id,...fields.map(key=>input[key]),req.auth.id]);
        else await db.query(`INSERT INTO ${table}(id,visita_id,${fields.join(',')},creado_por_id,actualizado_por_id) VALUES($1,$2,${fields.map((_,i)=>`$${i+3}`).join(',')},$${fields.length+3},$${fields.length+3})`,[crypto.randomUUID(),id,...fields.map(key=>input[key]),req.auth.id]);
        await bump(db,id,req.auth.id);return (await readVisits(db,'WHERE v.id=$1',[id]))[0];
      });return res.status(partial?200:201).json({visita});
    }));
  }
  router.post('/:id/videos/:videoId/enviar-edicion',handle(async(req,res)=>{
    if(req.auth.rol!=='admin') throw fail('Solo admin puede enviar a edición.',403);
    const id=routeId(req);if(!uuid(req.params.videoId)) throw fail('Video inválido.');
    keys(req.body,['expected_revision','editor_id','fecha_entrega']);revision(req.body);
    if(!positive(req.body.editor_id)||!date(req.body.fecha_entrega)) throw fail('Elegí editor y fecha de entrega válidos.');
    const result=await transaction(pool,async db=>{
      // Never discover an existing delivery task after taking a visit/video lock.
      const discovered=(await db.query(`${VIDEOS} WHERE pv.id=$1 AND pv.visita_id=$2`,[req.params.videoId,id])).rows[0];
      if(!discovered) throw fail('Video no encontrado en esta visita.',404);
      const context=discovered.publicacion_id ? await lockProductionEditorialContext(db,id,req.params.videoId,{}, {lockVisit}) : null;
      const visit=context?.visit ?? await lockVisit(db,id);
      const video=(await db.query(`${VIDEOS} WHERE pv.id=$1 AND pv.visita_id=$2 FOR UPDATE OF pv`,[req.params.videoId,id])).rows[0];
      if(!video) throw fail('Video no encontrado en esta visita.',404);
      if((video.publicacion_id??null)!==(discovered.publicacion_id??null) || (video.tarea_entrega_id??null)!==(discovered.tarea_entrega_id??null)) throw fail('El vínculo editorial cambió. Recargá la visita.',409);
      if(video.tarea_edicion_id) {
        if(video.editor_id!==req.body.editor_id||video.fecha_entrega!==req.body.fecha_entrega) throw fail('El video ya fue enviado con otro editor o fecha.',409);
        const task=(await db.query("SELECT t.*,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento FROM tareas t WHERE t.id=$1",[video.tarea_edicion_id])).rows[0];
        if(!task) throw fail('Tarea vinculada no disponible.',404);
        return {created:false,task:taskOperationalDto((await annotateTaskAssignments(db,[task]))[0],req.auth),visita:(await readVisits(db,'WHERE v.id=$1',[id]))[0]};
      }
      checkRevision(visit,req.body.expected_revision);
      if(video.estado!=='grabado') throw fail('Marcá el video como grabado antes de enviarlo a edición.',409);
      const material=url(video.material_url||visit.drive_url);if(!material) throw fail('Vinculá el material del video o la carpeta de la visita.');
      const [editor]=await activePeople(db,[req.body.editor_id],true);
      if(visit.tarea_origen_id) {
        const source=context?.source ?? await sourceTask(db,visit.tarea_origen_id,{available:false});
        await rejectLegacyProductionSource(db,visit,source,video.id);
      }
      const metadata={workspace:'render_os',origen_produccion_video_id:video.id,produccion_visita_id:id,guiones:video.guion};
      let task;
      let collaboratorIds=[];
      if(context) {
        const canonical=context.task,publication=context.publication,slot=context.slot;
        if(!canonical || canonical.id!==video.tarea_entrega_id || canonical.publicacion_id!==video.publicacion_id
          || canonical.cliente_id!==visit.cliente_id || canonical.estado!=='pendiente' || canonical.historia_id
          || canonical.tipo_tarea==='produccion' || canonical.propiedades_extra?.workspace!=='render_os'
          || ['archivada_render_os','papelera_render_os'].some(key=>[true,'true'].includes(canonical.propiedades_extra?.[key]))
          || !publication || publication.cliente_id!==visit.cliente_id || !['video','reel'].includes(publication.tipo)
          || publication.estado!=='pendiente' || (slot && (slot.tarea_id!==canonical.id || slot.publicacion_id!==publication.id
            || slot.estado!=='pendiente' || slot.completada_at))) throw fail('La entrega editorial ya empezó o dejó de ser compatible.',409);
        const [assigned]=await annotateTaskAssignments(db,[canonical]);
        const memberIds=[...new Set([assigned.asignado_a_id,...assigned.colaborador_ids].filter(id=>positive(id)&&id!==editor.id))];
        const members=memberIds.length ? (await db.query('SELECT id,nombre FROM usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE ORDER BY id FOR SHARE',[memberIds])).rows : [];
        collaboratorIds=members.map(member=>member.id);
        metadata.colaboradores=members.map(member=>member.nombre);
        // Keep editorial copy/origin markers and workflow state; guion is separate.
        task=(await db.query(`UPDATE tareas SET asignado_a=$2,fecha_vencimiento=$3,material_referencia=$4,
          tipo_tarea='edicion',subtipo='video',propiedades_extra=propiedades_extra || $5::jsonb,updated_at=now()
          WHERE id=$1 RETURNING *,to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento`,
        [canonical.id,editor.nombre,req.body.fecha_entrega,material,JSON.stringify(metadata)])).rows[0];
      } else task=(await db.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,material_referencia,aclaraciones,propiedades_extra)
        VALUES($1,$2,$3,'pendiente','edicion','video',$4,$5,$6,$7::jsonb)
        RETURNING *,to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento`,[`${visit.cliente_nombre} | Edición | ${video.titulo}`,editor.nombre,visit.cliente_id,req.body.fecha_entrega,material,video.observaciones,JSON.stringify(metadata)])).rows[0];
      await replaceTaskAssignments(db,task.id,{ownerId:editor.id,collaboratorIds});
      await db.query('UPDATE produccion_videos SET tarea_edicion_id=$3,editor_id=$4,fecha_entrega=$5,actualizado_por_id=$6,updated_at=now() WHERE id=$1 AND visita_id=$2',[video.id,id,task.id,editor.id,req.body.fecha_entrega,req.auth.id]);
      await bump(db,id,req.auth.id);
      return {created:true,task:taskOperationalDto((await annotateTaskAssignments(db,[task]))[0],req.auth),visita:(await readVisits(db,'WHERE v.id=$1',[id]))[0]};
    });return res.status(result.created?201:200).json(result);
  }));
  return router;
}
