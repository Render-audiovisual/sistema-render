import { captureSessionBinding } from '../shared/session/session-binding.js';

const positive=value=>Number.isInteger(value)&&value>0&&value<=2147483647;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>new Error('No se pudo verificar el acuerdo mensual. Cerrá y revisá la versión guardada antes de volver a enviarlo.');
const period=value=>typeof value==='string'&&value.length===7&&/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export const MONTHLY_AGREEMENT_DESIGNERS=Object.freeze(['Augusto','Mariano Meza']);
export function canStartMonthlyAgreement(sesion){const binding=captureSessionBinding(sesion);return Boolean(binding&&positive(binding.id)&&binding.role==='admin');}
function revision(value,id){
 const match=typeof value==='string'&&/^a1:([1-9]\d*):([1-9]\d*):0:0$/.exec(value);
 if(!match||match[0]!==value||!positive(Number(match[1]))||!positive(Number(match[2]))||Number(match[1])!==id)throw fail();
 return Number(match[2]);
}
function money(value){
 if(typeof value!=='string'||value.length>15||!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)||value.trim()!==value)throw new Error('Ingresá un abono explícito, incluso si es 0, con hasta dos decimales.');
 const [whole,fraction='']=value.split('.');return `${whole}.${fraction.padEnd(2,'0')}`;
}
function days(value,required=false){
 if(!Array.isArray(value)||(required&&!value.length)||value.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(value).size!==value.length)throw new Error('Revisá los días elegidos para cada formato.');
 return [...value].sort((a,b)=>a-b);
}
export function blankMonthlyAgreementDraft(){return {vigente_desde:'',cuota_reels:'',cuota_carruseles:'',abono_mensual:'',dias_historias:[],dias_reels:[],dias_carruseles:[],disenador_responsable:'',rubro:''};}
export function parseMonthlyAgreementContext(value,clientId){
 const client=value?.cliente;
 if(!positive(clientId)||value?.version!==1||value.eligible!==true||!record(client)||client.id!==clientId||!text(client.nombre,250)||!client.nombre.trim()||client.activo!==true||client.fecha_inicio!==null||!(client.rubro===null||text(client.rubro,200)))throw fail();
 revision(value.agreement_revision,clientId);
 return Object.freeze({version:1,eligible:true,agreement_revision:value.agreement_revision,cliente:Object.freeze({id:client.id,nombre:client.nombre,activo:true,rubro:client.rubro,fecha_inicio:null})});
}
export function buildMonthlyAgreementPayload(draft,context){
 const held=parseMonthlyAgreementContext(context,context?.cliente?.id);
 if(!period(draft?.vigente_desde))throw new Error('Elegí explícitamente el mes de inicio.');
 const quota=value=>{
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,2})$/.test(value)||value.trim()!==value||Number(value)>100)throw new Error('Ingresá cuotas enteras de 0 a 100, incluso cuando sean 0.');
  return Number(value);
 };
 if(!text(draft.rubro,200)||!draft.rubro.trim())throw new Error('Ingresá el rubro del cliente.');
 if(!MONTHLY_AGREEMENT_DESIGNERS.includes(draft.disenador_responsable))throw new Error('Elegí una referencia de diseño del catálogo.');
 return {vigente_desde:draft.vigente_desde,cuota_reels:quota(draft.cuota_reels),cuota_carruseles:quota(draft.cuota_carruseles),abono_mensual:money(draft.abono_mensual),dias_historias:days(draft.dias_historias,true),dias_reels:days(draft.dias_reels),dias_carruseles:days(draft.dias_carruseles),disenador_responsable:draft.disenador_responsable,rubro:draft.rubro.trim(),expected_revision:held.agreement_revision};
}
export function parseStartedMonthlyAgreement(value,context,payload){
 const held=parseMonthlyAgreementContext(context,context?.cliente?.id),row=value?.cliente,start=`${payload.vigente_desde}-01`;
 if(value?.version!==1||!record(row)||row.id!==held.cliente.id||row.nombre!==held.cliente.nombre||row.activo!==true||row.grupo_feed_id!==null||row.configuracion_completa!==true||row.fecha_inicio!==start||row.configuracion_vigente_desde!==start||row.abono_vigente_desde!==start)throw fail();
 const before=revision(held.agreement_revision,row.id),after=revision(row.agreement_revision,row.id);if(after<=before)throw fail();
 for(const field of ['rubro','cuota_reels','cuota_carruseles','disenador_responsable','abono_mensual'])if(row[field]!==payload[field])throw fail();
 // The server returns canonical fixed-two money and sorted day arrays.
 if(money(row.abono_mensual)!==row.abono_mensual)throw fail();
 for(const field of ['dias_historias','dias_reels','dias_carruseles'])if(JSON.stringify(days(row[field],field==='dias_historias'))!==JSON.stringify(row[field])||JSON.stringify(row[field])!==JSON.stringify(payload[field]))throw fail();
 return {id:row.id,nombre:row.nombre,activo:true,rubro:row.rubro,fecha_inicio:start,cuota_reels:row.cuota_reels,cuota_carruseles:row.cuota_carruseles,grupo_feed_id:null,configuracion_completa:true,configuracion_vigente_desde:start,abono_vigente_desde:start,abono_mensual:row.abono_mensual,dias_historias:[...row.dias_historias],dias_reels:[...row.dias_reels],dias_carruseles:[...row.dias_carruseles],disenador_responsable:row.disenador_responsable,agreement_revision:row.agreement_revision};
}

export function createMonthlyAgreementOperation({clientId,capture,onChange=()=>{}}){
 if(!positive(clientId))throw fail();
 let state={status:'idle',context:null,result:null,error:'',busy:false,attempted:false},disposed=false,generation=0,controller;
 const emit=(patch,guard)=>{if(disposed||!guard.current())return false;state={...state,...patch};onChange(Object.freeze({...state}));return true;};
 const deny=guard=>emit({status:'denied',context:null,result:null,error:'Ya no tenés acceso a esta configuración.',busy:false,attempted:false},guard);
 return Object.freeze({
  get snapshot(){return Object.freeze({...state});},
  async load(){
   if(disposed||state.busy||state.attempted||state.status==='denied')return null;
   const guard=capture();if(!guard.current())return null;const current=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
   emit({status:'loading',context:null,result:null,error:'',busy:true},guard);
   try{
    const raw=await guard.request(`/api/clientes/${clientId}/acuerdo-mensual/iniciar`,{method:'GET',signal});
    if(disposed||current!==generation||signal.aborted||!guard.current())return null;
    const context=parseMonthlyAgreementContext(raw,clientId);emit({status:'ready',context,busy:false},guard);return context;
   }catch(error){
    if(disposed||current!==generation||signal.aborted||!guard.current())return null;
    if([401,403].includes(error?.status))deny(guard);
    else emit({status:error?.status===409?'ineligible':'error',context:null,result:null,busy:false,error:error?.status===409?'Este cliente ya no admite iniciar un primer acuerdo mensual. Cerrá y revisá su versión guardada.':'No se pudo verificar la elegibilidad. Reintentá la consulta.'},guard);
    return null;
   }
  },
  async submit(draft,acknowledged){
   if(disposed||state.busy||state.attempted||state.status!=='ready')return null;
   const guard=capture();if(!guard.current())return null;
   let payload;try{if(acknowledged!==true)throw new Error('Revisá el mes, las cuotas y el abono y confirmá el inicio del acuerdo.');payload=buildMonthlyAgreementPayload(draft,state.context);}catch(error){emit({error:error.message},guard);return null;}
   const held=state.context,body=JSON.stringify(payload);emit({status:'submitting',busy:true,attempted:true,error:''},guard);
   try{
    const raw=await guard.request(`/api/clientes/${clientId}/acuerdo-mensual/iniciar`,{method:'POST',headers:{'Content-Type':'application/json'},body});
    if(disposed||!guard.current())return null;
    const result=parseStartedMonthlyAgreement(raw,held,payload);emit({status:'saved',context:null,result,busy:false},guard);return {cliente:result,guard};
   }catch(error){
    if(disposed||!guard.current())return null;
    if([401,403].includes(error?.status))deny(guard);
    else emit({status:'blocked',result:null,busy:false,error:error?.status===409?'El cliente o su acuerdo cambió. Conservamos el borrador; cerrá y revisá la cartera antes de volver a configurar.':'No pudimos confirmar el inicio del acuerdo. Puede haberse guardado. Conservamos el borrador; no repetiremos el envío. Cerrá y revisá la cartera.'},guard);
    return null;
   }
  },
  dispose(){disposed=true;++generation;controller?.abort();state={status:'disposed',context:null,result:null,error:'',busy:false,attempted:false};},
 });
}
