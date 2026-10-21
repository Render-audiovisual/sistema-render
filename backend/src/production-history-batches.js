import { randomUUID } from 'node:crypto';
import { withProductionAuthority } from './production-authority.js';
import { isProductionVisitTask, isValidProductionDate } from './production-visits.js';
import { productionHistoryHash, productionValueHash } from './production-history-hash.js';
import { batchLiveVideoCompatible } from './production-batch-evidence.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const uuid = n => typeof n === 'string' && n.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(n);
const hidden = t => ['archivada_render_os','papelera_render_os'].some(k => [true,'true'].includes(t.propiedades_extra?.[k]));
const exactHash = n => typeof n === 'string' && n.length === 64 && /^[a-f0-9]{64}$/.test(n);
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw fail('Campos de revisión no válidos.',400);
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw fail('Texto de revisión no válido.',400);
  return required ? value.trim() : value;
}
function link(value = '') {
  const result = text(value,4000).trim();
  if (result) { try { const url = new URL(result); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error(); }
    catch { throw fail('El material debe ser un enlace HTTP(S) válido.',400); } }
  return result;
}
function safe(value, max = 20000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw fail('No se pudo verificar el contenido histórico.',413);
  return value;
}
function sourceId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || /\s/.test(value) || !positive(Number(value))) throw fail('Origen inválido.',400);
  return Number(value);
}

export function validateProductionHistoryBatch(body) {
  closed(body,['version','request_id','source_task_id','expected_source_revision','visit_id','expected_visit_revision','expected_context_hash','visit_fields','videos','child_dispositions','acknowledgement']);
  if (body.version !== 2 || !uuid(body.request_id) || !positive(body.source_task_id) || !positive(body.expected_source_revision)
    || !exactHash(body.expected_context_hash) || body.acknowledgement !== 'correspondencias_revisadas_manualmente') throw fail('Revisá el origen y confirmá las correspondencias.',400);
  if (!(body.visit_id === null && body.expected_visit_revision === null || uuid(body.visit_id) && positive(body.expected_visit_revision))) throw fail('Visita o revisión inválida.',400);
  let visitFields;
  if (body.visit_id === null) {
    closed(body.visit_fields,['titulo','participante_ids','drive_url','observaciones']);
    const people = body.visit_fields.participante_ids ?? [];
    if (!Array.isArray(people) || people.length > 100 || people.some(id => !positive(id)) || new Set(people).size !== people.length) throw fail('Participantes inválidos.',400);
    visitFields = { titulo:text(body.visit_fields.titulo,250,true), participante_ids:[...people].sort((a,b)=>a-b),
      drive_url:link(body.visit_fields.drive_url), observaciones:text(body.visit_fields.observaciones ?? '',20000) };
  } else if (Object.hasOwn(body,'visit_fields')) throw fail('Una revisión no reemplaza los datos de la visita.',400);
  if (!Array.isArray(body.videos) || !body.videos.length || body.videos.length > 50) throw fail('Seleccioná entre uno y cincuenta videos.',400);
  const videos = body.videos.map(item => {
    closed(item,['existing_video_id','local_key','new_video','disposition','task_id']);
    if (!['adopt_original','manual_independent'].includes(item.disposition)
      || (item.disposition === 'adopt_original' ? !positive(item.task_id) : item.task_id !== null)) throw fail('Correspondencia de video inválida.',400);
    const base = { disposition:item.disposition, task_id:item.task_id };
    if (Object.hasOwn(item,'existing_video_id')) {
      if (!uuid(item.existing_video_id) || Object.hasOwn(item,'local_key') || Object.hasOwn(item,'new_video') || body.visit_id === null) throw fail('Video existente inválido.',400);
      return {...base,existing_video_id:item.existing_video_id.toLowerCase()};
    }
    if (!uuid(item.local_key)) throw fail('Identificación manual inválida.',400);
    closed(item.new_video,['titulo','guion','estado','material_url','observaciones']);
    if (!['planificado','grabado','pendiente','repetir'].includes(item.new_video.estado)) throw fail('Estado de video inválido.',400);
    return {...base,local_key:item.local_key.toLowerCase(),new_video:{titulo:text(item.new_video.titulo,250,true),
      guion:text(item.new_video.guion ?? '',20000),estado:item.new_video.estado,material_url:link(item.new_video.material_url),observaciones:text(item.new_video.observaciones ?? '',20000)}};
  });
  const keys = videos.map(v=>v.existing_video_id ?? v.local_key);
  const mapped = videos.filter(v=>v.task_id !== null).map(v=>v.task_id);
  if (new Set(keys).size !== keys.length || new Set(mapped).size !== mapped.length) throw fail('Cada video y tarea solo pueden seleccionarse una vez.',400);
  if (!Array.isArray(body.child_dispositions) || body.child_dispositions.length > 50) throw fail('Revisá todas las tareas originales.',400);
  const children = body.child_dispositions.map(child => {
    closed(child,['task_id','expected_revision','disposition','video_key','reason']);
    if (!positive(child.task_id) || !positive(child.expected_revision) || !['mapped','preserve_unmapped'].includes(child.disposition)
      || (child.disposition === 'mapped' ? !uuid(child.video_key) : child.video_key !== null)) throw fail('Disposición de tarea inválida.',400);
    const videoKey = child.video_key?.toLowerCase() ?? null;
    if (child.disposition === 'mapped' && !videos.some(v=>(v.existing_video_id ?? v.local_key) === videoKey && v.task_id === child.task_id)) throw fail('La tarea no corresponde al video seleccionado.',400);
    return {task_id:child.task_id,expected_revision:child.expected_revision,disposition:child.disposition,video_key:videoKey,reason:text(child.reason,1000,true)};
  });
  if (new Set(children.map(c=>c.task_id)).size !== children.length || videos.some(v=>v.task_id !== null && !children.some(c=>c.task_id===v.task_id && c.disposition==='mapped'))) throw fail('Falta una disposición explícita o está duplicada.',400);
  const input = {version:2,request_id:body.request_id.toLowerCase(),source_task_id:body.source_task_id,
    expected_source_revision:body.expected_source_revision,visit_id:body.visit_id?.toLowerCase() ?? null,
    expected_visit_revision:body.expected_visit_revision,expected_context_hash:body.expected_context_hash,
    ...(visitFields ? {visit_fields:visitFields} : {}),videos,child_dispositions:children.sort((a,b)=>a.task_id-b.task_id),acknowledgement:body.acknowledgement};
  if (Buffer.byteLength(JSON.stringify(input),'utf8') > 900000) throw fail('La revisión supera el tamaño permitido.',413);
  return input;
}

const childSql = `SELECT t.id,t.revision,t.titulo,t.estado,t.cliente_id,t.tipo_tarea,t.historia_id,t.publicacion_id,
  t.propiedades_extra,to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_entrega,
  EXISTS(SELECT 1 FROM proyecto_tareas pt WHERE pt.tarea_id=t.id) project_bound,
  EXISTS(SELECT 1 FROM cliente_objetivo_piezas s WHERE s.tarea_id=t.id) goal_bound,
  ARRAY(SELECT pv.id FROM produccion_videos pv WHERE pv.tarea_edicion_id=t.id OR pv.tarea_entrega_id=t.id ORDER BY pv.id) bound_video_ids,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'rol',u.rol,'activo',u.activo) ORDER BY u.id)
    FROM tarea_asignaciones a JOIN usuarios u ON u.id=a.usuario_id WHERE a.tarea_id=t.id AND a.tipo='responsable'),'[]'::jsonb) owners
  FROM tareas t WHERE t.propiedades_extra->>'origen_visita_id'=$1 ORDER BY t.id LIMIT 51`;
const videoSql = `SELECT id,visita_id,video_origen_id,titulo,guion,estado,material_url,observaciones,
  tarea_edicion_id,tarea_entrega_id,publicacion_id,cliente_editorial_id,editor_id,
  to_char(fecha_entrega,'YYYY-MM-DD') fecha_entrega,updated_at::text observed_version
  FROM produccion_videos WHERE visita_id=$1 ORDER BY id LIMIT 51`;

function originalTaskCompatible(task, source, { existing = false } = {}) {
  return task && task.id !== source.id && task.cliente_id === source.cliente_id && task.tipo_tarea === 'edicion'
    && task.propiedades_extra?.workspace === 'render_os' && !hidden(task) && !task.historia_id && !task.project_bound
    && String(task.propiedades_extra?.origen_visita_id) === String(source.id)
    && (existing || !task.publicacion_id && !task.goal_bound && !task.propiedades_extra?.origen_produccion_video_id && !task.propiedades_extra?.produccion_visita_id)
    && typeof task.fecha_entrega === 'string' && task.fecha_entrega.length === 10 && isValidProductionDate(task.fecha_entrega)
    && task.owners?.length === 1 && positive(task.owners[0].id) && task.owners[0].activo === true && ['admin','edicion'].includes(task.owners[0].rol);
}

async function snapshot(db, id) {
  const source = (await db.query(`SELECT t.id,t.revision,t.titulo,t.tipo_tarea,t.subtipo,t.cliente_id,t.propiedades_extra,
    t.aclaraciones,t.material_referencia,to_char(t.fecha_vencimiento,'YYYY-MM-DD') source_date,
    c.nombre cliente_nombre,c.activo cliente_activo,
    (EXISTS(SELECT 1 FROM produccion_reconciliaciones r WHERE r.tarea_origen_id=t.id)
      OR EXISTS(SELECT 1 FROM produccion_revision_lotes l WHERE l.tarea_origen_id=t.id)) persisted_review
    FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.id=$1`,[id])).rows[0];
  if (!source || !isProductionVisitTask(source) || source.propiedades_extra?.workspace !== 'render_os' || hidden(source)) throw fail('Visita histórica disponible no encontrada.',404);
  if (!positive(source.cliente_id) || source.cliente_activo !== true || !isValidProductionDate(source.source_date)) throw fail('El origen necesita cliente activo y fecha válida.');
  const visit = (await db.query(`SELECT id,revision,tarea_origen_id,cliente_id,to_char(fecha,'YYYY-MM-DD') fecha,
    titulo,observaciones,drive_url,ARRAY(SELECT usuario_id FROM produccion_visita_participantes p WHERE p.visita_id=v.id ORDER BY usuario_id) participante_ids
    FROM produccion_visitas v WHERE tarea_origen_id=$1`,[id])).rows[0] ?? null;
  if (visit && visit.cliente_id !== source.cliente_id) throw fail('El cliente del origen y la visita requiere revisión específica.');
  const children = (await db.query(childSql,[String(id)])).rows;
  const videos = visit ? (await db.query(videoSql,[visit.id])).rows : [];
  if (children.length > 50 || videos.length > 50) throw fail('El expediente supera cincuenta tareas o videos. No se recortará la revisión.',413);
  const maps = (await db.query(`SELECT m.video_id,m.visita_id,m.tarea_edicion_id FROM produccion_lote_edicion_mapeos m
    WHERE m.visita_id=$1 OR m.tarea_edicion_id=ANY($2::int[])
    UNION SELECT a.video_id,r.visita_id,a.tarea_edicion_id FROM produccion_edicion_adopciones a
    JOIN produccion_reconciliaciones r ON r.id=a.reconciliacion_id WHERE r.visita_id=$1 OR a.tarea_edicion_id=ANY($2::int[])
    ORDER BY video_id,tarea_edicion_id`,[visit?.id ?? null,children.map(t=>t.id)])).rows;
  const relatedIds = [...new Set(videos.flatMap(v=>[v.tarea_edicion_id,v.tarea_entrega_id]).filter(positive))].sort((a,b)=>a-b);
  const related = relatedIds.length ? (await db.query('SELECT id,revision FROM tareas WHERE id=ANY($1::int[]) ORDER BY id',[relatedIds])).rows : [];
  const metadata = source.propiedades_extra ?? {};
  if (!source.persisted_review && !children.length && !metadata.produccion_confirmada_at && !(Array.isArray(metadata.produccion_registros) ? metadata.produccion_registros.length : metadata.produccion_registros != null)) throw fail('El origen no contiene producción histórica para revisar.');
  const contextHash = productionValueHash({source:[source.id,source.revision,source.cliente_id,source.source_date,productionHistoryHash(source)],visit,videos,children:children.map(t=>[
    t.id,t.revision,t.estado,t.cliente_id,t.tipo_tarea,t.historia_id,t.publicacion_id,t.propiedades_extra?.workspace,
    hidden(t),t.fecha_entrega,t.project_bound,t.goal_bound,t.owners,t.bound_video_ids,
    t.propiedades_extra?.origen_produccion_video_id,t.propiedades_extra?.produccion_visita_id]),maps,related});
  return {source,visit,children,videos,maps,related,contextHash};
}

function contextDto(value) {
  const {source,visit,children,videos,maps,contextHash} = value, p = source.propiedades_extra ?? {};
  const publicVideos = videos.map(({observed_version,...video})=>video);
  return {version:2,source:{id:source.id,revision:source.revision,titulo:safe(source.titulo,250),
    cliente:{id:source.cliente_id,nombre:safe(source.cliente_nombre,250)},fecha:source.source_date,
    content:{instructions:safe(source.aclaraciones),script:safe(p.guiones),material:safe(source.material_referencia,4000),
      recorded_material:safe(p.material || p.Material,4000),feedback:safe(p.feedback),schedule:safe(p.horario)}},
    visit:visit ? {...visit,videos:publicVideos} : null,
    legacy_tasks:children.map(task=>{ const mapping=maps.find(m=>m.tarea_edicion_id===task.id);
      return {id:task.id,revision:task.revision,titulo:safe(task.titulo,250),estado:safe(task.estado,100),
        editor_id:task.owners?.length===1 ? task.owners[0].id : null,fecha_entrega:task.fecha_entrega,
        eligibility:originalTaskCompatible(task,source,{existing:Boolean(mapping)}) && (!task.bound_video_ids?.length || mapping && task.bound_video_ids.every(id=>id===mapping.video_id)) ? 'adoptable' : 'preserve_only',
        mapped_video_id:mapping?.video_id ?? null};}), context_hash:contextHash};
}

async function currentAdmin(db, auth) {
  const id=auth?.id,version=auth?.session_version;
  if (!positive(id) || !positive(version)) throw fail('Sesión requerida.',401);
  const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE',[id])).rows[0];
  if (!actor || actor.id!==id || actor.activo!==true || actor.session_version!==version) throw fail('La sesión ya no está activa.',401);
  if (actor.rol!=='admin') throw fail('Solo administración puede revisar producción histórica.',403);
}

export async function readProductionHistoryBatchContext(pool, auth, rawSourceId, query = {}) {
  const id=sourceId(rawSourceId);
  closed(query,[]);
  // Capture before waiting for a connection; never rebind a delayed read.
  const observed={id:auth?.id,session_version:auth?.session_version};
  const db=await pool.connect();let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await currentAdmin(db,observed);
    const value=contextDto(await snapshot(db,id));await db.query('COMMIT');return value;
  } catch(error) {try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}
  finally{db.release(discard);}
}

async function result(db, receipt, created) {
  const rows=(await db.query('SELECT video_id FROM produccion_revision_lote_videos WHERE lote_id=$1 ORDER BY ordinal',[receipt.id])).rows;
  return {reconciliation_id:receipt.id,visita_id:receipt.visita_id,video_ids:rows.map(row=>row.video_id),created};
}

export async function reconcileProductionHistoryBatch(pool, auth, body) {
  const input=validateProductionHistoryBatch(body),hash=productionValueHash(input);
  return withProductionAuthority(pool,auth,true,async(db,actor)=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['production-history-batch-v2',actor.id,input.request_id])]);
    const replay=(await db.query('SELECT id,visita_id,payload_hash FROM produccion_revision_lotes WHERE actor_user_id=$1 AND request_id=$2',[actor.id,input.request_id])).rows[0];
    if(replay){if(replay.payload_hash!==hash)throw fail('La solicitud ya se utilizó con otros datos.');return result(db,replay,false);}
    await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
    const before=await snapshot(db,input.source_task_id);
    const taskIds=[...new Set([input.source_task_id,...before.children.map(t=>t.id),...before.related.map(t=>t.id),...before.maps.map(m=>m.tarea_edicion_id)])].sort((a,b)=>a-b);
    const keys=(await db.query(`SELECT DISTINCT o.clave,to_char(o.periodo,'YYYY-MM') periodo FROM cliente_objetivo_piezas s
      JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id WHERE s.tarea_id=ANY($1::int[]) ORDER BY periodo,clave`,[taskIds])).rows;
    for(const key of keys)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`objetivo:${key.periodo}:${key.clave}`]);
    await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[taskIds]);
    // Locks owners/participants before visit/video resources; task row locks
    // serialize ordinary assignment mutations before eligibility is reread.
    const ownerIds=[...new Set([...before.children.flatMap(t=>(t.owners||[]).map(u=>u.id)),...(input.visit_fields?.participante_ids ?? [])])].sort((a,b)=>a-b);
    if(ownerIds.length)await db.query('SELECT id FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE',[ownerIds]);
    await db.query('SELECT id FROM clientes WHERE id=$1 AND activo IS TRUE FOR SHARE',[before.source.cliente_id]);
    if(before.visit){await db.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR UPDATE',[before.visit.id]);
      await db.query('SELECT id FROM produccion_videos WHERE visita_id=$1 ORDER BY id FOR UPDATE',[before.visit.id]);}
    const fresh=await snapshot(db,input.source_task_id);
    if(fresh.contextHash!==before.contextHash || fresh.contextHash!==input.expected_context_hash || fresh.source.revision!==input.expected_source_revision
      || (fresh.visit?.id ?? null)!==input.visit_id || (fresh.visit?.revision ?? null)!==input.expected_visit_revision)throw fail('El expediente cambió. Revisá nuevamente antes de guardar.');
    if(fresh.children.length!==input.child_dispositions.length || fresh.children.some(t=>!input.child_dispositions.some(c=>c.task_id===t.id&&c.expected_revision===t.revision)))throw fail('Revisá explícitamente todas las tareas originales.');
    if(fresh.videos.length+input.videos.filter(video=>!video.existing_video_id).length>50)throw fail('La visita supera cincuenta videos. No se recortará la revisión.',413);
    const selected=input.videos.map(item=>{
      const video=item.existing_video_id ? fresh.videos.find(v=>v.id===item.existing_video_id) : {id:randomUUID(),...item.new_video};
      if(!video)throw fail('El video seleccionado no pertenece a esta visita.');
      const mapping=fresh.maps.find(m=>m.video_id===video.id || m.tarea_edicion_id===item.task_id);
      if(mapping && (item.disposition!=='adopt_original'||mapping.video_id!==video.id||mapping.tarea_edicion_id!==item.task_id||mapping.visita_id!==fresh.visit?.id))throw fail('La correspondencia original no se puede reemplazar.');
      return {item,video,mapping};
    });
    for(const {item,video,mapping}of selected){
      if(item.disposition==='adopt_original'){
        const task=fresh.children.find(t=>t.id===item.task_id);
        if(video.estado!=='grabado'||!originalTaskCompatible(task,fresh.source,{existing:Boolean(mapping)})
          || task.bound_video_ids?.some(id=>id!==video.id)
          || (video.tarea_edicion_id!=null&&video.tarea_edicion_id!==task.id)
          || (!mapping&&(video.publicacion_id!=null||video.tarea_entrega_id!=null)))throw fail('La tarea original no corresponde a un único video grabado compatible.');
        if(mapping&&!await batchLiveVideoCompatible(db,fresh.visit,fresh.source,video.id,task.id,true))throw fail('El vínculo original dejó de ser compatible.');
      }else if(video.tarea_edicion_id!=null||video.tarea_entrega_id!=null||video.publicacion_id!=null){
        if(!await batchLiveVideoCompatible(db,fresh.visit,fresh.source,video.id,null,false))throw fail('El video tiene un vínculo que requiere revisión específica.');
      }
    }
    const visitId=fresh.visit?.id ?? randomUUID(),loteId=randomUUID();
    if(!fresh.visit){
      const fields=input.visit_fields;
      if(fields.participante_ids.length){const active=(await db.query('SELECT id FROM usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE ORDER BY id',[fields.participante_ids])).rows;
        if(active.length!==fields.participante_ids.length)throw fail('Uno de los participantes ya no está activo.');}
      await db.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,drive_url,creado_por_id,actualizado_por_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[visitId,fresh.source.id,fresh.source.cliente_id,fresh.source.source_date,fields.titulo,fields.observaciones,fields.drive_url,actor.id]);
      if(fields.participante_ids.length)await db.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) SELECT $1,unnest($2::int[])',[visitId,fields.participante_ids]);
    }
    await db.query(`INSERT INTO produccion_revision_lotes(id,actor_user_id,request_id,payload_hash,tarea_origen_id,source_revision,source_history_hash,context_hash,visita_id,observed_visit_revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[loteId,actor.id,input.request_id,hash,fresh.source.id,fresh.source.revision,productionHistoryHash(fresh.source),fresh.contextHash,visitId,input.expected_visit_revision]);
    const keyToId=new Map();
    for(const [index,{item,video,mapping}]of selected.entries()){
      keyToId.set(item.existing_video_id ?? item.local_key,video.id);
      if(!item.existing_video_id)await db.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,material_url,observaciones,creado_por_id,actualizado_por_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[video.id,visitId,video.titulo,video.guion,video.estado,video.material_url,video.observaciones,actor.id]);
      if(item.disposition==='adopt_original'&&!mapping){
        const task=fresh.children.find(t=>t.id===item.task_id);
        await db.query('UPDATE produccion_videos SET tarea_edicion_id=$2,editor_id=$3,fecha_entrega=$4,actualizado_por_id=$5,updated_at=now() WHERE id=$1',[video.id,task.id,task.owners[0].id,task.fecha_entrega,actor.id]);
        await db.query(`INSERT INTO produccion_lote_edicion_mapeos(video_id,visita_id,tarea_edicion_id,task_revision,editor_id,fecha_entrega,lote_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[video.id,visitId,task.id,task.revision,task.owners[0].id,task.fecha_entrega,loteId]);
      }
      await db.query(`INSERT INTO produccion_revision_lote_videos(lote_id,video_id,ordinal,disposition,tarea_edicion_id)
        VALUES($1,$2,$3,$4,$5)`,[loteId,video.id,index+1,item.disposition,item.task_id]);
    }
    for(const child of input.child_dispositions)await db.query(`INSERT INTO produccion_revision_lote_hijos(lote_id,tarea_id,task_revision,disposition,video_id,reason)
      VALUES($1,$2,$3,$4,$5,$6)`,[loteId,child.task_id,child.expected_revision,child.disposition,child.video_key===null?null:keyToId.get(child.video_key),child.reason]);
    if(fresh.visit)await db.query('UPDATE produccion_visitas SET revision=revision+1,actualizado_por_id=$2,updated_at=now() WHERE id=$1',[visitId,actor.id]);
    return {reconciliation_id:loteId,visita_id:visitId,video_ids:selected.map(s=>s.video.id),created:true};
  });
}
