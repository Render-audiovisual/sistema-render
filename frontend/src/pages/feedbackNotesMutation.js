import {isSessionFailure} from '../shared/session/captured-request.js';
import {parseFeedbackNote} from './feedbackNotesPagination.js';

const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const invalid=()=>new Error('No se pudo verificar el intento de nota. Conservá el texto y revisá la operación.');
const business=['cliente','responsable','responsables','referencia','estado','vigencia','flujo'];
export function feedbackNotesMutationBody(input,requestId) {
  if(!uuid(requestId)||!input||!['create','edit','trash','restore','purge'].includes(input.action))throw invalid();
  const body={request_id:requestId,action:input.action};
  if(input.action!=='create'){
    if(!positive(input.note?.id)||!instant(input.note.updated_at))throw invalid();
    body.note_id=input.note.id;body.expected_updated_at=input.note.updated_at;
  }
  if(['create','edit'].includes(input.action)){
    const fields=input.fields;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length||Object.keys(fields).some(key=>!['titulo','contenido','categoria','feedback'].includes(key))
      ||input.action==='create'&&!['titulo','contenido','categoria','feedback'].every(key=>Object.hasOwn(fields,key)))throw invalid();
    if(['titulo','contenido'].some(key=>Object.hasOwn(fields,key)&&typeof fields[key]!=='string')
      ||Object.hasOwn(fields,'categoria')&&!['general','diseno','web','reunion','contenido'].includes(fields.categoria))throw invalid();
    if(Object.hasOwn(fields,'feedback')){
      const value=fields.feedback;
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!business.includes(key))
        ||Object.keys(value).some(key=>value[key]!==null&&(key==='responsables'?(!Array.isArray(value[key])||value[key].some(name=>typeof name!=='string')):typeof value[key]!=='string')))throw invalid();
    }
    body.fields=JSON.parse(JSON.stringify(fields));
  }else if(input.fields!==undefined)throw invalid();
  return body;
}
export function parseFeedbackNotesMutation(value,body){
  if(!closed(value,['version','note','operation'])||value.version!==1||!closed(value.operation,['request_id','action','note_id','note_updated_at','replayed']))throw invalid();
  const op=value.operation;
  if(op.request_id!==body.request_id||op.action!==body.action||!positive(op.note_id)||body.action!=='create'&&op.note_id!==body.note_id||typeof op.replayed!=='boolean'
    ||!(instant(op.note_updated_at)||body.action==='purge'&&op.note_updated_at===null))throw invalid();
  const note=value.note===null?null:parseFeedbackNote(value.note,value.note?.eliminado_at!==null);
  if(note&&note.id!==op.note_id||note===null&&!op.replayed&&body.action!=='purge'
    ||note&&Date.parse(note.updated_at)<Date.parse(op.note_updated_at)
    ||!op.replayed&&note&&Date.parse(note.updated_at)!==Date.parse(op.note_updated_at)
    ||!op.replayed&&note&&body.action!=='purge'&&body.expected_updated_at&&Date.parse(op.note_updated_at)<=Date.parse(body.expected_updated_at)
    ||!op.replayed&&note&&((note.eliminado_at!==null)!==(body.action==='trash'))
    ||!op.replayed&&body.action==='purge'&&note!==null)throw invalid();
  return {version:1,note,operation:{...op}};
}

// No timer, background verification, refetch/rebase, or new UUID after dispatch.
export function createFeedbackNotesMutation({capture,refresh,onChange=()=>{},randomUUID=()=>globalThis.crypto.randomUUID()}){
  let phase='idle',busy=false,attempt=null,accepted=null,observed=null,duplicates=[],disposed=false;
  const state=()=>Object.freeze({phase,busy,locked:attempt!==null,accepted,observed,duplicates:[...duplicates]});
  const publish=()=>{if(!disposed&&(!attempt||attempt.scope.current()))onChange(state());};
  const check=()=>{if(disposed)throw invalid();attempt?.scope.assertCurrent();};
  async function run(action){
    if(disposed||busy)throw invalid();check();busy=true;publish();
    try{return await action();}
    catch(reason){if(disposed||attempt&&!attempt.scope.current()||isSessionFailure(reason)||[401,403].includes(reason?.status))phase='blocked';throw reason;}
    finally{busy=false;publish();}
  }
  async function readAfterAck(){
    phase='read_failed';publish();const data=await refresh(attempt.scope,accepted);check();phase='complete';
    return {ack:accepted,data};
  }
  async function send(){
    phase='writing';publish();
    try{const value=await attempt.scope.request('/api/notas/operaciones',{method:'POST',headers:{'Content-Type':'application/json'},body:attempt.body});check();accepted=parseFeedbackNotesMutation(value,attempt.input);}
    catch(reason){if([400,413,422,428].includes(reason?.status)){phase='idle';attempt=null;}else phase=[404,409].includes(reason?.status)?'conflict':'uncertain';throw reason;}
    return readAfterAck();
  }
  function reset(){attempt=null;accepted=null;observed=null;duplicates=[];phase='idle';publish();}
  return Object.freeze({
    get snapshot(){return state();},
    start(input,{checkDuplicates=false}={}){
      if(disposed||busy||attempt||phase!=='idle')return Promise.reject(invalid());
      // Freeze all intent data and its actor before the first asynchronous step.
      const scope=capture();scope.assertCurrent();const body=feedbackNotesMutationBody(input,randomUUID());
      attempt=Object.freeze({scope,input:Object.freeze(body),body:JSON.stringify(body)});phase='preflight';
      return run(async()=>{
        if(checkDuplicates&&body.action==='create'){
          try{
            const params=new URLSearchParams({cliente:body.fields.feedback.cliente??'',titulo:body.fields.titulo,contenido:body.fields.contenido});
            const value=await scope.request(`/api/notas/similares?${params}`);check();
            if(!Array.isArray(value?.similares)||value.similares.some(row=>!positive(row?.id)||typeof row.titulo!=='string'))throw invalid();
            if(value.similares.length){duplicates=value.similares.map(row=>({id:row.id,titulo:row.titulo,cliente:typeof row.cliente==='string'?row.cliente:''}));phase='duplicates';return {duplicates:[...duplicates]};}
          }catch(reason){phase='idle';attempt=null;throw reason;}
        }
        return send();
      });
    },
    confirmCreate(){return run(()=>{if(phase!=='duplicates')throw invalid();return send();});},
    verify(){return run(()=>{if(phase==='read_failed'&&accepted)return readAfterAck();if(phase!=='uncertain')throw invalid();return send();});},
    observe(){return run(async()=>{
      if(phase!=='conflict')throw invalid();
      if(attempt.input.action==='create'){observed={note:null};await refresh(attempt.scope,null);check();}
      else{
        let note=null;
        for(const papelera of [false,true]){
          try{const value=await attempt.scope.request(`/api/notas/${attempt.input.note_id}/detalle?papelera=${papelera}`,{cache:'no-store'});check();
            if(!closed(value,['version','item'])||value.version!==1)throw invalid();note=parseFeedbackNote(value.item,papelera);if(note.id!==attempt.input.note_id)throw invalid();break;
          }catch(reason){if(reason?.status!==404)throw reason;}
        }
        check();observed={note};
      }
      phase='reviewed';return observed;
    });},
    releaseUnsent(){check();if(busy||phase!=='duplicates')throw invalid();reset();},
    releaseConflict(){check();if(busy||phase!=='reviewed')throw invalid();const value=observed;reset();return value;},
    complete(){check();if(busy||phase!=='complete')throw invalid();reset();},
    cancel(){disposed=true;attempt=null;accepted=null;duplicates=[];observed=null;phase='blocked';},
  });
}
