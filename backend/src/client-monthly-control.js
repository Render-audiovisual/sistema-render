import {createHash,randomUUID} from 'node:crypto';
import {CLIENT_CATALOG_SQL} from './client-catalog.js';
import {captureClientCreator,lockCurrentClientCreator} from './client-create-authority.js';
import {lockClientAdministration} from './client-agreement.js';
import {captureOwnerProfileWriteAuthority,checkCapturedOwnerProfileAuthority} from './owner-profile-authority.js';
import {instagramFeedGroupCounts} from '../../shared/instagram-feed-counts.mjs';
import {instagramMonthlyGroupObservation} from '../../shared/instagram-monthly-observation.mjs';
import {validMonthlyKey,validMonthlyPeriod,validMonthlyCount,groupMonthlyAdjustment,MONTHLY_ADJUSTMENT_ACTION} from '../../shared/client-monthly-adjustment.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function captureMonthlyClientOwner(auth,manager){
 const p=manager?.policy;
 if(!p||![p.accountId,p.francoUserId,p.agustinUserId].includes(auth?.id))throw fail(403,'Solo Líder, Franco o Agustín pueden editar estas cantidades.');
 return captureClientCreator(auth);
}
function context(key,period){if(!validMonthlyKey(key)||!validMonthlyPeriod(period))throw fail(400,'Cliente o mes inválido.');}
async function state(db,key,period){
 const rows=(await db.query(CLIENT_CATALOG_SQL,[`${period}-01`])).rows.filter(c=>(c.grupo_feed_id?`grupo-${c.grupo_feed_id}`:`cliente-${c.id}`)===key);
 if(!rows.length)throw fail(404,'Cliente no encontrado.');
 const members=rows.map(c=>c.id).sort((a,b)=>a-b),first=rows[0],group=Boolean(first.grupo_feed_id);
 const adjustment=groupMonthlyAdjustment(rows,period),observation=instagramMonthlyGroupObservation(rows,period),feed=instagramFeedGroupCounts(rows,period);
 const ambiguous=rows.length>1&&rows.some(c=>instagramMonthlyGroupObservation([c],period)?.agencyConfirmed);
 const baseline=ambiguous?null:observation?.agencyConfirmed?observation:feed.status!=='unavailable'?feed:observation;
 const revision='cm1:'+createHash('sha256').update(JSON.stringify([key,period,members,rows.map(c=>[c.id,c.agreement_revision]),adjustment?.revision??null])).digest('hex');
 return {key,period,memberIds:members,revision,name:first.grupo_feed_nombre||first.nombre,
   quota:{reels:first[group?'cuota_feed_reels':'cuota_reels'],carruseles:first[group?'cuota_feed_carruseles':'cuota_carruseles']},
   actual:adjustment?.mode==='manual'?{reels:adjustment.reels,carruseles:adjustment.carruseles}:{reels:baseline?.reels??null,carruseles:baseline?.carruseles??null},
   automatic:{reels:baseline?.reels??null,carruseles:baseline?.carruseles??null},mode:adjustment?.mode??'automatic'};
}
export async function clientMonthlyControl(pool,auth,manager,key,period,kind,body){
 context(key,period);if(!['read','quota','actual'].includes(kind))throw fail(400,'Operación inválida.');
 const observed=captureMonthlyClientOwner(auth,manager),write=kind!=='read';
 if(write){
  const fields=kind==='quota'?['period','reels','carruseles','expected_revision']:['period','mode','reels','carruseles','expected_revision'];
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k))||body.period!==period
   ||typeof body.expected_revision!=='string'||!/^cm1:[a-f0-9]{64}$/.test(body.expected_revision)
   ||kind!=='quota'&&!['manual','automatic'].includes(body.mode)
   ||kind==='actual'&&body.mode==='automatic'&&('reels' in body||'carruseles' in body)
   ||(kind==='quota'||body.mode==='manual')&&![body.reels,body.carruseles].every(validMonthlyCount))throw fail(400,'Ingresá cantidades enteras entre 0 y 10000 y volvé a verificar la versión guardada.');
 }
 const db=await pool.connect();let discard;
 try{
  await db.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if(write)await lockClientAdministration(db);
  if(write)await lockCurrentClientCreator(db,observed);
  else{await checkCapturedOwnerProfileAuthority(db,captureOwnerProfileWriteAuthority(observed));
   const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[observed.id])).rows[0];
   if(!actor||actor.activo!==true||actor.session_version!==observed.session_version)throw fail(401,'La sesión cambió.');
   if(actor.rol!=='admin')throw fail(403,'Solo dirección puede editar cantidades.');}
  if(write){await db.query(`SELECT id FROM clientes WHERE (CASE WHEN grupo_feed_id IS NULL THEN 'cliente-'||id ELSE 'grupo-'||grupo_feed_id END)=$1 ORDER BY id FOR UPDATE`,[key]);
   if(key.startsWith('grupo-'))await db.query('SELECT id FROM grupos_feed WHERE id=$1 FOR UPDATE',[Number(key.split('-')[1])]);}
  const before=await state(db,key,period);
  if(write&&before.revision!==body.expected_revision)throw fail(409,'Otro integrante cambió el cliente o el conteo. Cerrá y volvé a abrir para revisar la versión actual.');
  if(kind==='quota'){
   if(key.startsWith('grupo-'))await db.query('UPDATE grupos_feed SET cuota_reels=$2::integer,cuota_carruseles=$3::integer,cuota_mensual=$2::integer+$3::integer WHERE id=$1',[Number(key.split('-')[1]),body.reels,body.carruseles]);
   else{
    const id=before.memberIds[0];
    await db.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,dias_reels,dias_carruseles,disenador_responsable,abono_mensual)
      SELECT cliente_id,$2::date,$3,$4,dias_historias,dias_reels,dias_carruseles,disenador_responsable,abono_mensual FROM cliente_configuraciones
      WHERE cliente_id=$1 AND vigente_desde<=$2::date ORDER BY vigente_desde DESC LIMIT 1
      ON CONFLICT(cliente_id,vigente_desde) DO UPDATE SET cuota_reels=EXCLUDED.cuota_reels,cuota_carruseles=EXCLUDED.cuota_carruseles`,[id,`${period}-01`,body.reels,body.carruseles]);
    await db.query('UPDATE clientes SET cuota_reels=$2,cuota_carruseles=$3 WHERE id=$1',[id,body.reels,body.carruseles]);
   }
  }
  if(write){const details=kind==='quota'?{version:1,key,period,reels:body.reels,carruseles:body.carruseles}:
    {version:1,key,period,memberIds:before.memberIds,revision:randomUUID(),checkedAt:new Date().toISOString(),mode:body.mode,
      ...(body.mode==='manual'?{reels:body.reels,carruseles:body.carruseles}:{})};
   await db.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
     VALUES('client_monthly_control','web',$1,$2,$3,'ok',$4::jsonb)`,[String(observed.id),'Dirección',kind==='quota'?'monthly_quota_updated_v1':MONTHLY_ADJUSTMENT_ACTION,JSON.stringify(details)]);
  }
  const saved=write?await state(db,key,period):before;
  await db.query('COMMIT');return saved;
 }catch(error){try{await db.query('ROLLBACK');}catch(e){discard=e;}throw error;}finally{db.release(discard);}
}
export function createClientMonthlyControlRouter({express,pool,ownerProfiles}){
 const router=express.Router();const route=kind=>async(req,res,next)=>{res.set('Cache-Control','no-store');try{
   if(Object.keys(req.query||{}).some(k=>kind==='read'?k!=='periodo':true))throw fail(400,'Consulta inválida.');
   res.json(await clientMonthlyControl(pool,req.auth,ownerProfiles,req.params.key,kind==='read'?req.query.periodo:req.body?.period,kind,req.body));
  }catch(e){if([400,401,403,404,409].includes(e.status))return res.status(e.status).json({error:e.message});next(e);}};
 router.get('/:key/control-mensual',route('read'));router.put('/:key/cuota-mensual',route('quota'));router.put('/:key/contenido-realizado',route('actual'));return router;
}
// Legacy editors remain available to owners, never as an alternative route for
// a non-mapped administrator to bypass the new card's owner-only policy.
export function clientMonthlyLegacyOwnerGuard(ownerProfiles){
 return (req,res,next)=>{
  const legacyEdit=req.method==='PATCH'&&/^\/[1-9]\d*\/?$/.test(req.path)
   ||req.method==='POST'&&/^\/[1-9]\d*\/(configuraciones|abono-proximo-mes|acuerdo-mensual\/iniciar)\/?$/.test(req.path);
  if(!legacyEdit)return next();
  try{captureMonthlyClientOwner(req.auth,ownerProfiles);next();}
  catch(error){return res.status(error.status||403).json({error:error.message});}
 };
}
