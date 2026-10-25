import {createHash} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const uuid=value=>typeof value==='string'&&value.length===36&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
// Internal input is the complete validated create contract, not derived labels,
// timestamps or raw HTTP. Preserve array order: the caller must normalize sets.
function canonical(value,depth=0){
  if(depth>30)throw fail('El intento de creación es demasiado complejo.');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value)){
    if(value.length>1000)throw fail('El intento de creación es demasiado grande.');
    return '['+Array.from(value,item=>canonical(item,depth+1)).join(',')+']';
  }
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
  }
  throw fail('El intento de creación no es válido.');
}
export function captureTaskCreateReceipt(input){
  if(!input||!uuid(input.requestId)||!input.intent||Array.isArray(input.intent)
    ||Object.getPrototypeOf(input.intent)!==Object.prototype||input.intent.workspace!=='render_os')throw fail('El intento de creación no es válido.');
  const json=canonical(input.intent);
  if(Buffer.byteLength(json)>200000)throw fail('El intento de creación es demasiado grande.');
  return Object.freeze({requestId:input.requestId.toLowerCase(),
    payloadHash:createHash('sha256').update('render-task-create-v1\n'+json).digest('hex')});
}
// Caller owns transaction and retains current actor authority before this lock.
export async function beginTaskCreateReceipt(db,capture,actorId){
  if(!positive(actorId))throw fail('Identidad de creación inválida.',401);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify(['render-task-create-v1',actorId,capture.requestId])]);
  const receipt=(await db.query(`SELECT task_id,task_revision,payload_hash FROM task_create_receipts
    WHERE actor_user_id=$1 AND request_id=$2`,[actorId,capture.requestId])).rows[0];
  if(receipt&&receipt.payload_hash!==capture.payloadHash)throw fail('Ese intento de creación ya se usó con otros datos.',409);
  return receipt??null;
}
export async function readTaskCreateReceiptTask(db,receipt){
  if(!positive(receipt?.task_id))throw fail('La tarea guardada no está disponible.',404);
  // This opt-in contract is only shared RENDER OS. A tombstone, deleted row or
  // a task moved out of that workspace never becomes an automatic new insert.
  const row=(await db.query(`SELECT t.*,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento
    FROM tareas t WHERE t.id=$1 AND t.propiedades_extra->>'workspace'='render_os'
    AND coalesce(t.propiedades_extra->>'papelera_render_os','false')<>'true' FOR SHARE`,[receipt.task_id])).rows[0];
  if(!row)throw fail('La tarea guardada no está disponible.',404);
  return row;
}
export async function recordTaskCreateReceipt(db,capture,actorId,task){
  const revision=task?.revision;
  const revisionType=typeof revision==='number'||(typeof revision==='string'&&/^[1-9]\d*$/.test(revision));
  if(!positive(actorId)||!positive(task?.id)||!revisionType||!Number.isSafeInteger(Number(revision))||Number(revision)<1)
    throw fail('La creación no devolvió una tarea verificable.',409);
  await db.query(`INSERT INTO task_create_receipts(actor_user_id,request_id,payload_hash,task_id,task_revision)
    VALUES($1,$2,$3,$4,$5)`,[actorId,capture.requestId,capture.payloadHash,task.id,task.revision]);
}
