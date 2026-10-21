import { createHash, randomUUID } from 'node:crypto';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const uuid=n=>typeof n==='string'&&n.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(n);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function projectDeliverableContentHash(value) {
  if (!value || !['titulo','url','observaciones'].every(key=>typeof value[key]==='string')) throw fail('Contenido de entregable no verificable.',409);
  return hash({titulo:value.titulo,url:value.url,observaciones:value.observaciones});
}
export function normalizeProjectDeliverableApprovalInput(body) {
  const keys=['request_id','expected_revision','expected_entregable_revision','expected_content_revision','expected_content_hash'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length||Object.keys(body).some(key=>!keys.includes(key))
    ||!uuid(body.request_id)||!['expected_revision','expected_entregable_revision','expected_content_revision'].every(key=>positive(body[key]))
    ||typeof body.expected_content_hash!=='string'||body.expected_content_hash.length!==64||!/^[a-f0-9]{64}$/.test(body.expected_content_hash))throw fail('Revisá la versión observada del entregable.');
  return Object.fromEntries(keys.map(key=>[key,key==='request_id'?body[key].toLowerCase():body[key]]));
}

export const PROJECT_DELIVERABLE_READ_SQL=`SELECT d.id,d.titulo,d.url,d.observaciones,d.estado,d.aprobado_por_id,d.aprobado_at,
  d.contenido_revision,d.entregable_revision,d.aprobacion_actual_id,a.contenido_hash approval_hash,
  (d.estado='aprobado' AND a.id IS NOT NULL AND a.proyecto_id=d.proyecto_id AND a.entregable_id=d.id
    AND a.contenido_revision=d.contenido_revision AND a.entregable_revision=d.entregable_revision
    AND a.titulo=d.titulo AND a.url=d.url AND a.observaciones=d.observaciones
    AND a.actor_id=d.aprobado_por_id AND a.aprobado_at=d.aprobado_at) current_proof
  FROM proyecto_entregables d LEFT JOIN proyecto_entregable_aprobaciones a ON a.id=d.aprobacion_actual_id`;
export function projectDeliverableDto(row) {
  if(!positive(row.contenido_revision)||!positive(row.entregable_revision))throw fail('No se pudo verificar la versión del entregable.',409);
  const contenido_hash=projectDeliverableContentHash(row);
  return {...Object.fromEntries(['id','titulo','url','observaciones','estado','aprobado_por_id','aprobado_at','contenido_revision','entregable_revision','aprobacion_actual_id'].map(key=>[key,row[key]??null])),
    contenido_hash,aprobacion_versionada:row.estado==='aprobado'&&uuid(row.aprobacion_actual_id)
      &&row.current_proof===true&&row.approval_hash===contenido_hash};
}
export function projectDeliverableApprovalDto(row) {
  return {id:row.id,entregable_id:row.entregable_id,contenido_revision:row.contenido_revision,entregable_revision:row.entregable_revision,
    contenido_hash:row.contenido_hash,actor_id:row.actor_id,aprobado_at:row.aprobado_at};
}

// Caller owns the current actor SHARE and READ COMMITTED transaction. Replay
// observes current structural authority but never reapplies historical approval.
export async function approveProjectDeliverable(db,{projectId,deliverableId,input,user},deps) {
  const normalized=normalizeProjectDeliverableApprovalInput(input);
  if(!uuid(projectId)||!uuid(deliverableId))throw fail('Proyecto o entregable inválido.');
  const id=projectId.toLowerCase(),child=deliverableId.toLowerCase();
  const payloadHash=hash({projectId:id,deliverableId:child,...normalized,request_id:undefined});
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['project-deliverable-approval-v1',user.id,normalized.request_id])]);
  await deps.lockProjectLinks(db);
  // null skips only CAS, never current responsible/admin/archive authorization.
  const project=await deps.lockProject(db,id,null,user);
  const receipt=(await db.query('SELECT * FROM proyecto_entregable_aprobaciones WHERE actor_id=$1 AND request_id=$2',[user.id,normalized.request_id])).rows[0];
  if(receipt){
    if(receipt.payload_hash!==payloadHash||receipt.proyecto_id!==id||receipt.entregable_id!==child)throw fail('La solicitud ya se utilizó con otros datos.',409);
    return{status:200,body:{proyecto:await deps.readProjectDetail(db,id,user),aprobacion:projectDeliverableApprovalDto(receipt),replayed:true}};
  }
  if(project.revision!==normalized.expected_revision)throw fail('El proyecto cambió. Actualizá antes de aprobar.',409);
  const deliverable=(await db.query(`SELECT id,proyecto_id,titulo,url,observaciones,estado,contenido_revision,entregable_revision
    FROM proyecto_entregables WHERE proyecto_id=$1 AND id=$2 FOR UPDATE`,[id,child])).rows[0];
  if(!deliverable)throw fail('Entregable no encontrado.',404);
  const contentHash=projectDeliverableContentHash(deliverable);
  if(deliverable.contenido_revision!==normalized.expected_content_revision||deliverable.entregable_revision!==normalized.expected_entregable_revision
    ||contentHash!==normalized.expected_content_hash)throw fail('El entregable cambió. Revisá su contenido antes de aprobar.',409);
  if(deliverable.entregable_revision===2147483647)throw fail('No se puede avanzar la versión del entregable.',409);
  const receiptId=randomUUID();
  const saved=(await db.query(`INSERT INTO proyecto_entregable_aprobaciones
    (id,proyecto_id,entregable_id,actor_id,request_id,payload_hash,observed_project_revision,observed_entregable_revision,
      contenido_revision,entregable_revision,contenido_hash,titulo,url,observaciones)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
  [receiptId,id,child,user.id,normalized.request_id,payloadHash,project.revision,deliverable.entregable_revision,
    deliverable.contenido_revision,deliverable.entregable_revision+1,contentHash,deliverable.titulo,deliverable.url,deliverable.observaciones])).rows[0];
  await db.query(`UPDATE proyecto_entregables SET estado='aprobado',aprobacion_actual_id=$3,aprobado_por_id=$4,
    aprobado_at=(SELECT aprobado_at FROM proyecto_entregable_aprobaciones WHERE id=$3)
    WHERE proyecto_id=$1 AND id=$2`,[id,child,receiptId,user.id]);
  await deps.bump(db,id,project.revision,user);
  await deps.activity(db,id,user,'editar_entregable',child,deliverable.estado,'aprobado');
  return{status:201,body:{proyecto:await deps.readProjectDetail(db,id,user),aprobacion:projectDeliverableApprovalDto(saved),replayed:false}};
}
