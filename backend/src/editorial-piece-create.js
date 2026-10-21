import { createHash } from 'node:crypto';
import { captureEditorialActor, currentEditorialActor } from './editorial-piece-write.js';
import { resolveTaskAssignments, replaceTaskAssignments } from './task-assignments.js';
import { buildAutoTaskProperties } from './piece-task-linking.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { editorialOperationalDto } from './operational-dto.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;

export function normalizeEditorialCreate(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Datos de creación inválidos.');
  const allowed=['request_id','tipo','cliente_id','responsable_id','responsable','fecha_programada','estado','idea','copy','material_referencia','aclaraciones','prioridad'];
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw fail('Campos de creación inválidos.');
  if(!Object.hasOwn(body,'request_id'))throw fail('Falta el identificador del intento de creación.',428);
  if(!uuid(body.request_id))throw fail('El identificador del intento de creación no es válido.');
  if(!['historia','carrusel','video'].includes(body.tipo))throw fail('Tipo de pieza inválido.');
  if(!positive(body.cliente_id)||!positive(body.responsable_id))throw fail('Elegí un cliente y un responsable por ID.');
  if(body.responsable!==undefined&&typeof body.responsable!=='string')throw fail('Etiqueta de responsable inválida.');
  const planned=body.fecha_programada;
  if(typeof planned!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(planned)||planned.startsWith('0000-'))throw fail('Fecha programada inválida.');
  const day=new Date(`${planned}T00:00:00.000Z`);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==planned)throw fail('Fecha programada inválida.');
  if(body.tipo!=='video'&&planned==='0001-01-01')throw fail('La fecha no permite calcular la entrega de diseño.');
  const state=body.estado??'pendiente',priority=body.prioridad??'media';
  if(state==='publicada')throw fail('Registrá la publicación real desde su confirmación editorial.',409);
  if(!['pendiente','en_diseño','en_edición','en_revision','en_revisión','lista','bloqueada'].includes(state))throw fail('Estado editorial inválido.');
  if(!['baja','media','alta'].includes(priority))throw fail('Prioridad inválida.');
  const input={tipo:body.tipo,cliente_id:body.cliente_id,responsable_id:body.responsable_id,fecha_programada:planned,estado:state,prioridad:priority};
  for(const key of ['idea','copy','material_referencia','aclaraciones']) {
    const value=body[key]??'';
    if(typeof value!=='string'||value.includes('\u0000'))throw fail('Texto editorial inválido.');
    input[key]=value;
  }
  if(Buffer.byteLength(JSON.stringify(input),'utf8')>1024*1024)throw fail('La pieza supera el límite de 1 MiB.',413);
  return {requestId:body.request_id.toLowerCase(),input};
}

// Normalizer establishes explicit key order/defaults; labels and request keys
// are not business intent. The recipient's stable ID remains in the hash.
export function editorialCreateHash(input) {
  const keys=['tipo','cliente_id','responsable_id','fecha_programada','estado','prioridad','idea','copy','material_referencia','aclaraciones'];
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(key=>[key,input[key]])))).digest('hex');
}

function dayBefore(value) {
  const day=new Date(`${value}T00:00:00.000Z`);day.setUTCDate(day.getUTCDate()-1);
  return day.toISOString().slice(0,10);
}

async function readCreated(db,user,receipt,replayed) {
  const table=receipt.dominio==='historia'?'historias':'publicaciones';
  const rows=(await db.query(`SELECT p.*, '${receipt.dominio}'::text AS origen,
    ${receipt.dominio==='historia'?"'historia'::text":'p.tipo'} AS tipo,
    to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada
    FROM ${table} p WHERE p.id=$1 FOR SHARE`,[receipt.pieza_id])).rows;
  if(rows.length!==1)throw fail('La pieza de ese intento ya no está disponible. No se volvió a crear.',409);
  // Do not acquire a task row lock after a piece lock: task copy writers use
  // task -> piece. A read verifies identity without reversing that order.
  const task=(await db.query(`SELECT id FROM tareas WHERE id=$1
    AND ${receipt.dominio==='historia'?'historia_id':'publicacion_id'}=$2`,[receipt.tarea_id,receipt.pieza_id])).rows[0];
  if(!task)throw fail('La tarea original ya no está disponible. Revisá ese registro; no se volvió a crear.',409);
  const [row]=await annotateEditorialEvidence(db,receipt.dominio,rows);
  return {...editorialOperationalDto(row,user),creation:{request_id:receipt.request_id,dominio:receipt.dominio,
    pieza_id:receipt.pieza_id,tarea_id:receipt.tarea_id,replayed}};
}

export async function createEditorialPiece(pool,auth,body) {
  const {requestId,input}=normalizeEditorialCreate(body),observed=captureEditorialActor(auth);
  const db=await pool.connect();let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    const user=await currentEditorialActor(db,observed,true);
    const hash=editorialCreateHash(input);
    const prior=(await db.query(`SELECT payload_hash,dominio,pieza_id,tarea_id,request_id
      FROM editorial_create_receipts WHERE actor_user_id=$1 AND request_id=$2`,[user.id,requestId])).rows[0];
    if(prior) {
      if(prior.payload_hash!==hash)throw fail('Ese intento ya se usó con otros datos. Revisá la pieza creada.',409);
      const piece=await readCreated(db,user,prior,true);
      await db.query('COMMIT');return {status:200,piece};
    }
    // Resolve one stable recipient before client or business row locks. Never
    // resolve again after insertion, nor derive authority from this label.
    const assignment=await resolveTaskAssignments(db,{asignado_a_id:input.responsable_id,colaborador_ids:[]});
    const client=(await db.query('SELECT id FROM clientes WHERE id=$1 AND activo IS DISTINCT FROM FALSE FOR SHARE',[input.cliente_id])).rows[0];
    if(!client)throw fail('El cliente no está disponible.',409);
    const domain=input.tipo==='historia'?'historia':'publicacion',table=domain==='historia'?'historias':'publicaciones';
    const values=[input.cliente_id,input.estado,input.fecha_programada,assignment.ownerName,input.idea,input.copy,input.material_referencia,input.aclaraciones,input.prioridad];
    if(domain==='publicacion')values.push(input.tipo);
    const inserted=(await db.query(`INSERT INTO ${table}(cliente_id,estado,fecha_programada,responsable,responsable_diseño,idea,copy,material_referencia,aclaraciones,prioridad${domain==='publicacion'?',tipo':''})
      VALUES($1,$2,$3::date,$4,$4,$5,$6,$7,$8,$9${domain==='publicacion'?',$10':''}) RETURNING id`,values)).rows[0];
    const design=input.tipo!=='video';
    const title=input.tipo==='historia'?`Diseñar historia - ${input.idea||'sin idea'}`
      :design?`Diseñar assets - ${input.idea||'sin idea'}`:`Video - ${input.idea||'por definir'}`;
    const task=(await db.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,requiere_aprobacion,
      propiedades_extra,fecha_vencimiento,historia_id,publicacion_id,tipo_tarea,subtipo,prioridad)
      VALUES($1,$2,$3,'pendiente',false,$4::jsonb,$5::date,$6,$7,$8,$9,'media') RETURNING id`,
    [title,assignment.ownerName,input.cliente_id,JSON.stringify(buildAutoTaskProperties()),
      design?dayBefore(input.fecha_programada):input.fecha_programada,
      domain==='historia'?inserted.id:null,domain==='publicacion'?inserted.id:null,
      design?'diseno':'administracion',design?'diseñar':'video'])).rows[0];
    await replaceTaskAssignments(db,task.id,assignment);
    await db.query(`INSERT INTO editorial_create_receipts(actor_user_id,request_id,payload_hash,dominio,pieza_id,tarea_id)
      VALUES($1,$2,$3,$4,$5,$6)`,[user.id,requestId,hash,domain,inserted.id,task.id]);
    const piece=await readCreated(db,user,{request_id:requestId,dominio:domain,pieza_id:inserted.id,tarea_id:task.id},false);
    await db.query('COMMIT');return {status:201,piece};
  } catch(error) {
    try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}
    throw error;
  } finally {db.release(discard);}
}
