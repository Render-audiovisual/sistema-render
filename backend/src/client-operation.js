import { SYSTEM_USER_ROLES } from './user-roles.js';
import { effectiveTaskStateSql } from './task-review-query.js';
import { readProjectList } from './projects.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { readGoals, goalPeriod } from './client-goals.js';

const CAP = 6;
const fail = (status,message) => Object.assign(new Error(message),{status});
const positive = value => Number.isSafeInteger(value) && value>0 && value<=2147483647;
const text = (value,max=250) => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max) : '';
const count = value => {
  if (!Number.isSafeInteger(value) || value<0) throw new Error('Invalid client operation count');
  return value;
};
const nullableText = value => value===null || value===undefined ? null : text(value);
const section = (scope,total,counts,items,href) => {
  count(total);
  if (!Array.isArray(items) || items.length>CAP || items.length>total) throw new Error('Invalid client operation preview');
  return {scope,total,counts,items,has_more:total>items.length,href};
};
export function parseClientOperationQuery(query = {}) {
  if (!query || typeof query!=='object' || Array.isArray(query) || Object.keys(query).some(key=>key!=='periodo')) throw fail(400,'Filtros de operación inválidos.');
  return {periodo:goalPeriod(query.periodo)};
}
function clientId(value) {
  if (typeof value!=='string' || !/^[1-9][0-9]*$/.test(value) || /\s/.test(value) || !positive(Number(value))) throw fail(400,'Cliente inválido.');
  return Number(value);
}

// Match the canonical shared RenderOS client board. Deliberately do NOT add
// Home's active-client restriction: an inactive client still has task history.
const TASK_SCOPE = `t.cliente_id=$1 AND t.propiedades_extra->>'workspace'='render_os'
  AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`;
async function taskSection(db,id) {
  const state=effectiveTaskStateSql('t');
  const grouped=(await db.query(`SELECT ${state} AS estado,count(*)::int AS total FROM tareas t WHERE ${TASK_SCOPE} GROUP BY ${state}`,[id])).rows;
  const counts={pendiente:0,en_progreso:0,en_revision:0,aprobada:0,finalizada:0,otros:0};
  for (const row of grouped) {
    const key=row.estado==='publicada'?'finalizada':Object.hasOwn(counts,row.estado)?row.estado:'otros';
    counts[key]+=count(row.total);
  }
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
  const rows=(await db.query(`SELECT t.id,t.titulo,${state} AS estado,t.revision,
    to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento
    FROM tareas t WHERE ${TASK_SCOPE} ORDER BY t.updated_at DESC,t.id DESC LIMIT 6`,[id])).rows;
  const items=rows.map(row=>({id:row.id,titulo:text(row.titulo),estado:text(row.estado,80),revision:row.revision,
    fecha_vencimiento:nullableText(row.fecha_vencimiento),href:`/workspace/tareas?task=${row.id}`}));
  return section('render_os_cliente_sin_archivo_ni_papelera',total,counts,items,`/workspace/tareas?client=${id}&view=list`);
}
async function projectSection(db,user,id) {
  const result=await readProjectList(db,user,{cliente_id:String(id),limit:'6',offset:'0'});
  const items=result.proyectos.map(row=>({id:row.id,titulo:text(row.titulo),tipo:text(row.tipo,80),estado:text(row.estado,80),revision:row.revision,
    fecha_inicio:nullableText(row.fecha_inicio),fecha_entrega:nullableText(row.fecha_entrega),
    responsable:{id:row.responsable.id,nombre:text(row.responsable.nombre)},
    counts:{tareas:count(row.counts.tareas),finalizadas:count(row.counts.finalizadas),hitos:count(row.counts.hitos),entregables:count(row.counts.entregables)},href:row.href}));
  return section('compartidos_no_archivados_todos_los_periodos',count(result.total),{no_archivados:result.total},items,`/proyectos?cliente=${id}`);
}
async function productionSection(db,id,period) {
  const values=[id,`${period}-01`];
  const stats=(await db.query(`WITH visits AS MATERIALIZED (
    SELECT id FROM produccion_visitas WHERE cliente_id=$1 AND fecha>=$2::date AND fecha<$2::date+INTERVAL '1 month'
  ) SELECT (SELECT count(*)::int FROM visits) AS visitas,
    (SELECT count(*)::int FROM produccion_videos pv JOIN visits v ON v.id=pv.visita_id) AS videos_registrados,
    (SELECT count(*)::int FROM produccion_videos pv JOIN visits v ON v.id=pv.visita_id WHERE pv.video_origen_id IS NOT NULL) AS videos_reutilizados,
    (SELECT count(*)::int FROM produccion_fotos p JOIN visits v ON v.id=p.visita_id) AS registros_fotos,
    (SELECT count(*)::int FROM produccion_videos pv JOIN produccion_visitas v ON v.id=pv.visita_id
      WHERE v.cliente_id=$1 AND pv.estado IN ('planificado','pendiente','repetir')
        AND NOT EXISTS(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id)) AS pendientes_banco_todos_los_periodos`,values)).rows[0];
  if (!stats) throw new Error('Missing client production counts');
  const counts=Object.fromEntries(['visitas','videos_registrados','videos_reutilizados','registros_fotos','pendientes_banco_todos_los_periodos'].map(key=>[key,count(stats[key])]));
  const rows=(await db.query(`SELECT v.id,v.titulo,v.revision,to_char(v.fecha,'YYYY-MM-DD') AS fecha,
    (SELECT count(*)::int FROM produccion_videos pv WHERE pv.visita_id=v.id) AS videos_registrados,
    (SELECT count(*)::int FROM produccion_fotos p WHERE p.visita_id=v.id) AS registros_fotos
    FROM produccion_visitas v WHERE v.cliente_id=$1 AND v.fecha>=$2::date AND v.fecha<$2::date+INTERVAL '1 month'
    ORDER BY v.fecha DESC,v.id DESC LIMIT 6`,values)).rows;
  const items=rows.map(row=>({id:row.id,titulo:text(row.titulo),revision:row.revision,fecha:row.fecha,
    videos_registrados:count(row.videos_registrados),registros_fotos:count(row.registros_fotos),href:`/producciones?visita=${row.id}&cliente=${id}&mes=${row.fecha.slice(0,7)}`}));
  return section('visitas_mes_y_banco_pendiente_global',counts.visitas,counts,items,`/producciones?cliente=${id}&mes=${period}`);
}

const editorialDomainSql=(domain,table)=>`SELECT '${domain}'::text AS domain,p.id,p.cliente_id,c.activo AS cliente_activo,p.estado,
  ${domain==='historia'?"'historia'::text":'p.tipo'} AS tipo,to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,p.fecha_publicación_real,
  jsonb_build_object('archivado_tablero',p.metadata->'archivado_tablero') AS metadata,
  left(COALESCE(NULLIF(btrim(p.idea),''),NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'idea')='string' THEN p.metadata->>'idea' END),''),
    NULLIF(btrim(CASE WHEN jsonb_typeof(p.metadata->'Idea')='string' THEN p.metadata->>'Idea' END),''),left(p.copy,160),''),160) AS titulo
  FROM ${table} p JOIN clientes c ON c.id=p.cliente_id
  WHERE p.cliente_id=$1 AND c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
    AND p.fecha_programada>=$2::date AND p.fecha_programada<$2::date+INTERVAL '1 month'`;
function evidenceDto(value) {
  if (!value || !['confirmada_manualmente','historica_sin_confirmacion','no_publicada'].includes(value.classification)) throw new Error('Invalid client editorial evidence');
  return {classification:value.classification,revision:count(value.revision),confirmation:value.confirmation?{
    id:value.confirmation.id,actor_id:value.confirmation.actor_id,occurred_at:value.confirmation.occurred_at,
    recorded_at:value.confirmation.recorded_at,source:value.confirmation.source}:null};
}
function editorialLinks(domain,id,period) {
  return domain==='historia'?{href:`/planificacion-historias?vista=planilla&cliente=${id}&mes=${period}`,
    context_href:`/planificacion-historias?vista=checklist&mes=${period}`}:
    {href:`/planificacion-publicaciones?tab=planilla&cliente=${id}&mes=${period}`,
      context_href:`/planificacion-publicaciones?tab=calendario&mes=${period}`};
}
async function editorialSection(db,id,period) {
  // Count the entire planned-month cohort with the real evidence classifier,
  // never just six previews or a proxy task/metadata publication flag.
  const rows=(await db.query(`${editorialDomainSql('historia','historias')} UNION ALL ${editorialDomainSql('publicacion','publicaciones')}
    ORDER BY fecha_programada DESC,domain ASC,id ASC`,[id,`${period}-01`])).rows;
  const counts={confirmada_manualmente:0,historica_sin_confirmacion:0,no_publicada:0};
  const annotated=new Map();
  for (const domain of ['historia','publicacion']) for (const row of await annotateEditorialEvidence(db,domain,rows.filter(item=>item.domain===domain))) {
    const proof=evidenceDto(row.publicacion_evidencia), key=`${domain}:${row.id}`;
    if (annotated.has(key)) throw new Error('Duplicate client editorial identity');
    annotated.set(key,proof); counts[proof.classification]++;
  }
  if (annotated.size!==rows.length) throw new Error('Invalid client editorial domain');
  const items=rows.slice(0,CAP).map(row=>({domain:row.domain,id:row.id,titulo:text(row.titulo,160),tipo:text(row.tipo,80),estado:text(row.estado,80),
    fecha_programada:row.fecha_programada,publicacion_evidencia:annotated.get(`${row.domain}:${row.id}`),...editorialLinks(row.domain,id,period)}));
  return section('cohorte_mes_programado_visible',rows.length,counts,items,null);
}
function goalItem(row,period) {
  const quota={reels:count(row.reels),carruseles:count(row.carruseles)};
  if (!Array.isArray(row.cuentas)||row.cuentas.some(account=>!account||!positive(account.id))) throw new Error('Invalid client goal accounts');
  const pieces=row.piezas;
  if (!Array.isArray(pieces)) throw new Error('Invalid client goal pieces');
  const progress={reels:{total:quota.reels,completed:0},carruseles:{total:quota.carruseles,completed:0}},extras={total:0,completed:0};
  for (const piece of pieces) {
    if (!['video','carrusel'].includes(piece.tipo) || !positive(piece.numero) || typeof piece.en_cuota!=='boolean'
      || piece.en_cuota!==(piece.numero<=(piece.tipo==='video'?quota.reels:quota.carruseles))) throw new Error('Invalid client goal quota membership');
    const completed=['finalizada','publicada'].includes(piece.estado);
    if (piece.en_cuota) { if (completed) progress[piece.tipo==='video'?'reels':'carruseles'].completed++; }
    else { extras.total++; if (completed) extras.completed++; }
  }
  if (typeof row.preparado!=='boolean' || typeof row.cuota_desactualizada!=='boolean') throw new Error('Invalid client goal observation');
  const current=row.cuota_actual===null?null:{reels:count(row.cuota_actual?.reels),carruseles:count(row.cuota_actual?.carruseles)};
  return {id:positive(row.id)?row.id:null,clave:text(row.clave,200),nombre:text(row.nombre),cuentas:row.cuentas.map(account=>({id:account.id,nombre:text(account.nombre)})),
    preparado:row.preparado,quota,cuota_actual:current,cuota_desactualizada:row.cuota_desactualizada,
    progress,extras,href:`/clientes?periodo=${period}`};
}
async function goalSection(db,id,period) {
  // readGoals accepts an existing released-capable PG client: no nested pool
  // lease/transaction, no new inference or alteration of historical grouping.
  const result=await readGoals(db,period);
  const matching=result.clientes.filter(row=>Array.isArray(row.cuentas)&&row.cuentas.some(account=>account.id===id))
    .sort((a,b)=>String(a.clave).localeCompare(String(b.clave),'es'));
  const items=matching.slice(0,CAP).map(row=>goalItem(row,period));
  const counts={preparados:matching.filter(row=>row.preparado===true).length,por_preparar:matching.filter(row=>row.preparado===false).length};
  return section('objetivos_mes_por_grupo_sin_sumar_cuotas',matching.length,counts,items,`/clientes?periodo=${period}`);
}

export async function readClientOperation(pool,auth,rawClientId,query={}) {
  const id=clientId(rawClientId),{periodo}=parseClientOperationQuery(query);
  const observed=Object.freeze({id:auth?.id,rol:auth?.rol,session_version:auth?.session_version});
  if (!positive(observed.id)||!positive(observed.session_version)||typeof observed.rol!=='string') throw fail(401,'Necesitás una sesión verificada.');
  const db=await pool.connect(); let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[observed.id])).rows[0];
    if (!user||user.id!==observed.id||user.activo!==true||user.session_version!==observed.session_version||user.rol!==observed.rol) throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
    if (!SYSTEM_USER_ROLES.includes(user.rol)) throw fail(403,'Este perfil no tiene acceso a la operación de clientes.');
    const client=(await db.query(`SELECT id,nombre,activo,rubro,
      to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at FROM clientes WHERE id=$1`,[id])).rows[0];
    if (!client) throw fail(404,'Cliente no encontrado.');
    const tareas=await taskSection(db,id),proyectos=await projectSection(db,user,id),producciones=await productionSection(db,id,periodo),
      editorial=await editorialSection(db,id,periodo),objetivos=await goalSection(db,id,periodo);
    const result={version:1,generated_at:client.generated_at,periodo,cliente:{id:client.id,nombre:text(client.nombre),activo:client.activo===true,rubro:nullableText(client.rubro)},
      tareas,proyectos,producciones,editorial,objetivos};
    await db.query('COMMIT'); return result;
  } catch(error) {
    try {await db.query('ROLLBACK');} catch(rollbackError) {discard=rollbackError;}
    throw error;
  } finally {db.release(discard);}
}
export function createClientOperationRouter({express,pool}) {
  const router=express.Router();
  router.get('/:id/operacion',async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try {res.json(await readClientOperation(pool,req.auth,req.params.id,req.query));}
    catch(error) {if([400,401,403,404].includes(error.status))return res.status(error.status).json({error:error.message});next(error);}
  });
  return router;
}
