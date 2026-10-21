import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';

const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const uuid=value=>typeof value==='string'&&value.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash=value=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value);
const invalid=()=>{throw new Error('No se pudo verificar el expediente de producción.');};
const text=(value,max=20000)=>{if(typeof value!=='string'||value.length>max)invalid();return value;};
const date=value=>{if(typeof value!=='string'||value.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(`${value}T12:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const nullableId=value=>value===null||positive(value);
const nullableUuid=value=>value===null||uuid(value);
const unique=values=>new Set(values).size===values.length;
const videoStates=['planificado','grabado','pendiente','repetir'];
const link=value=>{text(value,4000);if(!value.trim())return '';if(/[\u0000-\u001f\u007f]/.test(value))invalid();const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)invalid();return value.trim();};
export function parseProductionHistoryBatchContext(value,sourceId){
  const source=value?.source;
  if(value?.version!==2||!positive(sourceId)||source?.id!==sourceId||!positive(source.revision)||!positive(source.cliente?.id)||!date(source.fecha)||!hash(value.context_hash))invalid();
  const content={};for(const key of ['instructions','script','material','recorded_material','feedback','schedule'])content[key]=text(source.content?.[key],['material','recorded_material'].includes(key)?4000:20000);
  const closedSource={id:source.id,revision:source.revision,titulo:text(source.titulo,250),cliente:{id:source.cliente.id,nombre:text(source.cliente.nombre,250)},fecha:source.fecha,content};
  let visit=null;
  if(value.visit!==null){
    const v=value.visit;if(!uuid(v?.id)||!positive(v.revision)||v.tarea_origen_id!==sourceId||v.cliente_id!==source.cliente.id||!date(v.fecha)||!Array.isArray(v.participante_ids)||v.participante_ids.length>100||v.participante_ids.some(id=>!positive(id))||!unique(v.participante_ids)||!Array.isArray(v.videos)||v.videos.length>50)invalid();
    const videos=v.videos.map(video=>{
      if(!uuid(video?.id)||video.visita_id!==v.id||!nullableUuid(video.video_origen_id)||!videoStates.includes(video.estado)||!['tarea_edicion_id','tarea_entrega_id','publicacion_id','cliente_editorial_id','editor_id'].every(key=>nullableId(video[key]))||!(video.fecha_entrega===null||date(video.fecha_entrega)))invalid();
      return{id:video.id.toLowerCase(),visita_id:v.id.toLowerCase(),video_origen_id:video.video_origen_id?.toLowerCase()??null,titulo:text(video.titulo,250),guion:text(video.guion),estado:video.estado,material_url:text(video.material_url,4000),observaciones:text(video.observaciones),tarea_edicion_id:video.tarea_edicion_id,tarea_entrega_id:video.tarea_entrega_id,publicacion_id:video.publicacion_id,cliente_editorial_id:video.cliente_editorial_id,editor_id:video.editor_id,fecha_entrega:video.fecha_entrega};
    });if(!unique(videos.map(video=>video.id)))invalid();
    visit={id:v.id.toLowerCase(),revision:v.revision,tarea_origen_id:sourceId,cliente_id:v.cliente_id,fecha:v.fecha,titulo:text(v.titulo,250),observaciones:text(v.observaciones),drive_url:text(v.drive_url,4000),participante_ids:[...v.participante_ids],videos};
  }
  if(!Array.isArray(value.legacy_tasks)||value.legacy_tasks.length>50)invalid();
  const legacy_tasks=value.legacy_tasks.map(task=>{if(!positive(task?.id)||!positive(task.revision)||!nullableId(task.editor_id)||!(task.fecha_entrega===null||date(task.fecha_entrega))||!['adoptable','preserve_only'].includes(task.eligibility)||!nullableUuid(task.mapped_video_id))invalid();return{id:task.id,revision:task.revision,titulo:text(task.titulo,250),estado:text(task.estado,100),editor_id:task.editor_id,fecha_entrega:task.fecha_entrega,eligibility:task.eligibility,mapped_video_id:task.mapped_video_id?.toLowerCase()??null};});
  if(!unique(legacy_tasks.map(task=>task.id))||!unique(legacy_tasks.filter(task=>task.mapped_video_id).map(task=>task.mapped_video_id))||legacy_tasks.some(task=>task.mapped_video_id&&!visit?.videos.some(video=>video.id===task.mapped_video_id)))invalid();
  return{version:2,source:closedSource,visit,legacy_tasks,context_hash:value.context_hash};
}
export function newProductionHistoryVideo(){return{local_key:crypto.randomUUID(),new_video:{titulo:'',guion:'',estado:'planificado',material_url:'',observaciones:''},disposition:'',task_id:null,acknowledged:false};}
export const historyVideoKey=video=>video.existing_video_id??video.local_key;
export function createProductionHistoryDraft(context,previous){
  const videos=previous?.videos?.map(video=>({...video,new_video:video.new_video?{...video.new_video}:undefined,acknowledged:false}))??[];
  return{visit_fields:previous?.visit_fields?{...previous.visit_fields,participante_ids:[...previous.visit_fields.participante_ids]}:{titulo:context.source.titulo,participante_ids:[],drive_url:'',observaciones:''},videos,
    children:context.legacy_tasks.map(task=>{const old=previous?.children?.find(child=>child.task_id===task.id);return{task_id:task.id,disposition:old?.disposition??'',video_key:old?.video_key??null,reason:old?.reason??''};}),acknowledged:false};
}
export function buildProductionHistoryBatchInput(context,draft,requestId){
  if(!uuid(requestId)||!hash(context?.context_hash)||draft?.acknowledged!==true||!Array.isArray(draft.videos)||draft.videos.length<1||draft.videos.length>50||!unique(draft.videos.map(historyVideoKey)))invalid();
  if((context.visit?.videos.length??0)+draft.videos.filter(video=>!video.existing_video_id).length>50)invalid();
  const videos=draft.videos.map(video=>{
    if(video.acknowledged!==true||!['adopt_original','manual_independent'].includes(video.disposition))invalid();
    let identity,state;
    if(video.existing_video_id){const observed=context.visit?.videos.find(v=>v.id===video.existing_video_id);if(!observed)invalid();identity={existing_video_id:observed.id};state=observed.estado;}
    else{const v=video.new_video;if(!uuid(video.local_key)||!videoStates.includes(v?.estado)||!text(v.titulo,250).trim())invalid();identity={local_key:video.local_key,new_video:{titulo:v.titulo.trim(),guion:text(v.guion),estado:v.estado,material_url:link(v.material_url),observaciones:text(v.observaciones)}};state=v.estado;}
    const task=video.disposition==='adopt_original'?context.legacy_tasks.find(t=>t.id===video.task_id):null;
    if(video.disposition==='adopt_original'&&(!task||task.eligibility!=='adoptable'||state!=='grabado'||task.mapped_video_id&&task.mapped_video_id!==historyVideoKey(video)))invalid();
    if(video.disposition==='manual_independent'&&video.task_id!==null)invalid();
    return{...identity,disposition:video.disposition,task_id:task?.id??null};
  });
  if(!unique(videos.filter(v=>v.task_id!==null).map(v=>v.task_id))||!Array.isArray(draft.children)||draft.children.length!==context.legacy_tasks.length||!unique(draft.children.map(c=>c.task_id)))invalid();
  const child_dispositions=context.legacy_tasks.map(task=>{
    const child=draft.children.find(c=>c.task_id===task.id);if(!child||!['mapped','preserve_unmapped'].includes(child.disposition)||!text(child.reason,1000).trim())invalid();
    if(child.disposition==='mapped'&&(!uuid(child.video_key)||!videos.some(video=>historyVideoKey(video)===child.video_key&&video.task_id===task.id)))invalid();
    if(child.disposition==='preserve_unmapped'&&(child.video_key!==null||videos.some(video=>video.task_id===task.id)))invalid();
    return{task_id:task.id,expected_revision:task.revision,disposition:child.disposition,video_key:child.video_key,reason:child.reason.trim()};
  });
  if(videos.some(video=>video.task_id!==null&&!child_dispositions.some(child=>child.task_id===video.task_id&&child.disposition==='mapped')))invalid();
  let visit_fields;
  if(!context.visit){const f=draft.visit_fields;if(!text(f?.titulo,250).trim()||!Array.isArray(f.participante_ids)||f.participante_ids.length>100||!unique(f.participante_ids)||f.participante_ids.some(id=>!positive(id)))invalid();visit_fields={titulo:f.titulo.trim(),participante_ids:[...f.participante_ids],drive_url:link(f.drive_url),observaciones:text(f.observaciones)};}
  const result={version:2,request_id:requestId,source_task_id:context.source.id,expected_source_revision:context.source.revision,visit_id:context.visit?.id??null,expected_visit_revision:context.visit?.revision??null,expected_context_hash:context.context_hash,...(visit_fields?{visit_fields}:{}),videos,child_dispositions,acknowledgement:'correspondencias_revisadas_manualmente'};
  if(new TextEncoder().encode(JSON.stringify(result)).length>900000)invalid();return result;
}
export function parseProductionHistoryBatchResult(value,input){
  if(!uuid(value?.reconciliation_id)||!uuid(value.visita_id)||typeof value.created!=='boolean'||!Array.isArray(value.video_ids)||value.video_ids.length!==input.videos.length||!unique(value.video_ids)||value.video_ids.some(id=>!uuid(id))||input.visit_id&&value.visita_id!==input.visit_id||input.videos.some((video,index)=>video.existing_video_id&&video.existing_video_id!==value.video_ids[index]))invalid();
  return{reconciliation_id:value.reconciliation_id,visita_id:value.visita_id,created:value.created,video_ids:[...value.video_ids]};
}
export const productionHistoryBatchContract=Object.freeze({parseContext:parseProductionHistoryBatchContext,createDraft:createProductionHistoryDraft,buildInput:buildProductionHistoryBatchInput,parseResult:parseProductionHistoryBatchResult});
// Transport/lifetime only. The version-2 codec is supplied by the exact server
// contract; this layer never infers mappings from titles, counts or positions.
export function createProductionHistoryBatchModel({sourceId,sesion,readSession,request,contract,onChange=()=>{},onDraftStateChange=()=>{},canAct=()=>true,createId=()=>crypto.randomUUID()}){
  let disposed=false,denied=false,generation=0,controller=null,body=null;
  let state={phase:'closed',context:null,draft:null,result:null,busy:false,dirty:false,frozen:false,error:'',canReviewAgain:false};
  const actor=createCapturedRequest({session:sesion,readSession,request,isActive:()=>!disposed});
  const live=()=>positive(sourceId)&&sesion?.usuario?.rol==='admin'&&actor.current();
  const current=()=>!denied&&live();
  const emit=patch=>{state={...state,...patch};if(live()){onDraftStateChange({dirty:state.dirty,busy:state.busy});onChange(state);}};
  const deny=()=>{denied=true;++generation;controller?.abort();body=null;emit({phase:'denied',context:null,draft:null,result:null,busy:false,dirty:false,frozen:false,canReviewAgain:false,error:'No tenés acceso a esta revisión. Se retiró el expediente de esta vista.'});};
  const ready=()=>contract&&['parseContext','createDraft','buildInput','parseResult'].every(key=>typeof contract[key]==='function');
  function update(draft){if(!current()||!canAct()||state.phase!=='ready'||state.frozen||state.busy)return false;emit({draft,dirty:true,error:''});return true;}
  async function open({preserveDraft=false}={}){
    if(!current()||!ready()||!canAct()||state.busy||(state.frozen&&!state.canReviewAgain))return false;
    const previous=preserveDraft?state.draft:null,observed=++generation;
    controller?.abort();controller=new AbortController();emit({phase:'loading',busy:true,error:'',result:null});
    try{
      const value=await actor.request(`/api/producciones/reconciliaciones/lotes/origen/${sourceId}`,{signal:controller.signal});
      if(!current()||observed!==generation)return false;
      const context=contract.parseContext(value,sourceId),draft=contract.createDraft(context,previous);
      body=null;emit({phase:'ready',context,draft,busy:false,dirty:Boolean(previous),frozen:false,canReviewAgain:false});return true;
    }catch(error){if(!current()||observed!==generation)return false;if(error.status===403){deny();return false;}
      emit({phase:'error',busy:false,error:'No pudimos consultar el expediente. Conservamos el borrador.',canReviewAgain:true});return false;}
  }
  async function submit({verify=false}={}){
    if(!current()||!ready()||!canAct()||state.busy||state.phase!=='ready'||(state.frozen&&!verify)||verify&&!body)return false;
    if(!body){try{body=JSON.stringify(contract.buildInput(state.context,state.draft,createId()));}catch{emit({error:'Revisá cada correspondencia y sus confirmaciones antes de guardar.'});return false;}}
    const observed=++generation;emit({busy:true,frozen:true,dirty:true,error:'',canReviewAgain:false});
    try{
      const value=await actor.request('/api/producciones/reconciliaciones',{method:'POST',headers:{'Content-Type':'application/json'},body});
      if(!current()||observed!==generation)return false;
      const result=contract.parseResult(value,JSON.parse(body));
      emit({phase:'saved',result,busy:false,dirty:false,frozen:false,error:''});body=null;return true;
    }catch(error){if(!current()||observed!==generation||isSessionFailure(error))return false;if(error.status===403){deny();return false;}
      const definite=[400,404,409,413,422].includes(error.status);
      emit({busy:false,frozen:true,dirty:true,canReviewAgain:definite,error:definite?'El expediente cambió o no admite esta revisión. Volvé a consultar antes de confirmar.':'No pudimos confirmar el resultado. Verificá explícitamente la misma solicitud; no cambiaremos sus datos.'});return false;}
  }
  return Object.freeze({get snapshot(){return state;},scope:actor,current,open,update,submit,
    close(){if(!current()||state.busy)return false;controller?.abort();++generation;body=null;emit({phase:'closed',context:null,draft:null,result:null,dirty:false,frozen:false,error:'',canReviewAgain:false});return true;},
    dispose(){if(disposed)return;disposed=true;++generation;controller?.abort();body=null;onDraftStateChange({dirty:false,busy:false});},
  });
}
