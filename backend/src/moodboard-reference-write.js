import { createHash } from 'node:crypto';
import { buildMoodboardTaskReadPredicate } from './moodboard-task-access.js';
import { createMoodboardImageStorage } from './moodboard-image-storage.js';

const fail=(status,message,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
function actorObservation(auth){
  if(!positive(auth?.id)||!positive(auth?.session_version)||typeof auth?.rol!=='string'||!auth.rol.trim())throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return Object.freeze({id:auth.id,session_version:auth.session_version,rol:auth.rol});
}
function id(value){
  if(positive(value))return value;
  if(typeof value==='string'&&/^[1-9]\d*$/.test(value)&&String(Number(value))===value&&positive(Number(value)))return Number(value);
  throw fail(400,'Identificador de moodboard o referencia inválido.');
}
function noQuery(query){if(!object(query)||Object.keys(query).length)throw fail(400,'No se permiten parámetros de consulta.');}
function storedRevision(value){
  if(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER))return Number(value);
  if(Number.isSafeInteger(value)&&value>=0)return value;
  throw fail(500,'No se pudo verificar la revisión de la referencia.');
}
function text(value){if(typeof value!=='string'||value.includes('\u0000'))throw fail(400,'Los campos de referencia deben ser texto válido.');return value;}
function tags(value){if(!Array.isArray(value)||value.length>50||value.some(item=>typeof item!=='string'||item.includes('\u0000')||Array.from(item.trim()).length>100))throw fail(400,'Usá hasta 50 etiquetas de 100 caracteres.');return [...new Set(value.map(item=>item.trim()).filter(Boolean))];}
function external(value){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))throw fail(400,'Ingresá un enlace HTTP o HTTPS absoluto sin credenciales.');
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return{url:value,kind:url.hostname==='pin.it'||url.hostname==='pinterest.com'||url.hostname.endsWith('.pinterest.com')?'pinterest':'enlace'};}
  catch{throw fail(400,'Ingresá un enlace HTTP o HTTPS absoluto sin credenciales.');}
}
function image(value){
  const match=typeof value==='string'&&/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)throw fail(400,'Usá una imagen JPG o PNG de hasta 10 MB.');
  const buffer=Buffer.from(match[2],'base64');
  if(!buffer.length||buffer.length>10*1024*1024||buffer.toString('base64')!==match[2])throw fail(400,'Usá una imagen JPG o PNG de hasta 10 MB.');
  const signature=match[1]==='png'?Buffer.from([137,80,78,71,13,10,26,10]):Buffer.from([255,216,255]);
  if(buffer.length<signature.length||!buffer.subarray(0,signature.length).equals(signature))throw fail(400,'La firma de la imagen no coincide con JPG o PNG.');
  return{buffer,extension:match[1]==='jpeg'?'jpg':'png',digest:sha(buffer)};
}
export function normalizeMoodboardReferenceOperation(body){
  if(!object(body))throw fail(400,'Operación de referencia inválida.');
  if(!own(body,'request_id'))throw fail(428,'Falta la clave de la operación.','MOODBOARD_REFERENCE_REQUEST_REQUIRED');
  if(typeof body.request_id!=='string'||body.request_id.length!==36||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.request_id))throw fail(400,'Clave de operación inválida.');
  if(Object.keys(body).some(key=>!['request_id','action','board_id','reference_id','expected_revision','fields'].includes(key))
    ||!['create','edit','delete'].includes(body.action)||!positive(body.board_id))throw fail(400,'Operación o moodboard inválidos.');
  const input={request_id:body.request_id.toLowerCase(),action:body.action,board_id:body.board_id};
  if(body.action==='create'){
    if(own(body,'reference_id')||own(body,'expected_revision'))throw fail(400,'La creación no admite una referencia previa.');
  }else{
    if(!own(body,'reference_id')||!own(body,'expected_revision'))throw fail(428,'Falta la referencia y su revisión observada.','MOODBOARD_REFERENCE_REVISION_REQUIRED');
    if(!positive(body.reference_id)||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw fail(400,'Referencia o revisión inválida.');
    input.reference_id=body.reference_id;input.expected_revision=body.expected_revision;
  }
  if(body.action==='delete'){if(own(body,'fields'))throw fail(400,'El borrado no admite campos de contenido.');return Object.freeze(input);}
  const create=body.action==='create',allowed=create?['title','note','category_id','tags','external_url','image_data']:['title','note','category_id','tags','status'];
  if(!object(body.fields)||Object.keys(body.fields).some(key=>!allowed.includes(key))||!create&&!Object.keys(body.fields).length)throw fail(400,'Campos de referencia inválidos.');
  const fields={};
  if(create||own(body.fields,'title'))fields.title=own(body.fields,'title')?text(body.fields.title).trim():(create?'Referencia sin título':'');
  if(create&&!fields.title)fields.title='Referencia sin título';
  if(fields.title!==undefined&&Array.from(fields.title).length>200)throw fail(400,'El título admite hasta 200 caracteres.');
  if(create||own(body.fields,'note')){fields.note=text(body.fields.note).trim();if(!fields.note)throw fail(400,'La nota es obligatoria.');}
  if(fields.note!==undefined&&Array.from(fields.note).length>20000)throw fail(400,'La nota admite hasta 20000 caracteres.');
  if(create||own(body.fields,'category_id')){
    if(!positive(body.fields.category_id)&&(!(!create&&body.fields.category_id===null)))throw fail(400,'Elegí una categoría válida.');
    fields.category_id=body.fields.category_id;
  }
  if(create||own(body.fields,'tags'))fields.tags=Object.freeze(tags(body.fields.tags??(create&&!own(body.fields,'tags')?[]:null)));
  if(own(body.fields,'status')){if(!['libre','aprobada','descartada'].includes(body.fields.status))throw fail(400,'Estado visual inválido.');fields.status=body.fields.status;}
  if(create){
    const hasImage=body.fields.image_data!==undefined&&body.fields.image_data!==null&&body.fields.image_data!=='';
    const url=body.fields.external_url??'';
    if(hasImage){if(url!=='')throw fail(400,'Elegí una imagen o un enlace, no ambos.');input.image=image(body.fields.image_data);fields.source='imagen';fields.external_url=null;}
    else{const source=external(text(url).trim());fields.source=source.kind;fields.external_url=source.url;}
  }
  input.fields=Object.freeze(fields);return Object.freeze(input);
}
async function currentActor(db,observed,write){
  const actor=(await db.query(`SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1${write?' FOR SHARE':''}`,[observed.id])).rows[0];
  if(!actor||actor.id!==observed.id||actor.activo!==true||actor.session_version!==observed.session_version||actor.rol!==observed.rol)throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return actor;
}
function timestamp(value){
  if(typeof value!=='string'||value.length!==27||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
    ||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw fail(500,'No se pudo verificar la fecha de la referencia.');return value;
}
function referenceDto(row){
  if(!positive(row?.id)||!positive(row.board_id)||row.category_id!==null&&!positive(row.category_id)||row.autor_id!==null&&!positive(row.autor_id)
    ||row.titulo!==null&&typeof row.titulo!=='string'||typeof row.nota!=='string'||!Array.isArray(row.etiquetas)||row.etiquetas.some(tag=>typeof tag!=='string')
    ||!['libre','aprobada','descartada'].includes(row.estado)||!['imagen','enlace','pinterest'].includes(row.tipo_fuente)
    ||['enlace_externo','archivo_nombre','categoria'].some(key=>row[key]!==null&&typeof row[key]!=='string')||typeof row.autor_nombre!=='string'||!Array.isArray(row.tareas))throw fail(500,'No se pudo verificar la referencia.');
  const seen=new Set(),tareas=row.tareas.map(task=>{if(!positive(task?.id)||typeof task.titulo!=='string'||seen.has(task.id))throw fail(500,'No se pudieron verificar los vínculos visibles.');seen.add(task.id);return{id:task.id,titulo:task.titulo};});
  return{id:row.id,board_id:row.board_id,category_id:row.category_id,titulo:row.titulo,nota:row.nota,etiquetas:[...row.etiquetas],estado:row.estado,tipo_fuente:row.tipo_fuente,enlace_externo:row.enlace_externo,archivo_nombre:row.archivo_nombre,autor_id:row.autor_id,autor_nombre:row.autor_nombre,created_at:timestamp(row.created_at),updated_at:timestamp(row.updated_at),categoria:row.categoria,tareas,revision:storedRevision(row.revision)};
}
async function references(db,actor,selector,value){
  const predicate=buildMoodboardTaskReadPredicate(actor,'t','$2');
  const rows=(await db.query(`SELECT r.id,r.board_id,r.category_id,r.titulo,r.nota,r.etiquetas,r.estado,r.tipo_fuente,r.enlace_externo,r.archivo_nombre,r.autor_id,r.autor_nombre,
    to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
    to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,r.revision,c.nombre AS categoria,
    COALESCE((SELECT json_agg(json_build_object('id',t.id,'titulo',t.titulo) ORDER BY t.id)
      FROM moodboard_reference_tasks rt JOIN tareas t ON t.id=rt.tarea_id AND ${predicate.sql}
      WHERE rt.reference_id=r.id AND EXISTS(SELECT 1 FROM moodboard_board_clients bc WHERE bc.board_id=r.board_id AND bc.cliente_id=t.cliente_id)),'[]') AS tareas
    FROM moodboard_references r LEFT JOIN moodboard_categories c ON c.id=r.category_id AND c.board_id=r.board_id
    WHERE ${selector==='board'?'r.board_id':'r.id'}=$1
    ORDER BY CASE r.estado WHEN 'aprobada' THEN 0 WHEN 'libre' THEN 1 ELSE 2 END,r.created_at DESC,r.id DESC`,predicate.value===null?[value]:[value,predicate.value])).rows;
  return rows.map(referenceDto);
}
async function readTransaction(pool,observed,read){
  const db=await pool.connect();let discard;
  try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const actor=await currentActor(db,observed,false);const result=await read(db,actor);await db.query('COMMIT');return result;}
  catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}finally{db.release(discard);}
}
export async function readMoodboardReferences(pool,auth,rawBoardId,query={}){
  const observed=actorObservation(auth),board=id(rawBoardId);noQuery(query);
  return readTransaction(pool,observed,async(db,actor)=>{if(!(await db.query('SELECT id FROM moodboard_boards WHERE id=$1',[board])).rows[0])throw fail(404,'Moodboard no encontrado.');return references(db,actor,'board',board);});
}
export async function readMoodboardReference(pool,auth,rawId,query={}){
  const observed=actorObservation(auth),reference=id(rawId);noQuery(query);
  return readTransaction(pool,observed,async(db,actor)=>{const result=(await references(db,actor,'reference',reference))[0];if(!result)throw fail(404,'Referencia no encontrada.');return result;});
}
function operation(input,referenceId,resultRevision,replayed){return{request_id:input.request_id,action:input.action,reference_id:referenceId,result_revision:storedRevision(resultRevision),replayed};}

export async function applyMoodboardReferenceOperation(pool,auth,body,{uploadDir,storage}={},query={}){
  const observed=actorObservation(auth);noQuery(query);const input=normalizeMoodboardReferenceOperation(body);
  const hash=sha(stable({contract:'moodboard-reference-operation-v1',action:input.action,board_id:input.board_id,reference_id:input.reference_id??null,expected_revision:input.expected_revision??null,fields:input.fields??null,image:input.image?{extension:input.image.extension,digest:input.image.digest}:null}));
  const db=await pool.connect();let discard,prepared=null,store=storage,commitAttempted=false,cleanupDeleted=null;
  try{
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query('SELECT pg_advisory_xact_lock(20261019,1)');
    const actor=await currentActor(db,observed,true);
    const receipt=(await db.query('SELECT action,payload_hash,board_id,reference_id,result_revision FROM moodboard_reference_operations WHERE actor_user_id=$1 AND request_id=$2',[observed.id,input.request_id])).rows[0];
    if(receipt&&(receipt.action!==input.action||receipt.payload_hash!==hash||receipt.board_id!==input.board_id))throw fail(409,'La clave ya corresponde a otra operación.','MOODBOARD_REFERENCE_REPLAY_MISMATCH');
    if(!(await db.query('SELECT id FROM moodboard_boards WHERE id=$1 FOR NO KEY UPDATE',[input.board_id])).rows[0])throw fail(404,'Moodboard no encontrado.');
    if(receipt){
      const referenceId=id(receipt.reference_id);
      await db.query('SELECT id FROM moodboard_references WHERE id=$1 AND board_id=$2 FOR UPDATE',[referenceId,input.board_id]);
      const reference=(await references(db,actor,'reference',referenceId))[0]??null;
      if(reference&&reference.board_id!==input.board_id)throw fail(409,'La referencia cambió de moodboard.');
      const result={status:200,body:{version:1,reference,operation:operation(input,referenceId,receipt.result_revision,true)}};
      commitAttempted=true;await db.query('COMMIT');return result;
    }
    let referenceId=input.reference_id,resultRevision,current;
    if(input.action!=='create'){
      current=(await db.query('SELECT id,board_id,category_id,archivo_nombre,revision FROM moodboard_references WHERE id=$1 FOR UPDATE',[referenceId])).rows[0];
      if(!current||current.board_id!==input.board_id)throw fail(404,'Referencia no encontrada en este moodboard.');
      resultRevision=storedRevision(current.revision);
      if(resultRevision!==input.expected_revision)throw fail(409,'La referencia cambió. Conservá el borrador y volvé a revisarla.','MOODBOARD_REFERENCE_REVISION_CONFLICT');
    }
    if(input.action==='create'||input.action==='edit'&&own(input.fields,'category_id')){
      const category=input.fields.category_id;
      if(category!==null&&!(await db.query('SELECT id FROM moodboard_categories WHERE id=$1 AND board_id=$2 FOR KEY SHARE',[category,input.board_id])).rows[0])throw fail(409,'La categoría no pertenece a este moodboard.','MOODBOARD_REFERENCE_CATEGORY_CONFLICT');
    }
    if(input.action==='create'){
      if(input.image){
        store??=createMoodboardImageStorage(uploadDir);
        const value=await store.prepare({actorId:observed.id,requestId:input.request_id,image:{buffer:input.image.buffer,extension:input.image.extension}});
        if(typeof value?.filename!=='string'||!/^[0-9a-f]{64}\.(jpg|png)$/.test(value.filename)||typeof value.created!=='boolean')throw fail(500,'No se pudo verificar el archivo preparado.');
        prepared=value;
      }
      const saved=(await db.query(`INSERT INTO moodboard_references(board_id,category_id,titulo,nota,etiquetas,estado,tipo_fuente,enlace_externo,archivo_nombre,autor_id,autor_nombre)
        VALUES($1,$2,$3,$4,$5,'libre',$6,$7,$8,$9,$10) RETURNING id`,[input.board_id,input.fields.category_id,input.fields.title,input.fields.note,input.fields.tags,input.fields.source,input.fields.external_url,prepared?.filename??null,observed.id,actor.nombre||actor.usuario||'Equipo RENDER'])).rows[0];
      if(!positive(saved?.id))throw fail(500,'No se pudo verificar la referencia creada.');referenceId=saved.id;
    }else if(input.action==='edit'){
      const columns={title:'titulo',note:'nota',category_id:'category_id',tags:'etiquetas',status:'estado'},params=[],sets=[];
      for(const [key,value] of Object.entries(input.fields)){params.push(value);sets.push(`${columns[key]}=$${params.length}`);}
      params.push(referenceId);await db.query(`UPDATE moodboard_references SET ${sets.join(',')},updated_at=clock_timestamp() WHERE id=$${params.length}`,params);
    }else{
      if(current.archivo_nombre&&(storage||uploadDir)){
        const other=await db.query('SELECT id FROM moodboard_references WHERE archivo_nombre=$1 AND id<>$2 LIMIT 1',[current.archivo_nombre,referenceId]);
        if(!other.rows.length){store??=createMoodboardImageStorage(uploadDir);cleanupDeleted=current.archivo_nombre;}
      }
      await db.query('DELETE FROM moodboard_references WHERE id=$1',[referenceId]);
    }
    const reference=(await references(db,actor,'reference',referenceId))[0]??null;
    if(input.action==='delete'?reference!==null:reference===null||reference.board_id!==input.board_id)throw fail(500,'No se pudo verificar el resultado de la operación.');
    if(reference){resultRevision=reference.revision;if(input.action==='edit'&&resultRevision!==input.expected_revision+1)throw fail(500,'No se pudo verificar la revisión guardada.');}
    await db.query('INSERT INTO moodboard_reference_operations(actor_user_id,request_id,action,payload_hash,board_id,reference_id,result_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[observed.id,input.request_id,input.action,hash,input.board_id,referenceId,resultRevision]);
    const result={status:input.action==='create'?201:200,body:{version:1,reference,operation:operation(input,referenceId,resultRevision,false)}};
    commitAttempted=true;await db.query('COMMIT');
    if(cleanupDeleted)try{await store.remove(cleanupDeleted);}catch{/* Confirmed DB deletion remains confirmed; cleanup is best effort. */}
    return result;
  }catch(error){
    let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch(rollback){discard=rollback;}
    if(rolledBack&&!commitAttempted&&prepared?.created===true)try{await store.remove(prepared.filename);}catch{/* Retain an orphan, never delete an existing or ambiguous asset. */}
    if(commitAttempted)throw fail(503,'No se pudo confirmar el resultado. Verificá el mismo intento con su clave original.','MOODBOARD_REFERENCE_COMMIT_UNCERTAIN');
    if(['23503','23505','40P01','40001'].includes(error.code))throw fail(409,'La referencia o su categoría cambió. Volvé a leer el moodboard.','MOODBOARD_REFERENCE_CONFLICT');
    throw error;
  }finally{db.release(discard);}
}
