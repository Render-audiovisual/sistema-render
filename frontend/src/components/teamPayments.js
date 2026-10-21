const fail=()=>new Error('No se pudo verificar el registro de pago. No repitas el envío con otra clave.');
const positive=value=>Number.isInteger(value)&&value>0&&value<=2147483647;
const text=(value,min,max)=>typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const label=value=>typeof value==='string'&&value.trim().length>0;
export const validPaymentPeriod=value=>typeof value==='string'&&value.length===7&&/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function teamPaymentToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Cordoba',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const read=key=>parts.find(part=>part.type===key).value;return `${read('year')}-${read('month')}-${read('day')}`;}
function date(value){if(typeof value!=='string'||value.length!==10||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw fail();return value;}
function instant(value){if(typeof value!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)||value.trim()!==value||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw fail();return value;}
function revision(value,id){const match=typeof value==='string'&&/^pay1:([1-9]\d*):([1-9]\d*)$/.exec(value);if(!match||match[0]!==value||Number(match[1])!==id||!positive(Number(match[2])))throw fail();return Number(match[2]);}
const validKey=value=>typeof value==='string'&&value.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function amount(value,{total=false}={}){if(typeof value!=='string'||!(total?/^(0|[1-9]\d*)\.\d{2}$/:/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).test(value)||value.trim()!==value)throw fail();const [whole,fraction='']=value.split('.'),normalized=`${whole}.${fraction.padEnd(2,'0')}`,cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(!total&&cents<=0n)throw fail();return{normalized,cents};}
export function safePaymentDriveUrl(value){if(typeof value!=='string'||!value.length||value.length>2000||/[\s\u0000-\u001f\u007f\\]/.test(value)||!/^https:\/\/drive\.google\.com(?:[/?#]|$)/.test(value))return null;try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='drive.google.com'&&!url.username&&!url.password&&!url.port?value:null;}catch{return null;}}
export function formatTeamPaymentARS(value){const normalized=amount(value,{total:true}).normalized,[whole,fraction]=normalized.split('.');return `ARS ${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')},${fraction}`;}
export function blankTeamPaymentDraft(){return{recipient_id:'',fecha_pago:'',periodo_trabajo:'',importe:'',referencia:'',drive_url:''};}
export function parseTeamPaymentContext(value){if(value?.version!==1||!Array.isArray(value.recipients))throw fail();const seen=new Set();return value.recipients.map(row=>{if(!positive(row?.id)||seen.has(row.id)||!label(row.nombre)||typeof row.usuario!=='string'||!text(row.rol,1,80))throw fail();seen.add(row.id);return Object.freeze({id:row.id,nombre:row.nombre,usuario:row.usuario,rol:row.rol});});}
export function parseTeamPayment(row){
 if(!positive(row?.id)||!positive(row.recipient_id)||!positive(row.recorded_by_id)||!label(row.recipient_name)||!label(row.recorded_by_name)||!validPaymentPeriod(row.periodo_trabajo)||row.moneda!=='ARS'||row.provenance!=='manual'||!['recorded','voided'].includes(row.status)||!text(row.referencia,3,500)||row.referencia.trim()!==row.referencia)throw fail();
 const importe=amount(row.importe).normalized;if(importe!==row.importe||!(row.drive_url===null||safePaymentDriveUrl(row.drive_url)))throw fail();revision(row.revision,row.id);
 if(row.status==='recorded'&&(row.voided_at!==null||row.voided_by_id!==null||row.void_reason!==null))throw fail();
 if(row.status==='voided'&&(!positive(row.voided_by_id)||!text(row.void_reason,3,500)||row.void_reason.trim()!==row.void_reason||revision(row.revision,row.id)<2))throw fail();
 return{id:row.id,recipient_id:row.recipient_id,recipient_name:row.recipient_name,recorded_by_id:row.recorded_by_id,recorded_by_name:row.recorded_by_name,fecha_pago:date(row.fecha_pago),periodo_trabajo:row.periodo_trabajo,moneda:'ARS',importe,referencia:row.referencia,drive_url:row.drive_url,provenance:'manual',status:row.status,revision:row.revision,created_at:instant(row.created_at),voided_at:row.status==='voided'?instant(row.voided_at):null,voided_by_id:row.voided_by_id,void_reason:row.void_reason};
}
export function parseTeamPayments(value,period){
 if(!validPaymentPeriod(period)||value?.version!==1||value.periodo!==period||!Array.isArray(value.items))throw fail();
 const items=value.items.map(parseTeamPayment),seen=new Set();let sum=0n;
 items.forEach((row,index)=>{if(seen.has(row.id)||row.fecha_pago.slice(0,7)!==period)throw fail();seen.add(row.id);if(index&&(items[index-1].fecha_pago<row.fecha_pago||items[index-1].fecha_pago===row.fecha_pago&&items[index-1].id<=row.id))throw fail();if(row.status==='recorded')sum+=amount(row.importe).cents;});
 if(amount(value.total_recorded_ars,{total:true}).cents!==sum)throw fail();return{version:1,periodo:period,items,total_recorded_ars:value.total_recorded_ars};
}
function trimmed(value){if(typeof value!=='string'||!text(value.trim(),3,500)||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Ingresá una referencia o motivo de 3 a 500 caracteres.');return value.trim();}
export function buildTeamPaymentBody(draft,recipients,today,operationKey){
 if(!validKey(operationKey))throw new Error('No se pudo crear una clave segura para el envío.');
 const recipient=typeof draft?.recipient_id==='string'&&/^[1-9]\d*$/.test(draft.recipient_id)&&draft.recipient_id.trim()===draft.recipient_id?Number(draft.recipient_id):null;
 if(!positive(recipient)||!recipients.some(person=>person.id===recipient))throw new Error('Elegí una persona del catálogo vigente.');
 const fecha_pago=date(draft.fecha_pago);if(fecha_pago>date(today)||!validPaymentPeriod(draft.periodo_trabajo))throw new Error('Revisá la fecha real del pago y el mes de trabajo.');
 const drive_url=draft.drive_url===''?null:safePaymentDriveUrl(draft.drive_url);if(draft.drive_url!==''&&!drive_url)throw new Error('Usá un enlace HTTPS de drive.google.com sin credenciales ni puerto.');
 return{operation_key:operationKey,recipient_id:recipient,fecha_pago,periodo_trabajo:draft.periodo_trabajo,moneda:'ARS',importe:amount(draft.importe).normalized,referencia:trimmed(draft.referencia),drive_url,attestation:true};
}
export function verifyTeamPaymentAck(value,intent){
 if(value?.version!==1||typeof value.replayed!=='boolean')throw fail();const payment=parseTeamPayment(value.payment),body=JSON.parse(intent.body);
 if(intent.kind==='create'){
  for(const field of ['recipient_id','fecha_pago','periodo_trabajo','moneda','importe','referencia','drive_url'])if(payment[field]!==body[field])throw fail();
  if(payment.recorded_by_id!==intent.actorId)throw fail();
 }else{
  const before=intent.payment;if(payment.id!==before.id||payment.status!=='voided'||payment.revision!==`pay1:${before.id}:${revision(before.revision,before.id)+1}`||payment.voided_by_id!==intent.actorId||payment.void_reason!==body.reason)throw fail();
  for(const field of ['recipient_id','recipient_name','recorded_by_id','recorded_by_name','fecha_pago','periodo_trabajo','moneda','importe','referencia','drive_url','provenance','created_at'])if(payment[field]!==before[field])throw fail();
 }
 return{version:1,payment,replayed:value.replayed};
}

export function createTeamPaymentsController({capture,actorId,onChange=()=>{},randomUUID=()=>globalThis.crypto.randomUUID(),today=teamPaymentToday}){
 let state={status:'idle',recipients:[],list:null,result:null,error:'',busy:false,uncertain:false,locked:false},disposed=false,readGeneration=0,abort,intent=null;
 const emit=(patch,guard)=>{if(disposed||!guard.current())return;state={...state,...patch};onChange(Object.freeze({...state,hasIntent:Boolean(intent)}));};
 const deny=guard=>{intent=null;emit({status:'denied',recipients:[],list:null,result:null,error:'Ya no tenés acceso a los registros de pagos.',busy:false,uncertain:false,locked:true},guard);};
 async function send(){
  if(disposed||state.busy||!intent||!intent.guard.current()||state.locked&&!state.uncertain)return null;
  const held=intent,{guard}=held;emit({status:'writing',busy:true,uncertain:false,error:''},guard);
  try{const raw=await guard.request(held.url,{method:'POST',headers:{'Content-Type':'application/json'},body:held.body});if(disposed||!guard.current())return null;const result=verifyTeamPaymentAck(raw,held);emit({status:'confirmed',result,busy:false,locked:true,uncertain:false,error:''},guard);return{...result,guard};}
  catch(error){if(disposed||!guard.current())return null;if([401,403].includes(error?.status))deny(guard);else{const uncertain=!Number.isInteger(error?.status)||error.status>=500;emit({status:uncertain?'uncertain':'conflict',busy:false,locked:true,uncertain,error:uncertain?'No pudimos confirmar el envío. Verificá únicamente con la misma clave y los mismos datos; no se hará un segundo pago automático.':'No se confirmó la operación. Conservamos el borrador; cerrá y recargá antes de iniciar otra acción.'},guard);}return null;}
 }
 return Object.freeze({get snapshot(){return Object.freeze({...state,hasIntent:Boolean(intent)});},
  async load(period){
   if(disposed||state.busy||intent||state.status==='denied')return null;const guard=capture();if(!guard.current())return null;const generation=++readGeneration;abort?.abort();abort=new AbortController();const signal=abort.signal;
   emit({status:'loading',busy:true,list:null,error:''},guard);
   try{if(!validPaymentPeriod(period))throw fail();const [context,list]=await Promise.all([guard.request('/api/finanzas/pagos/contexto',{method:'GET',signal}),guard.request(`/api/finanzas/pagos?periodo=${period}`,{method:'GET',signal})]);if(disposed||generation!==readGeneration||signal.aborted||!guard.current())return null;const recipients=parseTeamPaymentContext(context),data=parseTeamPayments(list,period);emit({status:'ready',busy:false,recipients,list:data,result:null,locked:false,uncertain:false},guard);return data;}
   catch(error){if(disposed||generation!==readGeneration||signal.aborted||!guard.current())return null;if([401,403].includes(error?.status))deny(guard);else emit({status:'error',busy:false,list:null,error:'No se pudieron verificar los registros del mes. No mostramos totales estimados como pagos.'},guard);return null;}
  },
  async create(draft,attestation){
   if(disposed||state.busy||intent||state.status!=='ready')return null;const guard=capture();if(!guard.current())return null;
   try{if(!positive(actorId)||attestation!==true)throw new Error('Confirmá que estás registrando manualmente un pago ya realizado.');const body=buildTeamPaymentBody(draft,state.recipients,today(),randomUUID());intent=Object.freeze({kind:'create',actorId,guard,url:'/api/finanzas/pagos',body:JSON.stringify(body)});}catch(error){emit({error:error.message},guard);return null;}return send();
  },
  async voidPayment(row,reason,attestation){
   if(disposed||state.busy||intent||state.status!=='ready')return null;const guard=capture();if(!guard.current())return null;
   try{const payment=parseTeamPayment(row),operation_key=randomUUID();if(!positive(actorId)||!validKey(operation_key)||payment.status!=='recorded'||attestation!==true)throw new Error('Revisá el registro observado y confirmá la anulación.');const body={operation_key,expected_revision:payment.revision,reason:trimmed(reason),attestation:true};intent=Object.freeze({kind:'void',actorId,guard,payment:Object.freeze({...payment}),url:`/api/finanzas/pagos/${payment.id}/anular`,body:JSON.stringify(body)});}catch(error){emit({error:error.message},guard);return null;}return send();
  },
  verify(){if(!state.uncertain)return Promise.resolve(null);return send();},
  reset(){if(disposed||state.busy||state.uncertain||state.status==='denied')return false;intent=null;state={...state,status:'idle',result:null,locked:false,error:''};return true;},
  dispose(){disposed=true;++readGeneration;abort?.abort();intent=null;state={status:'disposed',recipients:[],list:null,result:null,error:'',busy:false,uncertain:false,locked:true};},
 });
}
