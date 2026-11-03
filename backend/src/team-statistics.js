import {SYSTEM_USER_ROLES} from './user-roles.js';
const people=[{id:10,role:'produccion',name:'Germán',label:'Videos grabados'},{id:9,role:'edicion',name:'Luciano',label:'Videos editados y entregados'},{id:8,role:'diseno',name:'Augusto',label:'Carruseles entregados'}];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Cordoba',year:'numeric',month:'2-digit',day:'2-digit'});
function date(value){
 if(typeof value!=='string')return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:null;}
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))
   ||!date(value.slice(0,10))||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return null;
 return day.format(new Date(value));
}
// Legacy dates alone are not evidence: the old trigger fell back to updated_at.
// Require the review event for the same task, local day and timestamp (1s tolerance).
// This recovers a recorded review delivery, never approval or publication.
export function recoverHistoricalEditingCandidates(rows){
 return rows.flatMap(row=>{
  const auditId=typeof row.audit_id==='string'&&/^[1-9]\d*$/.test(row.audit_id)?Number(row.audit_id):row.audit_id;
  if(!Number.isSafeInteger(row.task_id)||row.task_id<=0||!Number.isSafeInteger(auditId)||auditId<=0)return [];
  const match=typeof row.event_id==='string'&&row.event_id.match(/^(\d+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):tarea_en_revision$/);
  if(!match||Number(match[1])!==row.task_id||!date(match[2])||date(row.legacy_at)!==date(match[2])
    ||Math.abs(Date.parse(row.legacy_at)-Date.parse(match[2]))>1000
    ||!date(row.audit_at)||Date.parse(row.audit_at)<Date.parse(match[2]))return [];
  return [{person_id:9,key:row.key,task_id:row.task_id,title:row.title,client:row.client,date:match[2],priority:2,
   evidence:'historical_review',evidence_id:auditId}];
 });
}
// Activity with a stable actor ID is a dated declaration of review delivery.
// Old name-only comments additionally need the matching MIA event and legacy
// editor ledger. A name or a scheduled deadline alone never establishes credit.
export function recoverReviewActivityCandidates(rows){
 return rows.flatMap(row=>{
  const commentId=typeof row.comment_id==='string'&&/^[1-9]\d*$/.test(row.comment_id)?Number(row.comment_id):row.comment_id;
  if(!Number.isSafeInteger(row.task_id)||row.task_id<=0||!Number.isSafeInteger(commentId)||commentId<=0
    ||row.content!=='[Actividad] movió la tarea de En proceso a Para revisar'
    ||!date(row.comment_at)||!row.comment_at.includes('T'))return [];
  if(row.actor_id!==9){
   const auditId=typeof row.audit_id==='string'&&/^[1-9]\d*$/.test(row.audit_id)?Number(row.audit_id):row.audit_id;
   const match=typeof row.event_id==='string'&&row.event_id.match(/^(\d+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):tarea_en_revision$/);
   if(row.actor_id!==null||row.author!=='Luciano'||row.legacy_witness!==true||!Number.isSafeInteger(auditId)||auditId<=0
     ||!match||Number(match[1])!==row.task_id||!date(match[2])||!date(row.audit_at)
     ||Date.parse(row.audit_at)<Date.parse(match[2])
     ||Date.parse(row.comment_at)<Date.parse(match[2])-1000||Date.parse(row.comment_at)>Date.parse(match[2])+60000)return [];
  }
  return [{person_id:9,key:row.key,task_id:row.task_id,title:row.title,client:row.client,date:row.comment_at,priority:3,
   evidence:row.actor_id===9?'review_activity':'corroborated_review_activity',evidence_id:commentId}];
 });
}
export function projectTeamStatistics(users,candidates,period){
 return people.map(person=>{
  const user=users.find(u=>u.id===person.id&&u.rol===person.role),unique=new Map(),missing=new Set();
  // Canonical deliveries take precedence over task closure fallback. A piece
  // with multiple tasks/revisions has one stable identity, never a title match.
  for(const row of [...candidates].sort((a,b)=>(a.priority??1)-(b.priority??1)||(Date.parse(a.date)||0)-(Date.parse(b.date)||0))){
   if(row.person_id!==person.id||!row.key)continue;
   if(!date(row.date)){missing.add(row.key);continue;}
   if(!unique.has(row.key))unique.set(row.key,row);
  }
  const records=[...unique.values()].map(row=>({...row,date:date(row.date)})).filter(row=>row.date.startsWith(period))
   .map(row=>({key:row.key,title:row.title||'Sin título',client:row.client||'Sin cliente',date:row.date,
    ...(row.evidence?{evidence:row.evidence,evidence_id:row.evidence_id}:{}),
    href:row.visit_id?`/producciones?visita=${row.visit_id}`:`/workspace/tareas?task=${row.task_id}`}));
  return {id:person.id,name:user?.nombre||person.name,label:person.label,available:Boolean(user),count:user?records.length:null,unverified:[...missing].filter(key=>!unique.has(key)).length,records:user?records:[]};
 });
}
export async function readTeamStatistics(pool,auth,period){
 if(typeof period!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw fail('Elegí un mes válido.');
 const captured={id:auth?.id,rol:auth?.rol,version:auth?.session_version};
 if(!Number.isSafeInteger(captured.id)||captured.id<=0||!Number.isSafeInteger(captured.version)||captured.version<=0)throw fail('Sesión requerida.',401);
 const db=await pool.connect();let discard;
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[captured.id])).rows[0];
  if(!actor||actor.id!==captured.id||actor.rol!==captured.rol||actor.session_version!==captured.version||actor.activo!==true)throw fail('La sesión cambió.',401);
  if(!SYSTEM_USER_ROLES.includes(actor.rol))throw fail('Perfil no autorizado.',403);
  const users=(await db.query('SELECT id,nombre,rol FROM usuarios WHERE id=ANY($1::int[])',[[8,9,10]])).rows;
  const videos=(await db.query(`SELECT 10 person_id,'video:'||pv.id::text AS key,pv.titulo title,c.nombre client,
    to_char(v.fecha,'YYYY-MM-DD') date,v.id visit_id,0 priority
    FROM produccion_videos pv JOIN produccion_visitas v ON v.id=pv.visita_id LEFT JOIN clientes c ON c.id=v.cliente_id
    WHERE pv.estado='grabado' AND EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=v.tarea_origen_id AND a.usuario_id=10 AND a.tipo='responsable')`)).rows;
  const tasks=(await db.query(`SELECT a.usuario_id person_id,t.id task_id,t.titulo title,c.nombre client,
    CASE WHEN p.id IS NOT NULL THEN 'piece:'||p.id::text ELSE 'task:'||t.id::text END AS key,
    t.propiedades_extra->>'finalizada_at' date,1 priority
    FROM tareas t JOIN tarea_asignaciones a ON a.tarea_id=t.id AND a.tipo='responsable'
    LEFT JOIN clientes c ON c.id=t.cliente_id LEFT JOIN publicaciones p ON p.id=t.publicacion_id AND p.cliente_id=t.cliente_id
    WHERE ((a.usuario_id=8 AND (p.tipo='carrusel' OR lower(t.subtipo) IN ('carrusel','carruseles')))
      OR (a.usuario_id=9 AND t.tipo_tarea='edicion')) AND t.estado IN ('en_revision','aprobada','finalizada','publicada')
    AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
    AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'`)).rows;
  const deliveries=(await db.query(`SELECT 9 person_id,t.id task_id,t.titulo title,c.nombre client,
    CASE WHEN p.id IS NOT NULL THEN 'piece:'||p.id::text ELSE 'task:'||t.id::text END AS key,
    to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') date,0 priority
    FROM task_editing_deliveries d JOIN tareas t ON t.id=d.task_id LEFT JOIN clientes c ON c.id=t.cliente_id
    LEFT JOIN publicaciones p ON p.id=t.publicacion_id AND p.cliente_id=t.cliente_id
    WHERE t.tipo_tarea='edicion' AND (d.actor_id=9 OR EXISTS(SELECT 1 FROM progreso_edicion_entregas ep
      WHERE ep.tarea_id=t.id AND ep.delivery_id=d.id AND ep.editor_user_id=9 AND ep.origen_registro='canonical_delivery' AND ep.activa IS TRUE))`)).rows;
  const historical=(await db.query(`SELECT t.id task_id,t.titulo title,c.nombre client,a.id audit_id,
    CASE WHEN p.id IS NOT NULL THEN 'piece:'||p.id::text ELSE 'task:'||t.id::text END AS key,
    a.detalles->>'eventId' event_id,
    to_char(e.entregada_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') legacy_at,
    to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') audit_at
    FROM tareas t JOIN progreso_edicion_entregas e ON e.tarea_id=t.id
    JOIN integracion_auditoria a ON a.tarea_id=t.id
    LEFT JOIN clientes c ON c.id=t.cliente_id
    LEFT JOIN publicaciones p ON p.id=t.publicacion_id AND p.cliente_id=t.cliente_id
    WHERE t.tipo_tarea='edicion' AND t.estado IN ('en_revision','aprobada','finalizada','publicada')
    AND e.editor_clave='luciano' AND e.origen_registro IS NULL AND e.activa IS TRUE
    AND a.accion='entregar_evento_mia' AND a.resultado='ok'
    AND a.detalles->>'eventId' LIKE t.id::text||':%:tarea_en_revision'
    AND EXISTS(SELECT 1 FROM tarea_asignaciones x WHERE x.tarea_id=t.id AND x.usuario_id=9 AND x.tipo='responsable')
    AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
    AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
    ORDER BY a.created_at,a.id`)).rows;
  const activities=(await db.query(`SELECT t.id task_id,t.titulo title,c.nombre client,cm.id comment_id,
    cm.actor_usuario_id actor_id,cm.autor author,cm.contenido content,
    CASE WHEN p.id IS NOT NULL THEN 'piece:'||p.id::text ELSE 'task:'||t.id::text END AS key,
    to_char(cm.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') comment_at,
    a.id audit_id,a.detalles->>'eventId' event_id,
    to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') audit_at,
    EXISTS(SELECT 1 FROM progreso_edicion_entregas e WHERE e.tarea_id=t.id AND e.editor_clave='luciano'
      AND e.origen_registro IS NULL AND e.activa IS TRUE) legacy_witness
    FROM tareas t JOIN tarea_comentarios cm ON cm.tarea_id=t.id
    LEFT JOIN clientes c ON c.id=t.cliente_id
    LEFT JOIN publicaciones p ON p.id=t.publicacion_id AND p.cliente_id=t.cliente_id
    LEFT JOIN LATERAL (SELECT ia.id,ia.detalles,ia.created_at FROM integracion_auditoria ia
      WHERE cm.actor_usuario_id IS NULL AND ia.tarea_id=t.id AND ia.accion='entregar_evento_mia' AND ia.resultado='ok'
      AND ia.detalles->>'eventId' LIKE t.id::text||':%:tarea_en_revision' ORDER BY ia.created_at,ia.id LIMIT 1) a ON TRUE
    WHERE t.tipo_tarea='edicion' AND t.estado IN ('en_revision','aprobada','finalizada','publicada')
    AND cm.contenido='[Actividad] movió la tarea de En proceso a Para revisar'
    AND (cm.actor_usuario_id=9 OR (cm.actor_usuario_id IS NULL AND cm.autor='Luciano'))
    AND EXISTS(SELECT 1 FROM tarea_asignaciones x WHERE x.tarea_id=t.id AND x.usuario_id=9 AND x.tipo='responsable')
    AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
    AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
    ORDER BY cm.created_at,cm.id`)).rows;
  const result={period,rows:projectTeamStatistics(users,[...videos,...tasks,...deliveries,
    ...recoverHistoricalEditingCandidates(historical),...recoverReviewActivityCandidates(activities)],period)};
  await db.query('COMMIT');return result;
 }catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}finally{db.release(discard);}
}
