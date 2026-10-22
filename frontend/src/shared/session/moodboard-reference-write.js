import {isSessionFailure} from './captured-request.js';
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fail=()=>new Error('No se pudo verificar la operación de referencia. Conservá el intento y verificá su resultado.');
const keys=['id','board_id','category_id','titulo','nota','etiquetas','estado','tipo_fuente','enlace_externo','archivo_nombre','autor_id','autor_nombre','created_at','updated_at','categoria','tareas','revision'];
export function parseMoodboardReference(value,boardId){
  if(!closed(value,keys)||!positive(value.id)||!positive(boardId)||value.board_id!==boardId||!revision(value.revision)
    ||![value.category_id,value.autor_id].every(id=>id===null||positive(id))
    ||!(value.titulo===null||typeof value.titulo==='string')||!['nota','autor_nombre'].every(key=>typeof value[key]==='string')
    ||!['categoria','enlace_externo','archivo_nombre'].every(key=>value[key]===null||typeof value[key]==='string')
    ||!['libre','aprobada','descartada'].includes(value.estado)||!['imagen','enlace','pinterest'].includes(value.tipo_fuente)
    ||!['created_at','updated_at'].every(key=>typeof value[key]==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value[key])&&Number.isFinite(Date.parse(value[key])))
    ||!Array.isArray(value.etiquetas)||value.etiquetas.some(tag=>typeof tag!=='string')
    ||!Array.isArray(value.tareas)||value.tareas.some(task=>!closed(task,['id','titulo'])||!positive(task.id)||typeof task.titulo!=='string')
    ||new Set(value.tareas.map(task=>task.id)).size!==value.tareas.length)throw fail();
  return Object.freeze({...value,etiquetas:Object.freeze([...value.etiquetas]),tareas:Object.freeze(value.tareas.map(task=>Object.freeze({...task})))});
}
export function moodboardReferenceWriteBody(boardId,action,reference,fields,requestId){
  if(!positive(boardId)||!uuid(requestId)||!['create','edit','delete'].includes(action))throw fail();
  const body={request_id:requestId,action,board_id:boardId};
  if(action!=='create'){
    const observed=parseMoodboardReference(reference,boardId);body.reference_id=observed.id;body.expected_revision=observed.revision;
  }
  if(action!=='delete'){
    const allowed=action==='create'?['title','note','category_id','tags','external_url','image_data']:['title','note','category_id','tags','status'];
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length||Object.keys(fields).some(key=>!allowed.includes(key))
      ||['title','note'].some(key=>Object.hasOwn(fields,key)&&typeof fields[key]!=='string')
      ||Object.hasOwn(fields,'category_id')&&!(fields.category_id===null&&action==='edit'||positive(fields.category_id))
      ||Object.hasOwn(fields,'tags')&&(!Array.isArray(fields.tags)||fields.tags.some(tag=>typeof tag!=='string'))
      ||Object.hasOwn(fields,'status')&&!['libre','aprobada','descartada'].includes(fields.status)
      ||['external_url','image_data'].some(key=>Object.hasOwn(fields,key)&&fields[key]!==null&&typeof fields[key]!=='string'))throw fail();
    if(action==='create'&&(!positive(fields.category_id)||typeof fields.note!=='string'||!fields.note.trim()))throw fail();
    body.fields=JSON.parse(JSON.stringify(fields));
  }else if(fields!==undefined)throw fail();
  return body;
}
export function parseMoodboardReferenceWrite(value,body){
  if(!closed(value,['version','reference','operation'])||value.version!==1||!closed(value.operation,['request_id','action','reference_id','result_revision','replayed']))throw fail();
  const op=value.operation;
  if(op.request_id!==body.request_id||op.action!==body.action||!positive(op.reference_id)||typeof op.replayed!=='boolean'||!revision(op.result_revision)
    ||body.action!=='create'&&op.reference_id!==body.reference_id
    ||body.action==='create'&&op.result_revision!==0
    ||body.action==='edit'&&op.result_revision<=body.expected_revision
    ||body.action==='delete'&&op.result_revision!==body.expected_revision)throw fail();
  const reference=value.reference===null?null:parseMoodboardReference(value.reference,body.board_id);
  if(reference&&(reference.id!==op.reference_id||reference.revision<op.result_revision||!op.replayed&&reference.revision!==op.result_revision)
    ||!reference&&!op.replayed&&body.action!=='delete'||body.action==='delete'&&reference!==null)throw fail();
  return Object.freeze({version:1,reference,operation:Object.freeze({...op})});
}
// Receipt ownership is independent of optional task-link writes and readback.
export function createMoodboardReferenceWrite({boardId,capture,refresh,randomUUID=()=>globalThis.crypto.randomUUID()}){
  let attempt=null,accepted=null,phase='idle',busy=false,disposed=false,observed=null;
  const check=()=>{if(disposed)throw fail();attempt?.scope.assertCurrent();};
  async function run(action){if(busy)throw fail();check();busy=true;try{return await action();}catch(error){if(disposed||attempt&&!attempt.scope.current()||isSessionFailure(error)||[401,403].includes(error?.status))phase='blocked';throw error;}finally{busy=false;}}
  const response=()=>({ack:accepted,scope:attempt.scope});
  async function send(){
    phase='writing';
    try{const value=await attempt.scope.request('/api/moodboards/reference-operations',{method:'POST',headers:{'Content-Type':'application/json'},body:attempt.body});check();accepted=parseMoodboardReferenceWrite(value,attempt.input);phase='confirmed';return response();}
    catch(error){if([400,413,422,428].includes(error?.status)){attempt=null;phase='idle';}else phase=[404,409].includes(error?.status)?'conflict':'uncertain';throw error;}
  }
  function reset(){attempt=null;accepted=null;observed=null;phase='idle';}
  return Object.freeze({
    get snapshot(){return Object.freeze({phase,busy,locked:attempt!==null,accepted,observed});},
    submit(action,reference,fields){
      if(disposed||busy||attempt||phase!=='idle')return Promise.reject(fail());
      const scope=capture();scope.assertCurrent();const input=moodboardReferenceWriteBody(boardId,action,reference,fields,randomUUID());
      attempt=Object.freeze({scope,input,body:JSON.stringify(input)});return run(send);
    },
    verify(){return run(()=>{if(accepted&&['confirmed','refresh_failed'].includes(phase))return response();if(phase!=='uncertain')throw fail();return send();});},
    settle(){return run(async()=>{if(!accepted||!['confirmed','refresh_failed'].includes(phase))throw fail();phase='refresh_failed';const result=await refresh(attempt.scope);check();
      if(!Array.isArray(result?.references))throw fail();const row=result.references.find(row=>row.id===accepted.operation.reference_id);
      const visible=row?parseMoodboardReference(row,boardId):null;if(visible&&visible.revision<accepted.operation.result_revision)throw fail();
      phase='complete';return {...response(),result,visible};});},
    observe(){return run(async()=>{if(phase!=='conflict')throw fail();let result=null;observed=null;
      if(attempt.input.reference_id){
        try{const value=await attempt.scope.request(`/api/moodboards/references/${attempt.input.reference_id}/detail`,{cache:'no-store'});check();
          if(!closed(value,['version','reference'])||value.version!==1)throw fail();observed=parseMoodboardReference(value.reference,boardId);if(observed.id!==attempt.input.reference_id)throw fail();
        }catch(error){if(error?.status!==404)throw error;check();}
      }else{result=await refresh(attempt.scope);check();if(!Array.isArray(result?.references))throw fail();}
      phase='reviewed';return {observed,scope:attempt.scope,result};});},
    releaseConflict(){check();if(busy||phase!=='reviewed')throw fail();reset();},
    complete(){check();if(busy||phase!=='complete')throw fail();reset();},
    cancel(){disposed=true;attempt=null;accepted=null;observed=null;phase='blocked';},
  });
}
