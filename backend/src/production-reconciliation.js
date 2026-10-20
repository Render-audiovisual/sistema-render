import crypto from 'node:crypto';
import { isProductionVisitTask, isValidProductionDate } from './production-visits.js';
import { hasLegacyProductionSource } from './production-editorial.js';
import { productionHistoryHash } from './production-history.js';

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
  closed(body,['request_id','source_task_id','expected_source_revision','acknowledgement','titulo','participante_ids','drive_url','observaciones','videos']);
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
  const input=validateProductionReconciliation(body),hash=payloadHash(input),db=await pool.connect();
  try {
    await db.query('BEGIN');
    const actor=await currentAdmin(db,auth);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`production-reconciliation:${actor.id}:${input.request_id}`]);
    const replay=(await db.query('SELECT id,visita_id,payload_hash FROM produccion_reconciliaciones WHERE actor_user_id=$1 AND request_id=$2 FOR UPDATE',[actor.id,input.request_id])).rows[0];
    if(replay) {
      if(replay.payload_hash!==hash)throw fail('La solicitud ya se usó con otros datos.',409);
      const response=await result(db,replay,false);await db.query('COMMIT');return response;
    }
    const source=(await db.query("SELECT *,to_char(fecha_vencimiento,'YYYY-MM-DD') AS source_date FROM tareas WHERE id=$1 FOR UPDATE",[input.source_task_id])).rows[0];
    if(!source||!isProductionVisitTask(source)||source.propiedades_extra?.workspace!=='render_os'
      ||['archivada_render_os','papelera_render_os'].some(key=>[true,'true'].includes(source.propiedades_extra?.[key])))throw fail('Visita histórica disponible no encontrada.',404);
    if(source.revision!==input.expected_source_revision)throw fail('La tarea cambió. Revisá el origen antes de conciliar.',409);
    if(!positive(source.cliente_id)||!isValidProductionDate(source.source_date))throw fail('La tarea necesita cliente y fecha válidos.',409);
    if((await db.query('SELECT id FROM produccion_reconciliaciones WHERE tarea_origen_id=$1',[source.id])).rows.length)throw fail('El origen ya tiene una conciliación. Revisá su registro.',409);
    if((await db.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1',[source.id])).rows.length)throw fail('El origen ya tiene una visita. Requiere revisión específica.',409);
    if((await db.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 LIMIT 1",[String(source.id)])).rows.length)throw fail('manual_mapping_required: la edición agregada existente no se puede repartir automáticamente.',409);
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
    }
    const response=await result(db,{id:reviewId,visita_id:visitId},true);
    await db.query('COMMIT');return response;
  }catch(error) {await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
export function registerProductionReconciliationRoutes(router,{pool,handle}) {
  router.post('/reconciliaciones',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(Object.keys(req.query??{}).length)throw fail('La conciliación no acepta filtros de identidad.');
    const value=await reconcileProductionHistory(pool,req.auth,req.body);
    return res.status(value.created?201:200).json(value);
  }));
}
