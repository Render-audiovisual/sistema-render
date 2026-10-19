import crypto from 'node:crypto';
import { feedbackIdempotencyKey } from './feedback-receipts.js';
import { isValidProductionDate } from './production-visits.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const own=(value,key)=>Object.hasOwn(value,key);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')}}`:JSON.stringify(value);
const hash=value=>crypto.createHash('sha256').update(stable(value)).digest('hex');
export const TASK_RECEIPT_OPERATIONS=['crear','editar','archivar','eliminar'];
export const taskOperationKey=feedbackIdempotencyKey;
const text=value=>{if(typeof value!=='string'||value.includes('\u0000')||value.length>20000)throw fail('Texto de tarea inválido.');return value.trim();};

export function canonicalTaskOperationIntent(input,{operation,targetId=null}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||!TASK_RECEIPT_OPERATIONS.includes(operation)
    ||(operation==='crear'?targetId!==null:!positive(targetId)))throw fail('Operación de tarea inválida.');
  const writable=['crear','editar'].includes(operation);
  const aliases={vencimiento:'fecha_vencimiento',lista:'sector',tipo_tarea:'sector',aclaraciones:'descripcion',material_referencia:'material',responsable:'asignado_a'};
  const fields=['titulo','cliente','cliente_id','asignado_a','asignado_a_id','colaboradores','colaborador_ids','responsables',
    'fecha_vencimiento','sector','subtipo','prioridad','descripcion','material','referencia','produccion_videos_previstos',...(operation==='editar'?['append_descripcion']:[])];
  const allowed=[...(writable?[...fields,...Object.keys(aliases),'permitir_duplicado']:[]),
    'idempotency_key','confirmacion_token','confirmado','confirmado_en','telegram_user_id',...(operation!=='crear'?['expected_revision']:[])];
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw fail('Campos de tarea no permitidos; estado y aprobación se gestionan por su flujo.');
  const business={};
  function normalize(key,value) {
    if(['cliente_id','asignado_a_id'].includes(key)){if(!positive(value))throw fail('Selección por ID inválida.');return value;}
    if(['colaboradores','responsables','colaborador_ids'].includes(key)) {
      if(!Array.isArray(value)||value.length>100)throw fail('Lista de responsables inválida.');
      const values=value.map(item=>key==='colaborador_ids'?(positive(item)?item:(()=>{throw fail('ID de colaborador inválido.');})()):text(item));
      if(values.some(item=>item===''))throw fail('Responsable vacío.');return [...new Set(values)];
    }
    if(key==='produccion_videos_previstos'){if(value!==null&&!positive(value))throw fail('Videos previstos inválidos.');return value;}
    if(key==='fecha_vencimiento'){if(value===null||value==='')return null;if(typeof value!=='string'||!isValidProductionDate(value))throw fail('Fecha inválida.');return value;}
    if(['subtipo','material','referencia','descripcion'].includes(key)&&value===null)return null;
    const result=text(value);
    if(key==='sector') {
      const normalized=result.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
      const sector=normalized==='comunidad'?'community':normalized;
      if(!['diseno','edicion','produccion','community','administracion'].includes(sector))throw fail('Sector inválido.');return sector;
    }
    if(key==='prioridad'){const priority=result.toLowerCase();if(!['baja','media','alta'].includes(priority))throw fail('Prioridad inválida.');return priority;}
    return result;
  }
  for(const [raw,value] of Object.entries(input))if(fields.includes(raw)||own(aliases,raw)) {
    const key=aliases[raw]??raw,normalized=normalize(key,value);
    if(own(business,key)&&stable(business[key])!==stable(normalized))throw fail('Aliases de tarea contradictorios.');business[key]=normalized;
  }
  if(own(business,'responsables')) {
    const [owner,...collaborators]=business.responsables;
    if(!owner)throw fail('Elegí al menos un responsable.');
    for(const [key,value] of [['asignado_a',owner],['colaboradores',collaborators]]) {
      if(own(business,key)&&stable(business[key])!==stable(value))throw fail('Listas de responsables contradictorias.');business[key]=value;
    }
    delete business.responsables;
  }
  for(const [id,label] of [['cliente_id','cliente'],['asignado_a_id','asignado_a'],['colaborador_ids','colaboradores']])if(own(business,id)&&own(business,label)) {
    if((Array.isArray(business[label])?business[label].length:business[label]))throw fail('Elegí IDs o etiquetas, no ambos.');delete business[label];
  }
  if(own(business,'append_descripcion')&&own(business,'descripcion'))throw fail('Elegí append_descripcion o descripcion, no ambos.');
  if(own(input,'permitir_duplicado')&&typeof input.permitir_duplicado!=='boolean')throw fail('permitir_duplicado debe ser booleano.');
  const intent={version:1,operation,target_id:targetId,business,permitir_duplicado:input.permitir_duplicado===true};
  if(operation!=='crear'){if(!positive(input.expected_revision))throw fail('Falta expected_revision positivo.');intent.expected_revision=input.expected_revision;}
  if(operation==='editar'&&!Object.keys(business).length)throw fail('No se enviaron cambios.');
  return intent;
}

export const taskOperationIntentHash=intent=>hash({contract:'task-operation-intent-v1',intent});
export function taskOperationConfirmationHash({intent,userId,key,selections={}}) {
  if(!positive(userId))throw fail('Identidad inválida.',403);
  return hash({contract:'task-operation-confirmation-v1',actor_user_id:userId,key,intent,selections});
}
export const taskOperationEventKey=({userId,operation,key,payloadHash})=>hash({contract:'task-operation-event-v1',userId,operation,key,payloadHash});
export const taskOperationReceiptDto=row=>Object.fromEntries(['operation','task_id','task_revision','outcome','changed_fields','committed_at'].map(key=>[key,row[key]]));

/** Caller holds the global objective-link advisory. Discover before task locks;
 * never discover and acquire another existing task after a visit/video lock. */
export async function lockTaskOperationResources(db,taskId) {
  async function discover() {
    const task=(await db.query('SELECT id,publicacion_id FROM tareas WHERE id=$1',[taskId])).rows[0];
    const slots=(await db.query(`SELECT s.id,s.tarea_id,s.publicacion_id,o.clave,to_char(o.periodo,'YYYY-MM') periodo
      FROM cliente_objetivo_piezas s JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id
      WHERE s.tarea_id=$1 OR s.publicacion_id=$2 ORDER BY s.id`,[taskId,task?.publicacion_id??null])).rows;
    const visits=(await db.query(`SELECT v.id,v.tarea_origen_id FROM produccion_visitas v WHERE v.tarea_origen_id=$1
      OR EXISTS(SELECT 1 FROM produccion_videos pv WHERE pv.visita_id=v.id AND (pv.tarea_entrega_id=$1 OR pv.tarea_edicion_id=$1)) ORDER BY v.id`,[taskId])).rows;
    const videos=visits.length?(await db.query('SELECT id,visita_id FROM produccion_videos WHERE visita_id=ANY($1::uuid[]) ORDER BY id',[visits.map(row=>row.id)])).rows:[];
    return{task:task??null,slots,visits,videos};
  }
  const before=await discover();
  const keys=[...new Set(before.slots.map(row=>`objetivo:${row.periodo}:${row.clave}`))].sort();
  for(const key of keys)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  const taskIds=[...new Set([taskId,...before.slots.map(row=>row.tarea_id),...before.visits.map(row=>row.tarea_origen_id)].filter(positive))].sort((a,b)=>a-b);
  await db.query('SELECT id FROM tareas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[taskIds]);
  const publicationIds=[...new Set([before.task?.publicacion_id,...before.slots.map(row=>row.publicacion_id)].filter(positive))].sort((a,b)=>a-b);
  if(publicationIds.length)await db.query('SELECT id FROM publicaciones WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[publicationIds]);
  if(before.slots.length)await db.query('SELECT id FROM cliente_objetivo_piezas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[before.slots.map(row=>row.id)]);
  if(before.visits.length)await db.query('SELECT id FROM produccion_visitas WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[before.visits.map(row=>row.id)]);
  if(before.videos.length)await db.query('SELECT id FROM produccion_videos WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[before.videos.map(row=>row.id)]);
  if(stable(before)!==stable(await discover()))throw fail('Los vínculos de la tarea cambiaron. Recargá antes de confirmar.',409);
}

export async function findTaskOperationReceipt(db,{userId,operation,key,payloadHash}) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['task-operation-receipt-v1',userId,operation,key])]);
  const receipt=(await db.query(`SELECT operation,task_id,task_revision,outcome,changed_fields,committed_at,payload_hash
    FROM task_operation_receipts WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3`,[userId,operation,key])).rows[0];
  if(receipt&&receipt.payload_hash!==payloadHash)throw fail('Esta clave ya confirmó otra intención de tarea.',409);
  return receipt??null;
}
export async function insertTaskOperationReceipt(db,{userId,operation,key,payloadHash,task,outcome,changedFields=[]}) {
  return (await db.query(`INSERT INTO task_operation_receipts(actor_user_id,operation,idempotency_key,payload_hash,task_id,task_revision,outcome,changed_fields)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[]) RETURNING operation,task_id,task_revision,outcome,changed_fields,committed_at`,
  [userId,operation,key,payloadHash,task.id,task.revision,outcome,changedFields])).rows[0];
}
export async function consumeTaskOperationConfirmation(db,req,intent,key,selections={}) {
  const token=req.body?.confirmacion_token;
  if(typeof token!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token))throw fail('Falta confirmación exacta de tarea.');
  const params=[token,req.wilson.channel,req.wilson.actorId,req.wilson.groupId||'',intent.operation,intent.target_id,
    taskOperationConfirmationHash({intent,userId:req.wilson.userId,key,selections})];
  const locked=await db.query(`SELECT token FROM integracion_confirmaciones WHERE token=$1 AND integracion='wilson'
    AND canal=$2 AND actor_id=$3 AND grupo_id=$4 AND operacion=$5 AND tarea_id IS NOT DISTINCT FROM $6::integer AND payload_hash=$7 FOR UPDATE`,params);
  if(!locked.rows.length)throw fail('La confirmación ya no coincide con esta intención o sus selecciones. Renovála.',409);
  const result=await db.query(`UPDATE integracion_confirmaciones SET used_at=clock_timestamp() WHERE token=$1 AND integracion='wilson'
    AND canal=$2 AND actor_id=$3 AND grupo_id=$4 AND operacion=$5 AND tarea_id IS NOT DISTINCT FROM $6::integer AND payload_hash=$7
    AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING token`,params);
  if(!result.rows.length)throw fail('La confirmación fue usada o venció. Renovála.',409);
}
