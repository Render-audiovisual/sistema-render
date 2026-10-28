import crypto from 'node:crypto';
import { isProductionVisitTask, isValidProductionDate } from './production-visits.js';
import { hasLegacyProductionSource } from './production-editorial.js';
import { productionHistoryHash } from './production-history.js';
import { prepareProductionEditingAdoption, persistProductionEditingAdoption } from './production-editing-adoption.js';
import { readProductionHistoryBatchContext, reconcileProductionHistoryBatch } from './production-history-batches.js';
import { bindCapturedOwnerProfileAuthority, captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function closed(value,fields) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw fail('Campos de conciliación no válidos.');
}
function text(value,max,required=false) {
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail('Texto de conciliación no válido.');
  return required?value.trim():value;
}
function url(value='') {
  const result=text(value,4000).trim();
  if(result) { try {const parsed=new URL(result);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();}
    catch {throw fail('El material debe ser un enlace HTTP(S) válido.');} }
  return result;
}
export function validateProductionReconciliation(body) {
  closed(body,['request_id','source_task_id','expected_source_revision','acknowledgement','titulo','participante_ids','drive_url','observaciones','videos','existing_editing']);
  if(!uuid(body.request_id)||!positive(body.source_task_id)||!positive(body.expected_source_revision)
    ||body.acknowledgement!=='videos_identificados_manualmente')throw fail('Confirmá la identificación manual y la revisión de origen.');
  const people=body.participante_ids===undefined?[]:body.participante_ids;
  if(!Array.isArray(people)||people.length>100||people.some(id=>!positive(id))||new Set(people).size!==people.length)throw fail('Participantes no válidos.');
  if(!Array.isArray(body.videos)||body.videos.length<1||body.videos.length>50)throw fail('Identificá entre uno y cincuenta videos.');
  const videos=body.videos.map(video=>{
    closed(video,['titulo','guion','estado','material_url','observaciones']);
    if(!['planificado','grabado','pendiente','repetir'].includes(video.estado))throw fail('Estado del video no válido.');
    return {titulo:text(video.titulo,250,true),guion:text(video.guion===undefined?'':video.guion,20000),estado:video.estado,
      material_url:url(video.material_url),observaciones:text(video.observaciones===undefined?'':video.observaciones,20000)};
  });
  const input={request_id:body.request_id.toLowerCase(),source_task_id:body.source_task_id,expected_source_revision:body.expected_source_revision,
    acknowledgement:body.acknowledgement,titulo:text(body.titulo,250,true),participante_ids:[...people].sort((a,b)=>a-b),
    drive_url:url(body.drive_url),observaciones:text(body.observaciones===undefined?'':body.observaciones,20000),videos};
  if(body.existing_editing!==undefined) {
    const editing=body.existing_editing;
    closed(editing,['task_id','expected_revision','video_ordinal','acknowledgement']);
    if(!positive(editing.task_id)||editing.task_id===body.source_task_id||!positive(editing.expected_revision)
      ||!positive(editing.video_ordinal)||editing.video_ordinal>videos.length
      ||editing.acknowledgement!=='esta_tarea_edita_un_solo_video'||videos[editing.video_ordinal-1].estado!=='grabado')
      throw fail('Confirmá la correspondencia de una tarea original con un único video grabado.');
    input.existing_editing={task_id:editing.task_id,expected_revision:editing.expected_revision,
      video_ordinal:editing.video_ordinal,acknowledgement:editing.acknowledgement};
  }
  if(Buffer.byteLength(JSON.stringify(input),'utf8')>900000)throw fail('La conciliación es demasiado grande.',413);
  return input;
}
const payloadHash=input=>crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
async function currentAdmin(db,auth) {
  if(!positive(auth?.id)||!Number.isSafeInteger(auth.session_version))throw fail('Sesión requerida.',401);
  const user=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE',[auth.id])).rows[0];
  if(!user||user.activo!==true||user.session_version!==auth.session_version)throw fail('La sesión ya no está activa.',401);
  if(user.rol!=='admin')throw fail('Solo administración puede conciliar producción histórica.',403);
  return user;
}
async function result(db,receipt,created) {
  const videos=(await db.query('SELECT video_id FROM produccion_reconciliacion_videos WHERE reconciliacion_id=$1 ORDER BY ordinal',[receipt.id])).rows;
  return {reconciliation_id:receipt.id,visita_id:receipt.visita_id,video_ids:videos.map(row=>row.video_id),created};
}
export async function reconcileProductionHistory(pool,auth,body) {
  const input=validateProductionReconciliation(body),hash=payloadHash(input);
  const observed=bindCapturedOwnerProfileAuthority(auth,Object.freeze({id:auth?.id,rol:auth?.rol,session_version:auth?.session_version}));
  const authority=captureOwnerProfileWriteAuthority(observed);
  const db=await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // The existing shared editing mutex must precede principal/actor locks.
    if(input.existing_editing)await db.query("SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
    await retainCapturedOwnerProfileAuthority(db,authority,{lockMode:'share'});
    const actor=await currentAdmin(db,observed);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`production-reconciliation:${actor.id}:${input.request_id}`]);
    const replay=(await db.query('SELECT id,visita_id,payload_hash FROM produccion_reconciliaciones WHERE actor_user_id=$1 AND request_id=$2 FOR UPDATE',[actor.id,input.request_id])).rows[0];
    if(replay) {
      if(replay.payload_hash!==hash)throw fail('La solicitud ya se usó con otros datos.',409);
      const response=await result(db,replay,false);await db.query('COMMIT');return response;
    }
    if(input.existing_editing) {
      // Match editing deliveries/reviews: global advisory before ordered task
      // locks, before any visit/video lock or creation. No task is rewritten.
      await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
        [[input.source_task_id,input.existing_editing.task_id].sort((a,b)=>a-b)]);
    }
    const source=(await db.query("SELECT *,to_char(fecha_vencimiento,'YYYY-MM-DD') AS source_date FROM tareas WHERE id=$1 FOR UPDATE",[input.source_task_id])).rows[0];
    if(!source||!isProductionVisitTask(source)||source.propiedades_extra?.workspace!=='render_os'
      ||['archivada_render_os','papelera_render_os'].some(key=>[true,'true'].includes(source.propiedades_extra?.[key])))throw fail('Visita histórica disponible no encontrada.',404);
    if(source.revision!==input.expected_source_revision)throw fail('La tarea cambió. Revisá el origen antes de conciliar.',409);
    if(!positive(source.cliente_id)||!isValidProductionDate(source.source_date))throw fail('La tarea necesita cliente y fecha válidos.',409);
    if((await db.query('SELECT id FROM produccion_reconciliaciones WHERE tarea_origen_id=$1',[source.id])).rows.length)throw fail('El origen ya tiene una conciliación. Revisá su registro.',409);
    if((await db.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1',[source.id])).rows.length)throw fail('El origen ya tiene una visita. Requiere revisión específica.',409);
    const adoption=input.existing_editing?await prepareProductionEditingAdoption(db,source,input.existing_editing):null;
    if(!adoption&&(await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 LIMIT 1",[String(source.id)])).rows.length)throw fail('manual_mapping_required: la edición agregada existente no se puede repartir automáticamente.',409);
    if(!await hasLegacyProductionSource(db,source.id,source))throw fail('El origen no contiene producción histórica agregada.',409);
    if(!(await db.query('SELECT id FROM clientes WHERE id=$1 AND activo IS TRUE FOR SHARE',[source.cliente_id])).rows.length)throw fail('Cliente activo no encontrado.',409);
    if(input.participante_ids.length) {
      const people=(await db.query('SELECT id FROM usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE ORDER BY id FOR SHARE',[input.participante_ids])).rows;
      if(people.length!==input.participante_ids.length)throw fail('Uno de los participantes no está activo.',409);
    }
    const visitId=crypto.randomUUID(),reviewId=crypto.randomUUID();
    await db.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,drive_url,creado_por_id,actualizado_por_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[visitId,source.id,source.cliente_id,source.source_date,input.titulo,input.observaciones,input.drive_url,actor.id]);
    if(input.participante_ids.length)await db.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) SELECT $1,unnest($2::int[])',[visitId,input.participante_ids]);
    await db.query(`INSERT INTO produccion_reconciliaciones(id,actor_user_id,request_id,payload_hash,tarea_origen_id,source_revision,source_history_hash,visita_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[reviewId,actor.id,input.request_id,hash,source.id,source.revision,productionHistoryHash(source),visitId]);
    for(const [index,video]of input.videos.entries()) {
      const id=crypto.randomUUID();
      await db.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,material_url,observaciones,creado_por_id,actualizado_por_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[id,visitId,video.titulo,video.guion,video.estado,video.material_url,video.observaciones,actor.id]);
      await db.query('INSERT INTO produccion_reconciliacion_videos(reconciliacion_id,video_id,ordinal) VALUES($1,$2,$3)',[reviewId,id,index+1]);
      if(adoption?.ordinal===index+1)await persistProductionEditingAdoption(db,adoption,reviewId,id);
    }
    const response=await result(db,{id:reviewId,visita_id:visitId},true);
    await db.query('COMMIT');return response;
  }catch(error) {try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}finally{db.release(discard);}
}

function contextText(value,max=20000) {
  if(value==null||typeof value!=='string')return '';
  if(value.length>max)throw fail('El contexto histórico supera el tamaño permitido.',413);
  return value;
}
function historyInteger(value) {
  if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&String(Number(value))===value)value=Number(value);
  return Number.isSafeInteger(value)&&value>0?value:null;
}
function contextHistory(metadata) {
  const records=metadata.produccion_registros;
  let recorded=0;
  if(records!=null&&!Array.isArray(records))recorded=null;
  else for(const record of records||[]) {
    const amount=historyInteger(record?.cantidad);
    if(amount===null||!Number.isSafeInteger(recorded+amount)){recorded=null;break;}
    recorded+=amount;
  }
  return {records_count:records==null?0:Array.isArray(records)?records.length:null,
    recorded_count:recorded,declared_count:historyInteger(metadata.produccion_videos_previstos),
    confirmed:Boolean(metadata.produccion_confirmada_at)};
}

export async function readProductionReconciliationContext(pool,auth,rawSourceId,query={}) {
  if(typeof rawSourceId!=='string'||!/^[1-9][0-9]*$/.test(rawSourceId)
    ||!positive(Number(rawSourceId))||String(Number(rawSourceId))!==rawSourceId)throw fail('Origen inválido.');
  if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).length)throw fail('El contexto no admite filtros.');
  const db=await pool.connect();
  try {
    // currentAdmin takes FOR SHARE; this snapshot issues SELECTs only, but must
    // not use READ ONLY, which PostgreSQL forbids with that row lock.
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await currentAdmin(db,auth);
    const source=(await db.query(`SELECT t.id,t.revision,t.titulo,t.tipo_tarea,t.subtipo,t.cliente_id,
      t.aclaraciones,t.material_referencia,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS source_date,
      c.id AS context_client_id,c.nombre AS cliente_nombre,c.activo AS cliente_activo,
      jsonb_build_object('workspace',t.propiedades_extra->'workspace','clickup_lista',t.propiedades_extra->'clickup_lista',
        'archivada_render_os',t.propiedades_extra->'archivada_render_os','papelera_render_os',t.propiedades_extra->'papelera_render_os',
        'produccion_registros',t.propiedades_extra->'produccion_registros',
        'produccion_videos_previstos',t.propiedades_extra->'produccion_videos_previstos',
        'produccion_confirmada_at',t.propiedades_extra->'produccion_confirmada_at',
        'guiones',t.propiedades_extra->'guiones','material',t.propiedades_extra->'material','Material',t.propiedades_extra->'Material',
        'feedback',t.propiedades_extra->'feedback','horario',t.propiedades_extra->'horario') AS propiedades_extra
      FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.id=$1`,[Number(rawSourceId)])).rows[0];
    if(!source||!isProductionVisitTask(source)||source.propiedades_extra?.workspace!=='render_os')throw fail('Visita histórica no encontrada.',404);
    const metadata=source.propiedades_extra;
    const registry=(await db.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1',[source.id])).rows[0];
    // Original editing evidence stays on these task IDs. Return links/labels
    // only, never raw properties, financial bags or a fabricated video mapping.
    const children=(await db.query("SELECT id,revision,titulo,estado,COALESCE(propiedades_extra->>'workspace'='render_os',false) AS en_workspace FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 ORDER BY id LIMIT 51",[String(source.id)])).rows;
    if(children.length>50)throw fail('El expediente tiene demasiadas tareas vinculadas para esta revisión.',413);
    const editingTasks=children.map(row=>{
      if(!positive(row.id)||!positive(row.revision)||typeof row.titulo!=='string'||typeof row.estado!=='string')throw fail('No se pudo verificar una tarea del expediente histórico.',409);
      return {id:row.id,revision:row.revision,titulo:contextText(row.titulo),estado:contextText(row.estado,100),en_workspace:row.en_workspace===true};
    });
    const historical=await hasLegacyProductionSource(db,source.id,source);
    const unavailable=['archivada_render_os','papelera_render_os'].some(key=>[true,'true'].includes(metadata[key]))
      ||!positive(source.context_client_id)||source.cliente_activo!==true||!isValidProductionDate(source.source_date);
    const status=unavailable?'unavailable':registry?'already_linked':children.length?'legacy_editing':!historical?'not_historical':'ready';
    const recordedMaterial=typeof metadata.material==='string'&&metadata.material?metadata.material:metadata.Material;
    const response={version:1,source:{id:source.id,revision:source.revision,titulo:contextText(source.titulo),
      cliente:positive(source.context_client_id)?{id:source.context_client_id,nombre:contextText(source.cliente_nombre)}:null,
      fecha:isValidProductionDate(source.source_date)?source.source_date:null,
      content:{instructions:contextText(source.aclaraciones),script:contextText(metadata.guiones),
        material:contextText(source.material_referencia,4000),recorded_material:contextText(recordedMaterial,4000),
        feedback:contextText(metadata.feedback),schedule:contextText(metadata.horario)}},
      history:contextHistory(metadata),eligibility:{status,visita_id:registry&&uuid(registry.id)?registry.id:null},legacy_editing_tasks:editingTasks};
    await db.query('COMMIT');return response;
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}

export function registerProductionReconciliationRoutes(router,{pool,handle}) {
  router.get('/reconciliaciones/lotes/origen/:sourceId',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');
    return res.json(await readProductionHistoryBatchContext(pool,req.auth,req.params.sourceId,req.query??{}));
  }));
  router.get('/reconciliaciones/origen/:sourceId',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');
    return res.json(await readProductionReconciliationContext(pool,req.auth,req.params.sourceId,req.query??{}));
  }));
  router.post('/reconciliaciones',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(Object.keys(req.query??{}).length)throw fail('La conciliación no acepta filtros de identidad.');
    const value=req.body?.version===2 ? await reconcileProductionHistoryBatch(pool,req.auth,req.body)
      : await reconcileProductionHistory(pool,req.auth,req.body);
    return res.status(value.created?201:200).json(value);
  }));
}
