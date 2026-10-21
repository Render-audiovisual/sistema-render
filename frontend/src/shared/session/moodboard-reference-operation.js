import {isSessionFailure} from './captured-request.js';
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const fail=message=>new Error(message);
const safeRejection=error=>!isSessionFailure(error)&&[400,403,404,409,422].includes(error?.status);
export function verifiedMoodboardReference(value,boardId){
  if(!positive(value?.id)||!positive(boardId)||value.board_id!==boardId)throw fail('No se pudo confirmar qué referencia se guardó. Revisá la lista antes de crear otra.');
  return Object.freeze({id:value.id,board_id:value.board_id});
}
function visibleReference(result,boardId,referenceId){
  if(!Array.isArray(result?.references)||!Array.isArray(result.tasks))throw fail('No se pudo verificar la lectura del moodboard.');
  if(referenceId===null)return null;
  const reference=result.references.find(item=>item.id===referenceId);
  if(!reference)return null; // Absence in this projection is NOT physical deletion.
  verifiedMoodboardReference(reference,boardId);
  if(!Array.isArray(reference.tareas)||reference.tareas.some(task=>!positive(task?.id)))throw fail('No se pudieron verificar los vínculos visibles.');
  return reference;
}
async function writeLink(guard,referenceId,taskId,method){
  guard.assertCurrent();
  const value=await guard.request(`/api/moodboards/references/${referenceId}/tasks/${taskId}`,{method});
  guard.assertCurrent();
  if(value!==null)throw fail('No se pudo confirmar el vínculo. Actualizá la lista antes de decidir otra acción.');
}

// Memory-only recovery, no receipt and no second creation after a sent request.
export function createMoodboardReferenceOperation({boardId,taskId=null,capture,refresh}){
  if(!positive(boardId)||taskId!==null&&!positive(taskId))throw fail('Moodboard o tarea inválidos.');
  let guard=null,created=null,busy=false,phase='idle',observedLinked=null,writeConfirmed=false,readConfirmed=false;
  const current=()=>Boolean(guard?.current());
  function assertAvailable(){if(busy)throw fail('Hay otra operación en curso.');guard?.assertCurrent();}
  function finish(){assertAvailable();if(!guard||(!created&&!readConfirmed))throw fail('Actualizá y revisá la lista antes de continuar.');guard.assertCurrent();return{referenceId:created?.id??null,scope:guard};}
  async function read(){
    guard.assertCurrent();const result=await refresh(guard);guard.assertCurrent();
    const reference=visibleReference(result,boardId,created?.id??null);readConfirmed=true;
    observedLinked=reference&&taskId!==null?reference.tareas.some(task=>task.id===taskId):null;
    phase=!created?'creation_reviewed':!reference?'not_visible':taskId!==null&&!observedLinked?'observed_missing':'complete';
    return result;
  }
  async function link(){
    try{await writeLink(guard,created.id,taskId,'POST');writeConfirmed=true;}
    catch(error){phase=!current()||isSessionFailure(error)?'blocked':safeRejection(error)?'link_failed':'link_uncertain';throw error;}
  }
  async function readAfterWrite(){try{await read();}catch(error){phase=!current()||isSessionFailure(error)?'blocked':'refresh_failed';throw error;}}
  return Object.freeze({
    get snapshot(){return Object.freeze({phase,busy,createdId:created?.id??null,taskId,writeConfirmed,observedLinked,canRetryLink:phase==='link_failed',canFinish:Boolean(created||readConfirmed)});},
    current,
    async create(data){
      if(busy||phase!=='idle')throw fail('Este intento ya fue enviado. Revisá la lista; no crearemos otra referencia.');
      guard=capture();guard.assertCurrent();const body=JSON.stringify(data);busy=true;phase='creating';
      try{
        try{const response=await guard.request(`/api/moodboards/boards/${boardId}/references`,{method:'POST',headers:{'Content-Type':'application/json'},body});guard.assertCurrent();created=verifiedMoodboardReference(response,boardId);phase='created';}
        catch(error){phase=!current()||isSessionFailure(error)?'blocked':error?.status===400?'idle':'creation_uncertain';throw error;}
        if(taskId!==null)await link();
        await readAfterWrite();return{referenceId:created.id,scope:guard};
      }finally{busy=false;}
    },
    async retryLink(){assertAvailable();if(phase!=='link_failed'||!created||taskId===null)throw fail('Primero actualizá y revisá los vínculos visibles; no repetiremos un envío incierto.');busy=true;try{await link();await readAfterWrite();return{referenceId:created.id,scope:guard};}finally{busy=false;}},
    async refresh(){assertAvailable();if(!guard)throw fail('No hay un intento enviado para revisar.');busy=true;try{return await read();}catch(error){phase=!current()||isSessionFailure(error)?'blocked':'refresh_failed';throw error;}finally{busy=false;}},
    finish,
  });
}

// One reference, one synchronous lock. Uncertain writes can only be observed;
// a later change is a new deliberate decision based on the visible projection.
export function createMoodboardTaskLinkOperation({boardId,reference,capture,refresh}){
  const identity=verifiedMoodboardReference(reference,boardId);
  let linked=new Set(),intent=null,busy=false,phase='idle',writeConfirmed=false;
  function observe(value){verifiedMoodboardReference(value,boardId);if(value.id!==identity.id||!Array.isArray(value.tareas)||value.tareas.some(task=>!positive(task?.id)))throw fail('Referencia visible inválida.');if(busy||intent)return false;linked=new Set(value.tareas.map(task=>task.id));return true;}
  observe(reference);
  async function read(){
    const own=intent;own.guard.assertCurrent();const result=await refresh(own.guard);own.guard.assertCurrent();const value=visibleReference(result,boardId,identity.id);
    if(value)linked=new Set(value.tareas.map(task=>task.id));
    phase=value?'idle':'not_visible';intent=null;return result;
  }
  async function send(){
    const own=intent;busy=true;
    try{
      try{await writeLink(own.guard,identity.id,own.taskId,own.method);writeConfirmed=true;if(own.method==='POST')linked.add(own.taskId);else linked.delete(own.taskId);}
      catch(error){phase=!own.guard.current()||isSessionFailure(error)?'blocked':safeRejection(error)?'write_failed':'uncertain';throw error;}
      try{return await read();}catch(error){phase=!own.guard.current()||isSessionFailure(error)?'blocked':'refresh_failed';throw error;}
    }finally{busy=false;}
  }
  return Object.freeze({
    get snapshot(){return Object.freeze({phase,busy,locked:Boolean(intent)||phase==='not_visible',writeConfirmed,canRetryWrite:phase==='write_failed'});},
    isLinked(taskId){return linked.has(taskId);},observe,
    async change(taskId,desiredLinked){
      if(busy||intent||phase!=='idle')throw fail('Actualizá los vínculos antes de otra decisión.');
      if(!positive(taskId)||typeof desiredLinked!=='boolean')throw fail('Tarea o vínculo inválido.');
      const guard=capture();guard.assertCurrent();intent=Object.freeze({guard,taskId,method:desiredLinked?'POST':'DELETE'});writeConfirmed=false;return send();
    },
    async retryWrite(){if(busy||phase!=='write_failed'||!intent)throw fail('Un envío incierto no se repite. Actualizá para revisar.');intent.guard.assertCurrent();return send();},
    async refresh(){if(busy||!intent)throw fail('No hay un vínculo pendiente para revisar.');busy=true;try{return await read();}catch(error){if(!intent?.guard.current()||isSessionFailure(error))phase='blocked';throw error;}finally{busy=false;}},
  });
}
