const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const uuid=value=>typeof value==='string'&&value.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const invalid=()=>new Error('No pudimos confirmar la creación. Conservá este intento y verificá su resultado.');
export function taskCreationBody(draft,requestId){
  if(!uuid(requestId)||!draft||typeof draft.titulo!=='string'||!draft.titulo.trim()||!positive(draft.asignado_a_id))throw invalid();
  const collaborators=draft.colaborador_ids??[];
  if(!Array.isArray(collaborators)||collaborators.some(id=>!positive(id)))throw invalid();
  const nullableId=value=>{if(value===undefined||value===null||value==='')return null;const id=typeof value==='string'?Number(value):value;if(!positive(id))throw invalid();return id;};
  const nullableText=value=>{if(value===undefined||value===null||value==='')return null;if(typeof value!=='string')throw invalid();return value;};
  const tags=typeof draft.etiquetas==='string'?draft.etiquetas.split(','):draft.etiquetas??[];
  if(!Array.isArray(tags)||tags.some(tag=>typeof tag!=='string'))throw invalid();
  const planned=draft.produccion_videos_previstos;
  const body={request_id:requestId.toLowerCase(),workspace:'render_os',titulo:draft.titulo,
    asignado_a_id:draft.asignado_a_id,colaborador_ids:[...new Set(collaborators)].filter(id=>id!==draft.asignado_a_id).sort((a,b)=>a-b),
    cliente_id:nullableId(draft.cliente_id),estado:draft.estado??'pendiente',prioridad:draft.prioridad||'media',
    fecha_vencimiento:nullableText(draft.fecha_vencimiento),tipo_tarea:nullableText(draft.tipo_tarea),subtipo:nullableText(draft.subtipo),
    aclaraciones:nullableText(draft.aclaraciones),material_referencia:nullableText(draft.material_referencia),
    resumen:nullableText(draft.resumen)?.trim()||null,etiquetas:tags.map(tag=>tag.trim()).filter(Boolean),
    tarea_padre_id:nullableId(draft.tarea_padre_id)};
  if(planned!==undefined&&planned!==null&&planned!==''){
    const count=typeof planned==='string'?Number(planned):planned;if(!positive(count))throw invalid();body.produccion_videos_previstos=count;
  }
  if(!['pendiente','en_progreso','en_revision'].includes(body.estado))throw invalid();
  return body;
}
export function parseTaskCreationAck(value,requestId,expectedId=null){
  const op=value?.operation,task=value?.task;
  if(value?.version!==1||!op||Object.keys(op).length!==3||op.request_id!==requestId||!positive(op.task_id)
    ||typeof op.replayed!=='boolean'||!task||task.id!==op.task_id||expectedId!==null&&task.id!==expectedId
    ||!Number.isSafeInteger(task.revision)||task.revision<1||typeof task.titulo!=='string'
    ||task.propiedades_extra?.workspace!=='render_os'||!(task.asignado_a_id===null||positive(task.asignado_a_id))
    ||!Array.isArray(task.colaborador_ids)||task.colaborador_ids.some(id=>!positive(id)))throw invalid();
  return value;
}
// One human intent, document memory only. No automatic replay or inference
// from inventory/title; GET404 keeps the exact uncertain POST available.
export function createTaskCreationAttempt({capture,send,onState=()=>{},randomUUID=()=>globalThis.crypto.randomUUID()}){
  let attempt=null,busy=false,phase='idle',error='',accepted=null,disposed=false;
  const live=()=>{try{return !disposed&&(!attempt||attempt.scope.current());}catch{return false;}};
  const snapshot=()=>Object.freeze({phase,busy,error,locked:phase!=='idle',
    canVerify:phase==='uncertain'&&!busy,canRetry:phase==='uncertain'&&!busy,accepted,
    requestId:attempt?.input.request_id??null});
  const publish=()=>{if(live())try{onState(snapshot());}catch{}};
  async function run(method){
    if(busy||!attempt||!live())return false;
    const held=attempt,wasUncertain=phase==='uncertain';
    busy=true;phase=method==='GET'?'checking':'writing';error='';publish();
    try{
      if(!live()||attempt!==held)return false;
      const value=await send(held.input,{scope:held.scope,method});
      if(!live()||attempt!==held)return false;
      accepted=parseTaskCreationAck(value,held.input.request_id,accepted?.task.id??null);phase='confirmed';return true;
    }catch(reason){
      if(!live()||attempt!==held)return false;
      if([401,403].includes(reason?.status)||reason?.code==='session_binding_obsolete')phase='blocked';
      else if(reason?.status===409)phase='conflict';
      else if(method==='POST'&&!wasUncertain&&[400,413,422].includes(reason?.status)){phase='idle';attempt=null;}
      else phase='uncertain';
      error=phase==='idle'?(reason.message||'Revisá los datos antes de crear la tarea.'):
        phase==='blocked'?'La sesión o el permiso cambió. No enviaremos más cambios desde este intento.':
        phase==='conflict'?'Este intento no coincide con el guardado. No crearemos otra tarea automáticamente.':invalid().message;
      return false;
    }finally{if(attempt===held||phase==='idle'){busy=false;publish();}}
  }
  return Object.freeze({get snapshot(){return snapshot();},
    start(draft){
      if(disposed||busy||phase!=='idle')return Promise.resolve(false);
      try{
        const scope=capture();if(!scope?.current())return Promise.resolve(false);
        const input=taskCreationBody(draft,randomUUID());
        Object.freeze(input.colaborador_ids);Object.freeze(input.etiquetas);Object.freeze(input);
        attempt=Object.freeze({scope,input});accepted=null;
      }catch(reason){error=reason.message||invalid().message;publish();return Promise.resolve(false);}
      return run('POST');
    },
    verify(){return phase==='uncertain'?run('GET'):Promise.resolve(false);},
    retry(){return phase==='uncertain'?run('POST'):Promise.resolve(false);},
    dispose(){disposed=true;phase='blocked';busy=false;},
  });
}
