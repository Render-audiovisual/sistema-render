import { CLIENT_DESIGNERS } from './client-config.js';
import { assertAgreementRevision, lockClientAdministration, lockClientAgreement, readClientAgreementRevision } from './client-agreement.js';
import { captureClientCreator, lockCurrentClientCreator } from './client-create-authority.js';

const fail=(status,message,code)=>Object.assign(new Error(message),{status,code});
const invalid=()=>fail(400,'Revisá los datos explícitos del acuerdo mensual.','CLIENT_FIRST_AGREEMENT_INPUT');
export function strictAgreementPeriod(value) {
  if(typeof value!=='string'||value.length!==7||!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value))throw invalid();
  return `${value}-01`;
}
export function strictAgreementMoney(value,{numeric=false}={}) {
  if(numeric&&typeof value==='number'&&Number.isFinite(value))value=String(value);
  if(typeof value!=='string'||value.length>15||!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))throw invalid();
  const [whole,fraction='']=value.split('.');return `${whole}.${fraction.padEnd(2,'0')}`;
}
const days=(value,required)=>{
  if(!Array.isArray(value)||value.length>7||(required&&!value.length)||value.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(value).size!==value.length)throw invalid();
  return [...value].sort((a,b)=>a-b);
};
// Compatibility boundary for the existing monthly editor: explicit canonical
// numeric strings and omitted optional preferences remain supported, but
// null/blank/boolean coercions must never become a zero quota, fee or weekday.
export function validateLegacyConfigurationRequest(body) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['vigente_desde','nombre','rubro','cuota_reels','cuota_carruseles','abono_mensual','dias_historias','dias_reels','dias_carruseles','disenador_responsable','expected_revision'].includes(key)))throw invalid();
  if(![body.cuota_reels,body.cuota_carruseles].every(value=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647
    ||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&value.trim()===value&&Number(value)<=2147483647))throw invalid();
  strictAgreementPeriod(body.vigente_desde);strictAgreementMoney(body.abono_mensual,{numeric:true});
  for(const key of ['dias_historias','dias_reels','dias_carruseles']) {
    const value=body[key];if(value===undefined&&key!=='dias_historias')continue;
    if(!Array.isArray(value)||value.length>7||(key==='dias_historias'&&!value.length)||value.some(day=>!(typeof day==='number'&&Number.isInteger(day)&&day>=0&&day<=6||typeof day==='string'&&day.length===1&&/^[0-6]$/.test(day))))throw invalid();
  }
  if(typeof body.disenador_responsable!=='string'||!CLIENT_DESIGNERS.includes(body.disenador_responsable.trim()))throw invalid();
  if(['nombre','rubro'].some(key=>body[key]!==undefined&&(typeof body[key]!=='string'||/[\u0000-\u001f\u007f]/.test(body[key]))))throw invalid();
}
export function parseFirstAgreement(body) {
  const keys=['vigente_desde','cuota_reels','cuota_carruseles','abono_mensual','dias_historias','dias_reels','dias_carruseles','disenador_responsable','rubro','expected_revision'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))throw invalid();
  assertAgreementRevision(body.expected_revision);
  if(![body.cuota_reels,body.cuota_carruseles].every(n=>Number.isInteger(n)&&n>=0&&n<=100)
    ||typeof body.rubro!=='string'||!body.rubro.trim()||body.rubro.trim().length>200||/[\u0000-\u001f\u007f]/.test(body.rubro)
    ||!CLIENT_DESIGNERS.includes(body.disenador_responsable))throw invalid();
  return {vigente_desde:strictAgreementPeriod(body.vigente_desde),cuota_reels:body.cuota_reels,cuota_carruseles:body.cuota_carruseles,
    abono_mensual:strictAgreementMoney(body.abono_mensual),dias_historias:days(body.dias_historias,true),dias_reels:days(body.dias_reels,false),
    dias_carruseles:days(body.dias_carruseles,false),disenador_responsable:body.disenador_responsable,rubro:body.rubro.trim(),expected_revision:body.expected_revision};
}
export const strictAgreementClientId=value=>{
  if(typeof value!=='string'||value.trim()!==value||!/^[1-9]\d*$/.test(value)||Number(value)>2147483647)throw fail(400,'Cliente inválido.','CLIENT_ID_INVALID');
  return Number(value);
};
async function basicClient(db,id) {
  const row=(await db.query(`SELECT c.id,c.nombre,c.activo,c.rubro,c.fecha_inicio,c.fecha_fin,c.grupo_feed_id,c.cuota_reels,c.cuota_carruseles,
    EXISTS(SELECT 1 FROM cliente_configuraciones cfg WHERE cfg.cliente_id=c.id) AS has_configuration,
    EXISTS(SELECT 1 FROM cliente_abonos fee WHERE fee.cliente_id=c.id) AS has_fee FROM clientes c WHERE c.id=$1`,[id])).rows[0];
  if(!row)throw fail(404,'Cliente no encontrado.','CLIENT_NOT_FOUND');
  if(row.activo!==true||row.fecha_inicio!==null||row.fecha_fin!==null||row.grupo_feed_id!==null||row.cuota_reels!==0||row.cuota_carruseles!==0||row.has_configuration||row.has_fee) {
    throw fail(409,'Este cliente ya no está disponible para iniciar su primer acuerdo mensual. Revisá la versión guardada.','CLIENT_FIRST_AGREEMENT_INELIGIBLE');
  }
  return row;
}
export async function readFirstAgreement(pool,auth,rawId) {
  const id=strictAgreementClientId(rawId),observed=captureClientCreator(auth),db=await pool.connect();let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[observed.id])).rows[0];
    if(!user||user.id!==observed.id||user.activo!==true||user.session_version!==observed.session_version)throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
    if(user.rol!=='admin')throw fail(403,'Solo administración puede configurar acuerdos mensuales.');
    const row=await basicClient(db,id),agreement_revision=await readClientAgreementRevision(db,id);
    await db.query('COMMIT');return {version:1,eligible:true,agreement_revision,cliente:{id:row.id,nombre:row.nombre,activo:true,rubro:row.rubro,fecha_inicio:null}};
  } catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}
  finally{db.release(discard);}
}
export async function startFirstAgreement(pool,auth,rawId,body) {
  const id=strictAgreementClientId(rawId),input=parseFirstAgreement(body),observed=captureClientCreator(auth),db=await pool.connect();let discard;
  try {
    await db.query('BEGIN');await lockClientAdministration(db);
    const actor=await lockCurrentClientCreator(db,observed);
    await lockClientAgreement(db,id,input.expected_revision);
    const row=await basicClient(db,id);
    await db.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,dias_reels,dias_carruseles,disenador_responsable,abono_mensual)
      VALUES($1,$2,$3,$4,$5::smallint[],$6::smallint[],$7::smallint[],$8,$9)`,[id,input.vigente_desde,input.cuota_reels,input.cuota_carruseles,input.dias_historias,input.dias_reels,input.dias_carruseles,input.disenador_responsable,input.abono_mensual]);
    await db.query('INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES($1,$2,$3,$4)',[id,input.vigente_desde,input.abono_mensual,actor.nombre||actor.usuario]);
    await db.query('UPDATE clientes SET cuota_reels=$2,cuota_carruseles=$3,rubro=$4,fecha_inicio=$5 WHERE id=$1',[id,input.cuota_reels,input.cuota_carruseles,input.rubro,input.vigente_desde]);
    const agreement_revision=await readClientAgreementRevision(db,id);
    const {expected_revision,vigente_desde,...configuration}=input;
    const saved=(await db.query(`SELECT c.nombre,c.activo,c.rubro,to_char(c.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,c.grupo_feed_id,
      c.cuota_reels,c.cuota_carruseles,cfg.cuota_reels AS configuration_reels,cfg.cuota_carruseles AS configuration_carousels,cfg.dias_historias,cfg.dias_reels,cfg.dias_carruseles,cfg.disenador_responsable,
      cfg.abono_mensual::text AS abono_mensual,fee.importe::text AS fee_amount
      FROM clientes c JOIN cliente_configuraciones cfg ON cfg.cliente_id=c.id AND cfg.vigente_desde=$2::date
      JOIN cliente_abonos fee ON fee.cliente_id=c.id AND fee.vigente_desde=cfg.vigente_desde WHERE c.id=$1`,[id,vigente_desde])).rows[0];
    if(!saved||saved.nombre!==row.nombre||saved.activo!==true||saved.grupo_feed_id!==null||saved.fecha_inicio!==vigente_desde||saved.fee_amount!==input.abono_mensual
      ||saved.configuration_reels!==input.cuota_reels||saved.configuration_carousels!==input.cuota_carruseles
      ||Object.entries(configuration).some(([key,value])=>JSON.stringify(saved[key])!==JSON.stringify(value))||agreement_revision===expected_revision) {
      throw new Error('No se pudo verificar el acuerdo mensual guardado.');
    }
    const result={version:1,cliente:{id:row.id,nombre:row.nombre,activo:true,...configuration,fecha_inicio:vigente_desde,grupo_feed_id:null,
      configuracion_completa:true,configuracion_vigente_desde:vigente_desde,abono_vigente_desde:vigente_desde,agreement_revision}};
    await db.query('COMMIT');return result;
  } catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}
  finally{db.release(discard);}
}
export function createMonthlyAgreementRouter({express,pool}) {
  const router=express.Router();
  const route=write=>async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{
      if(Object.keys(req.query||{}).length)throw invalid();
      const result=write?await startFirstAgreement(pool,req.auth,req.params.id,req.body):await readFirstAgreement(pool,req.auth,req.params.id);
      res.json(result);
    }catch(error){if([400,401,403,404,409,428].includes(error.status))return res.status(error.status).json({error:error.message,...(error.code?{code:error.code}:{})});next(error);}
  };
  router.get('/:id/acuerdo-mensual/iniciar',route(false));router.post('/:id/acuerdo-mensual/iniciar',route(true));return router;
}
