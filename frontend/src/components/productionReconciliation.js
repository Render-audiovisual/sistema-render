import { createCapturedRequest } from '../shared/session/captured-request.js';

const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const invalid=()=>{throw new Error('La respuesta de revisión no es válida.');};
const states=['planificado','grabado','pendiente','repetir'];
function date(value) {const d=new Date(`${value}T12:00:00Z`);return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function parseReconciliationContext(value,taskId) {
  const source=value?.source,h=value?.history,e=value?.eligibility;
  if(value?.version!==1||source?.id!==taskId||!positive(source.revision)||typeof source.titulo!=='string'
    ||!(source.fecha===null||date(source.fecha))||!(source.cliente===null||(positive(source.cliente?.id)&&typeof source.cliente.nombre==='string'))
    ||!h||![h.records_count,h.recorded_count].every(n=>n===null||count(n))||!(h.declared_count===null||(count(h.declared_count)&&h.declared_count>0))||typeof h.confirmed!=='boolean'
    ||!e||!['ready','not_historical','legacy_editing','already_linked','unavailable'].includes(e.status)
    ||!(e.visita_id===null||uuid(e.visita_id))||(e.status==='already_linked'&&!uuid(e.visita_id))
    ||(e.status==='ready'&&(!source.cliente||!source.fecha||e.visita_id!==null)))invalid();
  const content={};
  for(const key of ['instructions','script','material','recorded_material','feedback','schedule']) {
    const text=source.content?.[key];if(typeof text!=='string'||text.length>(key==='material'?4000:20000))invalid();content[key]=text;
  }
  const hasLegacyTasks=Object.hasOwn(value,'legacy_editing_tasks');
  const legacy=hasLegacyTasks?value.legacy_editing_tasks:[];
  if(!Array.isArray(legacy)||legacy.length>50)invalid();
  const ids=new Set();
  const legacy_editing_tasks=legacy.map(task=>{
    if(!task||!positive(task.id)||!positive(task.revision)||ids.has(task.id)
      ||typeof task.titulo!=='string'||task.titulo.length>20000||typeof task.estado!=='string'||task.estado.length>100
      ||(Object.hasOwn(task,'en_workspace')&&typeof task.en_workspace!=='boolean'))invalid();
    ids.add(task.id);
    return {id:task.id,revision:task.revision,titulo:task.titulo,estado:task.estado,en_workspace:task.en_workspace===true};
  });
  if((e.status==='ready'&&legacy_editing_tasks.length>0)
    ||(e.status==='legacy_editing'&&hasLegacyTasks&&legacy_editing_tasks.length===0))invalid();
  return {version:1,source:{id:taskId,revision:source.revision,titulo:source.titulo,
    cliente:source.cliente===null?null:{id:source.cliente.id,nombre:source.cliente.nombre},fecha:source.fecha,content},
    history:{records_count:h.records_count,recorded_count:h.recorded_count,declared_count:h.declared_count,confirmed:h.confirmed},
    eligibility:{status:e.status,visita_id:e.visita_id},legacy_editing_tasks};
}
function inputText(value,max,required=false) {if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('Revisá los textos y títulos de cada video.');return value;}
function material(value) {inputText(value,4000);if(!value.trim())return '';try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();}catch{throw new Error('Usá enlaces HTTP(S) válidos, sin contraseñas.');}return value.trim();}
export function reconciliationAdoptionTask(context) {
  const tasks=context?.legacy_editing_tasks;
  return context?.eligibility?.status==='legacy_editing'&&context.eligibility.visita_id===null
    &&context.source?.cliente&&context.source?.fecha&&Array.isArray(tasks)&&tasks.length===1
    &&tasks[0].en_workspace===true&&positive(tasks[0].id)&&positive(tasks[0].revision)?tasks[0]:null;
}
export function reconciliationInput(context,draft,requestId) {
  const adoption=reconciliationAdoptionTask(context);
  if((context?.eligibility?.status!=='ready'&&!adoption)||!uuid(requestId)||draft?.acknowledged!==true)throw new Error('Confirmá que identificaste manualmente cada video.');
  if(draft.adoption_enabled===true&&!adoption)throw new Error('Esta tarea no permite vincular edición existente.');
  if(!Array.isArray(draft.participante_ids)||new Set(draft.participante_ids).size!==draft.participante_ids.length||draft.participante_ids.some(id=>!positive(id)))throw new Error('Revisá los participantes.');
  if(!Array.isArray(draft.videos)||draft.videos.length<1||draft.videos.length>50)throw new Error('Identificá entre uno y cincuenta videos.');
  const videos=draft.videos.map(v=>{if(!states.includes(v.estado))throw new Error('Elegí el estado de cada video.');return{titulo:inputText(v.titulo,250,true),guion:inputText(v.guion,20000),estado:v.estado,material_url:material(v.material_url),observaciones:inputText(v.observaciones,20000)};});
  let existing_editing;
  if(adoption){
    const matches=draft.videos.map((v,index)=>({v,index})).filter(({v})=>typeof v.local_id==='string'&&v.local_id!==''&&v.local_id===draft.adoption_video_id);
    if(draft.adoption_enabled!==true||draft.adoption_acknowledged!==true||matches.length!==1||matches[0].v.estado!=='grabado')throw new Error('Elegí un video grabado y confirmá que la tarea edita únicamente ese video.');
    existing_editing={task_id:adoption.id,expected_revision:adoption.revision,video_ordinal:matches[0].index+1,acknowledgement:'esta_tarea_edita_un_solo_video'};
  }
  return {request_id:requestId,source_task_id:context.source.id,expected_source_revision:context.source.revision,acknowledgement:'videos_identificados_manualmente',
    titulo:inputText(draft.titulo,250,true),participante_ids:[...draft.participante_ids],drive_url:material(draft.drive_url),observaciones:inputText(draft.observaciones,20000),videos,...(existing_editing?{existing_editing}:{})};
}
export function parseReconciliationResult(value,length) {
  if(!uuid(value?.reconciliation_id)||!uuid(value?.visita_id)||typeof value.created!=='boolean'||!Array.isArray(value.video_ids)
    ||value.video_ids.length!==length||new Set(value.video_ids).size!==length||value.video_ids.some(id=>!uuid(id)))invalid();
  return {reconciliation_id:value.reconciliation_id,visita_id:value.visita_id,video_ids:[...value.video_ids],created:value.created};
}
export const emptyReconciliationVideo=()=>({local_id:crypto.randomUUID(),titulo:'',guion:'',estado:'planificado',material_url:'',observaciones:''});
export function createProductionReconciliationModel({taskId,sesion,readSession,request,onChange,createId=()=>crypto.randomUUID(),canAct=()=>true}) {
  const captured={id:sesion?.usuario?.id,role:sesion?.usuario?.rol,active:sesion?.usuario?.activo};
  let disposed=false,version=0,controller,body=null,baseline='';
  const actor=createCapturedRequest({session:sesion,readSession,request,isActive:()=>!disposed});
  let state={phase:'closed',context:null,draft:null,busy:false,frozen:false,dirty:false,error:'',canReviewAgain:false,result:null};
  const emit=patch=>{state={...state,...patch};if(!disposed)onChange(state);};
  const current=()=>positive(captured.id)&&captured.role==='admin'&&captured.active!==false&&actor.current();
  const deny=()=>{body=null;emit({phase:'denied',context:null,draft:null,busy:false,frozen:false,dirty:false,error:'La sesión cambió. Volvé a iniciar sesión.',result:null,canReviewAgain:false});};
  async function open({preserveDraft=false}={}) {
    if(disposed||state.busy||!canAct()||(state.frozen&&!state.canReviewAgain))return false;
    if(!current()){deny();return false;}
    const previous=preserveDraft?state.draft:null;
    const observed=++version;controller?.abort();controller=new AbortController();const signal=controller.signal;
    emit({phase:'loading',busy:true,error:'',context:null,result:null});
    try {
      const value=await actor.request(`/api/producciones/reconciliaciones/origen/${taskId}`,{signal});
      if(disposed||signal.aborted||observed!==version)return false;
      if(!current()){deny();return false;}
      const context=parseReconciliationContext(value,taskId);
      const draft=previous?{...previous,acknowledged:false,adoption_acknowledged:false}:{titulo:context.source.titulo,participante_ids:[],drive_url:'',observaciones:'',videos:[emptyReconciliationVideo()],acknowledged:false,adoption_enabled:false,adoption_video_id:'',adoption_acknowledged:false};
      body=null;if(!previous)baseline=JSON.stringify(draft);
      emit({phase:'ready',context,draft,busy:false,frozen:false,dirty:Boolean(previous),canReviewAgain:false});
    }catch(error){if(disposed||signal.aborted||observed!==version)return false;if(!current()||[401,403].includes(error.status)){deny();return false;}
      emit({phase:'error',busy:false,error:'No pudimos consultar el origen. Reintentá sin perder tu borrador.',canReviewAgain:true});}
    return true;
  }
  function update(changes) {
    if(disposed||state.phase!=='ready'||state.busy||state.frozen||!state.draft||!canAct())return false;
    if(!current()){deny();return false;}
    const draft={...state.draft,...changes};emit({draft,dirty:JSON.stringify(draft)!==baseline,error:''});return true;
  }
  async function submit({retry=false}={}) {
    if(disposed||state.phase!=='ready'||state.busy||!canAct())return false;
    if(!current()){deny();return false;}
    if(state.frozen&&!retry)return false;
    if(!body) {try{body=JSON.stringify(reconciliationInput(state.context,state.draft,createId()));}catch(error){emit({error:error.message});return false;}}
    const observed=++version;emit({busy:true,frozen:true,dirty:true,error:'',canReviewAgain:false});
    try {
      const result=await actor.request('/api/producciones/reconciliaciones',{method:'POST',headers:{'Content-Type':'application/json'},body});
      if(disposed||observed!==version)return false;
      if(!current()){deny();return false;}
      const saved=parseReconciliationResult(result,JSON.parse(body).videos.length);
      emit({phase:'saved',result:saved,busy:false,frozen:false,dirty:false,error:'',canReviewAgain:false});body=null;
    }catch(error){if(disposed||observed!==version)return false;if(!current()||[401,403].includes(error.status)){deny();return false;}
      emit({busy:false,frozen:true,dirty:true,canReviewAgain:[400,404,409,413,422].includes(error.status),
        error:[400,404,409,413,422].includes(error.status)?'No se guardó la conciliación. Volvé a revisar el origen antes de corregir el borrador.':'No pudimos confirmar el resultado. Reintentá la misma solicitud; no se duplicará el registro.'});}
    return true;
  }
  return {open,update,submit,get snapshot(){return state;},cancel(){if(state.busy)return false;controller?.abort();++version;body=null;emit({phase:'closed',context:null,draft:null,result:null,dirty:false,frozen:false,error:'',canReviewAgain:false});return true;},
    dispose(){disposed=true;++version;controller?.abort();body=null;}};
}
