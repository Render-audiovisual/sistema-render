import {uniqueReportTasks,reportTaskPeople,reportTaskFormat,employeeTaskDetails,buildHistoricalProductionReport,inReportRange} from './production-registry-report.js';
import {isConfirmedPublication,confirmationDate} from '../editorial/publication-evidence.js';
const array=value=>Array.isArray(value)?value:[];
const delivered=new Set(['en_revision','aprobada','finalizada','publicada']);
const labels={produccion:'Videos grabados',diseno:'Carruseles realizados',edicion:'Videos editados',community:'Publicaciones subidas'};
const hidden=task=>[true,'true'].includes(task.propiedades_extra?.archivada_render_os)||[true,'true'].includes(task.propiedades_extra?.papelera_render_os);
export function buildTeamWorkCards(data,range){
 const users=[...new Map(array(data?.usuarios).filter(user=>Number.isSafeInteger(user?.id)&&user.id>0&&Object.hasOwn(labels,user.rol)).map(user=>[user.id,user])).values()];
 const tasks=uniqueReportTasks(data?.tareas,data?.tareasRenderOs).filter(task=>!hidden(task));
 const taskById=new Map(tasks.map(task=>[task.id,task]));
 const visits=array(data?.producciones?.visitas);
 const normalized=new Set(visits.filter(visit=>array(visit.videos).length||array(visit.fotos).length).map(visit=>visit.tarea_origen_id));
 const clients=new Map(array(data?.clientes).map(client=>[client.id,client.nombre]));
 const publicationGaps=new Set(array(data?.publicaciones).filter(piece=>piece?.estado==='publicada'&&!isConfirmedPublication(piece)&&inReportRange(piece['fecha_publicación_real']||piece.fecha_programada,range)).map(piece=>piece.id)).size;
 const cards=users.map(user=>{
  const records=[];let pending=0;
  if(['diseno','edicion'].includes(user.rol)){
   const relevant=tasks.filter(task=>user.rol==='diseno'?reportTaskFormat(task)==='carruseles':task.tipo_tarea==='edicion');
   const details=employeeTaskDetails(relevant,user.id,range);
   pending=details.filter(task=>!delivered.has(task.estado)).length;
   for(const item of details.filter(task=>delivered.has(task.estado)))records.push({key:`task:${item.id}`,title:item.titulo,client:taskById.get(item.id)?.cliente_nombre||'Sin cliente',date:item.fecha_entrega||item.finalizada?.slice(0,10)||item.actualizada?.slice(0,10),amount:1,state:item.estado,href:item.href});
  }else if(user.rol==='produccion'){
   const seen=new Set();
   for(const visit of visits){
    if(!inReportRange(visit.fecha,range))continue;
    const source=taskById.get(visit.tarea_origen_id);
    // One current production assignee can receive credit; participation alone
    // does not turn every attendee into the author of every video.
    if(!source||source.asignado_a_id!==user.id)continue;
    for(const video of array(visit.videos))if(video.estado==='grabado'&&video.id&&!seen.has(video.id)){
     seen.add(video.id);records.push({key:`video:${video.id}`,title:video.titulo||visit.titulo||'Video',client:visit.cliente_nombre||clients.get(visit.cliente_id)||'Sin cliente',date:visit.fecha,amount:1,state:'grabado',href:`/producciones?visita=${encodeURIComponent(visit.id)}`});
    }
   }
   for(const task of tasks.filter(task=>task.asignado_a_id===user.id)){
    const ids=new Set();const deduped=array(task.propiedades_extra?.produccion_registros).filter(row=>{if(!row?.id)return true;if(ids.has(row.id))return false;ids.add(row.id);return true;});
    const amount=buildHistoricalProductionReport([{...task,propiedades_extra:{...task.propiedades_extra,produccion_registros:deduped}}],normalized,range).reduce((sum,row)=>sum+row.recorded,0);
    if(amount)records.push({key:`historical:${task.id}`,title:task.titulo||'Grabación',client:task.cliente_nombre||'Sin cliente',date:null,amount,state:'registro de visita',href:`/workspace/tareas?task=${task.id}`});
   }
  }else{
   const seen=new Set();
   for(const piece of array(data?.publicaciones)){
    if(!isConfirmedPublication(piece)||piece.publicacion_evidencia.confirmation.actor_id!==user.id||!inReportRange(confirmationDate(piece),range)||seen.has(piece.id))continue;
    seen.add(piece.id);records.push({key:`publication:${piece.id}`,title:piece.titulo||`${piece.tipo==='carrusel'?'Carrusel':piece.tipo==='reel'?'Reel':'Publicación'} #${piece.id}`,client:clients.get(piece.cliente_id)||'Sin cliente',date:confirmationDate(piece),amount:1,state:'publicada',href:`/calendario?mes=${confirmationDate(piece).slice(0,7)}&dia=${confirmationDate(piece)}&cliente=${piece.cliente_id}`});
   }
  }
  return {id:user.id,name:user.nombre||user.usuario||'Integrante',role:user.rol,label:labels[user.rol],count:records.reduce((sum,item)=>sum+item.amount,0),pending,records,unattributed:user.rol==='community'?publicationGaps:0};
 });
 return cards.sort((a,b)=>a.name.localeCompare(b.name,'es'));
}
