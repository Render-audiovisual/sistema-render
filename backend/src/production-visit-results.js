import { createHash, randomUUID } from 'node:crypto';
import { withProductionAuthority } from './production-authority.js';
import { withProductionReadSnapshot } from './production-read-snapshot.js';
import { getProductionProgress } from './production-visits.js';
import { rejectLegacyProductionSource } from './production-editorial.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<2147483647;
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]??null]));
const VISIT_KEYS=['id','tarea_origen_id','cliente_id','fecha','titulo','participante_ids','drive_url','observaciones'];
const VIDEO_KEYS=['id','video_origen_id','titulo','guion','estado','material_url','observaciones'];
const PHOTO_KEYS=['id','tipo','estado','drive_url','observaciones'];
const COUNT_KEYS=['videos_grabados','videos_pendientes','videos_repetir','fotos_realizadas','fotos_pendientes','fotos_repetir'];
export function validateProductionResult(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['request_id','expected_revision'].includes(key))
    || !uuid(input.request_id)||!positive(input.expected_revision))throw fail('Actualizá la visita y confirmá un intento válido.');
  return Object.freeze({request_id:input.request_id.toLowerCase(),expected_revision:input.expected_revision});
}
export function productionResultSummary(visit,videos,fotos,previstos=0) {
  if(!videos.length&&!fotos.length)throw fail('Registrá los videos o las fotos antes de guardar el resultado.');
  if(videos.some(item=>!['grabado','pendiente','repetir'].includes(item.estado)))throw fail('Indicá qué videos se grabaron, quedaron pendientes o deben repetirse.');
  if(videos.some(item=>['pendiente','repetir'].includes(item.estado)&&!String(item.guion||'').trim()))throw fail('Conservá el guion de cada video pendiente o para repetir antes de cerrar el registro.');
  if(videos.length<previstos)throw fail('Registrá los videos faltantes como pendientes, con sus guiones.');
  if(fotos.some(item=>!['realizada','pendiente','repetir'].includes(item.estado)))throw fail('Revisá el estado de las fotos.');
  const count=(rows,state)=>rows.filter(item=>item.estado===state).length;
  const conteos={videos_grabados:count(videos,'grabado'),videos_pendientes:count(videos,'pendiente'),videos_repetir:count(videos,'repetir'),
    fotos_realizadas:count(fotos,'realizada'),fotos_pendientes:count(fotos,'pendiente'),fotos_repetir:count(fotos,'repetir')};
  const result={version:1,visita:pick(visit,VISIT_KEYS),videos:videos.map(item=>pick(item,VIDEO_KEYS)),fotos:fotos.map(item=>pick(item,PHOTO_KEYS)),
    previstos,conteos,parcial:conteos.videos_pendientes+conteos.videos_repetir+conteos.fotos_pendientes+conteos.fotos_repetir>0};
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>2000000)throw fail('El resultado es demasiado grande para un solo registro.',413);
  return result;
}
export function productionResultDto(row,currentRevision) {
  const saved=row.resumen;
  return {...pick(row,['id','visita_id','visita_revision','revision_resultante','registrado_por_id','registrado_at']),
    resumen:{version:1,visita:pick(saved.visita,VISIT_KEYS),videos:saved.videos.map(item=>pick(item,VIDEO_KEYS)),
      fotos:saved.fotos.map(item=>pick(item,PHOTO_KEYS)),previstos:saved.previstos,conteos:pick(saved.conteos,COUNT_KEYS),parcial:saved.parcial===true},
    vigente:row.revision_resultante===currentRevision};
}
export function registerProductionVisitResultRoutes(router,{pool,handle,lockVisit,checkRevision,bump,sourceTask}) {
  const visitId=req=>{if(!uuid(req.params.id))throw fail('Visita inválida.');return req.params.id.toLowerCase();};
  router.post('/:id/resultados',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');
    const id=visitId(req),input=validateProductionResult(req.body);
    const hash=createHash('sha256').update(JSON.stringify({version:1,visita_id:id,expected_revision:input.expected_revision})).digest('hex');
    const result=await withProductionAuthority(pool,req.auth,false,async(db,actor)=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtext('production-result-request'),hashtext($1))",[`${actor.id}:${input.request_id}`]);
      const previous=(await db.query('SELECT * FROM produccion_resultados WHERE registrado_por_id=$1 AND request_id=$2',[actor.id,input.request_id])).rows[0];
      if(previous){
        if(previous.visita_id!==id||previous.payload_hash!==hash)throw fail('Este intento corresponde a otro resultado.',409);
        const current=(await db.query('SELECT revision FROM produccion_visitas WHERE id=$1',[id])).rows[0];
        return {created:false,resultado:productionResultDto(previous,current?.revision)};
      }
      const visit=await lockVisit(db,id);checkRevision(visit,input.expected_revision);
      if((await db.query('SELECT id FROM produccion_resultados WHERE visita_id=$1 AND revision_resultante=$2',[id,visit.revision])).rows.length)
        throw fail('El resultado de esta versión ya está registrado. Editá el material antes de registrar una corrección.',409);
      const source=visit.tarea_origen_id?await sourceTask(db,visit.tarea_origen_id,{available:false}):null;
      const videos=(await db.query('SELECT id,video_origen_id,titulo,guion,estado,material_url,observaciones FROM produccion_videos WHERE visita_id=$1 ORDER BY created_at,id',[id])).rows;
      const fotos=(await db.query('SELECT id,tipo,estado,drive_url,observaciones FROM produccion_fotos WHERE visita_id=$1 ORDER BY created_at,id',[id])).rows;
      if(!videos.length)await rejectLegacyProductionSource(db,visit,source);
      for(const video of videos)await rejectLegacyProductionSource(db,visit,source,video.id);
      const summary=productionResultSummary(visit,videos,fotos,getProductionProgress(source||{}).planned);
      const row=(await db.query(`INSERT INTO produccion_resultados(id,visita_id,visita_revision,revision_resultante,registrado_por_id,request_id,payload_hash,resumen)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,[randomUUID(),id,visit.revision,visit.revision+1,actor.id,input.request_id,hash,JSON.stringify(summary)])).rows[0];
      await bump(db,id,actor.id);
      return {created:true,resultado:productionResultDto(row,visit.revision+1)};
    });
    return res.status(result.created?201:200).json(result);
  }));
  router.get('/:id/resultados/intentos/:requestId',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');const id=visitId(req);
    if(!uuid(req.params.requestId)||Object.keys(req.query).length)throw fail('Intento inválido.');
    const result=await withProductionReadSnapshot(pool,req.auth,async db=>{
      const row=(await db.query(`SELECT r.*,v.revision AS actual_revision FROM produccion_resultados r JOIN produccion_visitas v ON v.id=r.visita_id
        WHERE r.visita_id=$1 AND r.registrado_por_id=$2 AND r.request_id=$3`,[id,req.auth.id,req.params.requestId.toLowerCase()])).rows[0];
      if(!row)throw fail('Resultado no encontrado para este intento.',404);
      return productionResultDto(row,row.actual_revision);
    });return res.json({resultado:result});
  }));
  router.get('/:id/resultados',handle(async(req,res)=>{
    res.set('Cache-Control','no-store');const id=visitId(req),cursor=req.query.antes_revision;
    if(Object.keys(req.query).some(key=>key!=='antes_revision')||(cursor!==undefined&&(typeof cursor!=='string'||!/^\d+$/.test(cursor)||!positive(Number(cursor)))))throw fail('Paginación de resultados inválida.');
    const result=await withProductionReadSnapshot(pool,req.auth,async db=>{
      const visit=(await db.query('SELECT revision FROM produccion_visitas WHERE id=$1',[id])).rows[0];
      if(!visit)throw fail('Visita no encontrada.',404);
      const rows=(await db.query(`SELECT * FROM produccion_resultados WHERE visita_id=$1 AND ($2::int IS NULL OR visita_revision<$2)
        ORDER BY visita_revision DESC LIMIT 21`,[id,cursor===undefined?null:Number(cursor)])).rows;
      const page=rows.slice(0,20);
      return {visita_id:id,revision:visit.revision,resultados:page.map(row=>productionResultDto(row,visit.revision)),
        next_before_revision:rows.length>20?page.at(-1).visita_revision:null};
    });return res.json(result);
  }));
}
