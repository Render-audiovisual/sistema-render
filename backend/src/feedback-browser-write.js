import { createHash } from 'node:crypto';
import { feedbackVersionIso } from './feedback-receipts.js';
import { normalizeFeedback, assertFeedbackBusinessInput } from './feedback-fields.js';
import { getTaskActor } from './task-access.js';
import { encolarNotificacionPrivadaFeedback } from './private-feedback-notifications.js';
import { FEEDBACK_NOTE_SQL_PROJECTION, readFeedbackNoteFromClient, feedbackNoteMetadataDto } from './feedback-notes-read.js';

const fail=(status,message,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const has=(value,key)=>Object.hasOwn(value,key);
const actions=new Set(['create','edit','trash','restore','purge']);
const categorySet=new Set(['general','diseno','web','reunion','contenido']);
const businessKeys=['cliente','responsable','responsables','referencia','estado','vigencia','flujo'];
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
function actorObservation(auth){
  if(!positive(auth?.id)||!positive(auth?.session_version)||typeof auth?.rol!=='string'||!auth.rol.trim())throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return Object.freeze({id:auth.id,session_version:auth.session_version,rol:auth.rol});
}
function text(value){if(typeof value!=='string'||value.includes('\u0000'))throw fail(400,'El contenido de la nota debe ser texto válido.');return value;}
function feedbackPatch(value,create){
  if(!object(value)||Object.keys(value).some(key=>!businessKeys.includes(key)))throw fail(400,'Campos de feedback inválidos.');
  assertFeedbackBusinessInput(value);
  const normalized=normalizeFeedback(value);
  if(create)return normalized;
  const patch={};
  for(const key of ['cliente','referencia','estado','vigencia','flujo'])if(has(value,key))patch[key]=normalized[key];
  if(has(value,'responsable')||has(value,'responsables')){patch.responsable=normalized.responsable;patch.responsables=normalized.responsables;}
  return patch;
}
export function normalizeFeedbackBrowserOperation(body){
  if(!object(body))throw fail(400,'Operación de notas inválida.');
  if(!has(body,'request_id'))throw fail(428,'Falta la clave de la operación.','FEEDBACK_REQUEST_ID_REQUIRED');
  if(typeof body.request_id!=='string'||body.request_id.length!==36||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.request_id))throw fail(400,'La clave de la operación no es válida.');
  if(Object.keys(body).some(key=>!['request_id','action','note_id','expected_updated_at','fields'].includes(key))||!actions.has(body.action))throw fail(400,'Operación de notas inválida.');
  const create=body.action==='create',input={request_id:body.request_id.toLowerCase(),action:body.action};
  if(create){if(has(body,'note_id')||has(body,'expected_updated_at'))throw fail(400,'La creación no admite una nota o revisión anterior.');}
  else{
    if(!has(body,'note_id')||!has(body,'expected_updated_at'))throw fail(428,'Falta la nota y su revisión observada.','FEEDBACK_VERSION_REQUIRED');
    if(!positive(body.note_id))throw fail(400,'Nota inválida.');
    input.note_id=body.note_id;input.expected_updated_at=feedbackVersionIso(body.expected_updated_at);
  }
  if(create||body.action==='edit'){
    if(!object(body.fields)||Object.keys(body.fields).some(key=>!['titulo','contenido','categoria','feedback'].includes(key))||(!create&&!Object.keys(body.fields).length))throw fail(400,'Campos de nota inválidos.');
    const fields={};
    if(create||has(body.fields,'titulo'))fields.titulo=has(body.fields,'titulo')?text(body.fields.titulo).trim()||'Nueva nota':'Nueva nota';
    if(create||has(body.fields,'contenido'))fields.contenido=has(body.fields,'contenido')?text(body.fields.contenido):'';
    if(create||has(body.fields,'categoria')){
      const value=has(body.fields,'categoria')?text(body.fields.categoria).trim().toLowerCase():'general';
      if(!categorySet.has(value))throw fail(400,'Categoría de nota inválida.');fields.categoria=value;
    }
    if(create||has(body.fields,'feedback')){
      const patch=feedbackPatch(body.fields.feedback??(create&&!has(body.fields,'feedback')?{}:null),create);
      if(Object.keys(patch).length)fields.feedback=Object.freeze({...patch,...(patch.responsables?{responsables:Object.freeze([...patch.responsables])}:{})});
    }
    if(!Object.keys(fields).length)throw fail(400,'No se enviaron cambios.');
    input.fields=Object.freeze(fields);
  }else if(has(body,'fields'))throw fail(400,'Esta operación no admite campos de contenido.');
  return Object.freeze(input);
}
function effectiveFeedback(current,patch){
  const value={...feedbackNoteMetadataDto(current),...(patch??{})};
  const responsables=[...(Array.isArray(value.responsables)?value.responsables:[]),value.responsable];
  if(value.flujo==='feedback'&&!responsables.some(name=>typeof name==='string'&&name.trim()))throw fail(422,'Elegí al menos una persona responsable.');
}
function receiptVersion(value){return feedbackVersionIso(value instanceof Date?value.toISOString():value);}
function operationDto(input,id,version,replayed){return{request_id:input.request_id,action:input.action,note_id:id,note_updated_at:receiptVersion(version),replayed};}

export async function applyFeedbackBrowserOperation(pool,auth,body,query={}){
  const observed=actorObservation(auth);
  if(!object(query)||Object.keys(query).length)throw fail(400,'No se permiten parámetros de consulta.');
  const input=normalizeFeedbackBrowserOperation(body);
  const hash=createHash('sha256').update(stable({contract:'feedback-browser-operation-v1',action:input.action,note_id:input.note_id??null,expected_updated_at:input.expected_updated_at??null,fields:input.fields??null})).digest('hex');
  const db=await pool.connect();let discard;
  try{
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019,1)');
    const actor=(await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE',[observed.id])).rows[0];
    if(!actor||actor.id!==observed.id||actor.activo!==true||actor.session_version!==observed.session_version||actor.rol!==observed.rol)throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
    const receipt=(await db.query(`SELECT action,payload_hash,note_id,
      to_char(note_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS note_updated_at
      FROM feedback_browser_operations WHERE actor_user_id=$1 AND request_id=$2`,[observed.id,input.request_id])).rows[0];
    if(receipt){
      if(receipt.action!==input.action||receipt.payload_hash!==hash)throw fail(409,'La clave ya corresponde a otra operación.','FEEDBACK_OPERATION_REPLAY_MISMATCH');
      const id=typeof receipt.note_id==='string'&&String(Number(receipt.note_id))===receipt.note_id?Number(receipt.note_id):receipt.note_id;
      if(!positive(id))throw fail(500,'No se pudo verificar el recibo de feedback.');
      await db.query('SELECT id FROM notas_compartidas WHERE id=$1 FOR UPDATE',[id]);
      const note=await readFeedbackNoteFromClient(db,id),operation=operationDto(input,id,receipt.note_updated_at,true);
      await db.query('COMMIT');return{status:200,body:{version:1,note,operation}};
    }
    const label=getTaskActor(actor);let id=input.note_id,version;
    if(input.action==='create'){
      effectiveFeedback({},input.fields.feedback);
      const saved=(await db.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,feedback,creado_por,modificado_por)
        VALUES($1,$2,$3,$4::jsonb,$5,$5) RETURNING id`,[input.fields.titulo,input.fields.contenido,input.fields.categoria,JSON.stringify(input.fields.feedback),label])).rows[0];
      id=saved?.id;if(!positive(id))throw fail(500,'No se pudo verificar la nota creada.');
    }else{
      const row=(await db.query(`SELECT ${FEEDBACK_NOTE_SQL_PROJECTION} FROM notas_compartidas WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!row)throw fail(404,'Nota no encontrada.');
      if(receiptVersion(row.updated_at)!==input.expected_updated_at)throw fail(409,'Otra persona modificó esta nota. Conservá el borrador y volvé a revisarla.','FEEDBACK_BROWSER_VERSION_CONFLICT');
      const trashed=row.eliminado_at!==null;
      if((input.action==='edit'||input.action==='trash')?trashed:!trashed)throw fail(409,'La nota cambió de colección. Volvé a revisarla.','FEEDBACK_NOTE_STATE_CONFLICT');
      version=row.updated_at;
      if(input.action==='edit'){
        effectiveFeedback(row.feedback,input.fields.feedback);
        const params=[],sets=[];
        for(const key of ['titulo','contenido','categoria'])if(has(input.fields,key)){params.push(input.fields[key]);sets.push(`${key}=$${params.length}`);}
        if(input.fields.feedback){params.push(JSON.stringify(input.fields.feedback));sets.push(`feedback=COALESCE(feedback,'{}'::jsonb)||$${params.length}::jsonb`);}
        params.push(label);sets.push(`modificado_por=$${params.length}`);params.push(id);
        await db.query(`UPDATE notas_compartidas SET ${sets.join(',')} WHERE id=$${params.length}`,params);
      }else if(input.action==='purge')await db.query('DELETE FROM notas_compartidas WHERE id=$1',[id]);
      else await db.query(`UPDATE notas_compartidas SET eliminado_at=${input.action==='trash'?'now()':'NULL'},modificado_por=$2 WHERE id=$1`,[id,label]);
    }
    const note=await readFeedbackNoteFromClient(db,id);
    if(input.action==='purge'?note!==null:note===null)throw fail(500,'No se pudo verificar el resultado de la operación.');
    if(input.action!=='create'&&input.action!=='purge'&&receiptVersion(note.updated_at)<=input.expected_updated_at)throw fail(500,'No se pudo verificar la revisión guardada.');
    version=note?.updated_at??version;
    if(input.action==='create'&&note.feedback?.flujo==='feedback'){
      // The outbox and note/receipt commit together. Replays return above and
      // cannot enqueue again; failed inserts roll back the entire operation.
      await encolarNotificacionPrivadaFeedback({pool:db,nota:note,actor:label,actorId:actor.id});
    }
    await db.query('INSERT INTO feedback_browser_operations(actor_user_id,request_id,action,payload_hash,note_id,note_updated_at) VALUES($1,$2,$3,$4,$5,$6::timestamptz)',[observed.id,input.request_id,input.action,hash,id,version]);
    const result={status:input.action==='create'?201:200,body:{version:1,note,operation:operationDto(input,id,version,false)}};
    await db.query('COMMIT');return result;
  }catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}
  finally{db.release(discard);}
}
