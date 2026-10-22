import {isSessionFailure} from './captured-request.js';
import {createMoodboardReferenceWrite} from './moodboard-reference-write.js';
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

// Creation receipt and optional task link are separate stages. A link outcome
// never causes another creation or an automatic replay of an uncertain link.
export function createMoodboardReferenceOperation({boardId,taskId=null,capture,refresh,randomUUID}){
  if(!positive(boardId)||taskId!==null&&!positive(taskId))throw fail('Moodboard o tarea inválidos.');
  let guard=null,created=null,createdId=null,busy=false,phase='idle',observedLinked=null,writeConfirmed=false,readConfirmed=false,accepted=false,gone=false,disposed=false;
  const current=()=>!disposed&&Boolean(guard?.current());
  const writer=createMoodboardReferenceWrite({boardId,capture:()=>{guard=capture();return guard},refresh,randomUUID});
  function assertAvailable(){if(disposed||busy)throw fail('Hay otra operación en curso.');guard?.assertCurrent();}
  function finish(){assertAvailable();if(!accepted||!readConfirmed||!['complete','not_visible','observed_missing'].includes(phase))throw fail('Verificá el intento y revisá la lista antes de finalizar.');return{referenceId:gone?null:createdId,scope:guard};}
  async function read(){
    guard.assertCurrent();const result=await refresh(guard);guard.assertCurrent();if(disposed)throw fail('El editor cambió.');
    const reference=visibleReference(result,boardId,createdId);readConfirmed=true;
    observedLinked=reference&&taskId!==null?reference.tareas.some(task=>task.id===taskId):null;
    phase=gone?'complete':!reference?'not_visible':taskId!==null&&!observedLinked?'observed_missing':'complete';return result;
  }
  async function link(){
    try{await writeLink(guard,createdId,taskId,'POST');if(disposed)throw fail('El editor cambió.');writeConfirmed=true;}
    catch(error){phase=!current()||isSessionFailure(error)?'blocked':safeRejection(error)?'link_failed':'link_uncertain';throw error;}
  }
  async function readAfterWrite(){try{await read();}catch(error){phase=!current()||isSessionFailure(error)?'blocked':'refresh_failed';throw error;}}
  async function accept(result){
    guard=result.scope;accepted=true;created=result.ack.reference;createdId=result.ack.operation.reference_id;gone=created===null;phase='created';
    if(!gone&&taskId!==null&&!result.ack.operation.replayed){
      if(created.tareas.some(task=>task.id===taskId))observedLinked=true;
      else await link();
    }
    await readAfterWrite();return{referenceId:gone?null:createdId,scope:guard};
  }
  return Object.freeze({
    get snapshot(){return Object.freeze({phase,busy,createdId,taskId,writeConfirmed,observedLinked,gone,accepted,
      canRetryLink:phase==='link_failed',canVerifyCreate:phase==='creation_uncertain',
      canFinish:accepted&&readConfirmed&&['complete','not_visible','observed_missing'].includes(phase)});},
    current,
    async create(data){
      if(disposed||busy||phase!=='idle')throw fail('Verificá el intento pendiente; no crearemos otra referencia.');
      busy=true;phase='creating';
      try{
        let result;
        try{result=await writer.submit('create',null,data);}
        catch(error){phase=!current()||isSessionFailure(error)?'blocked':writer.snapshot.phase==='idle'?'idle':writer.snapshot.phase==='conflict'?'creation_conflict':'creation_uncertain';throw error;}
        return await accept(result);
      }finally{busy=false;}
    },
    async verifyCreate(){
      assertAvailable();if(phase!=='creation_uncertain')throw fail('Sólo se verifica el mismo intento de creación pendiente.');busy=true;
      try{let result;try{result=await writer.verify();}catch(error){phase=!current()||isSessionFailure(error)?'blocked':writer.snapshot.phase==='conflict'?'creation_conflict':writer.snapshot.phase==='idle'?'idle':'creation_uncertain';throw error;}return await accept(result);}
      finally{busy=false;}
    },
    async retryLink(){assertAvailable();if(phase!=='link_failed'||!created||taskId===null)throw fail('Un vínculo incierto no se repite. Actualizá para revisar.');busy=true;try{await link();await readAfterWrite();return{referenceId:createdId,scope:guard};}finally{busy=false;}},
    async refresh(){
      assertAvailable();if(!guard||!accepted&&!['creation_conflict','creation_reviewed'].includes(phase))throw fail('Primero verificá la creación; una lectura no confirma ese intento.');
      busy=true;try{
        if(!accepted){const result=await writer.observe();phase='creation_reviewed';return result.result;}
        return await read();
      }catch(error){if(!current()||isSessionFailure(error))phase='blocked';else if(accepted)phase='refresh_failed';throw error;}finally{busy=false;}
    },
    releaseConflict(){assertAvailable();if(phase!=='creation_reviewed')throw fail('Leé y revisá el conflicto antes de otro intento.');writer.releaseConflict();guard=null;phase='idle';},
    cancel(){disposed=true;writer.cancel();phase='blocked';},
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
