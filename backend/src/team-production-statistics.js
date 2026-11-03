import {isValidProductionDate} from './production-visits.js';
const validTimestamp=value=>typeof value==='string'
 &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
 &&isValidProductionDate(value.slice(0,10))&&Number(value.slice(11,13))<24&&Number.isFinite(Date.parse(value));

// Read-only reporting of declared historical batches. Never expand a quantity
// into invented individual video identities or use planned scripts as output.
export function projectHistoricalProduction(tasks){
 const entries=[],pending=new Map(),candidates=[];
 const hold=(entry,reason)=>pending.set(entry.key,{key:entry.key,title:entry.task.title,client:entry.task.client||'Sin cliente',
  date:isValidProductionDate(entry.record?.fecha)?entry.record.fecha:null,reason,href:`/workspace/tareas?task=${entry.task.id}`});
 for(const task of tasks){
  if(!Number.isSafeInteger(task.id)||task.id<=0||!Array.isArray(task.records))continue;
  for(const [index,record] of task.records.entries()){
   const validId=typeof record?.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(record.id);
   const entry={task,record,key:validId?`production-batch:${record.id}`:`production-invalid:${task.id}:${index}`};
   const amount=record?.cantidad;
   const quantity=typeof amount==='string'&&/^[1-9]\d*$/.test(amount)?Number(amount):amount;
   if(!validId||!isValidProductionDate(record?.fecha)||!Number.isSafeInteger(quantity)||quantity<=0
     ||!validTimestamp(record?.created_at)){hold(entry,'Registro incompleto o inválido.');continue;}
   if(!(record.usuario_id===10||(record.usuario_id==null&&record.usuario==='Germán'))){hold(entry,'Autor de la grabación sin comprobar.');continue;}
   entry.quantity=quantity;entries.push(entry);
  }
 }
 const identities=new Map();
 for(const entry of entries){
  const previous=identities.get(entry.key);
  if(previous&&(previous.quantity!==entry.quantity||previous.record.fecha!==entry.record.fecha||previous.task.client_id!==entry.task.client_id)){
   hold(previous,'El mismo registro tiene datos contradictorios.');hold(entry,'El mismo registro tiene datos contradictorios.');
  }else if(previous&&entry.task.has_normalized_videos){
   hold(previous,'La visita ya tiene videos individuales; el lote no se suma para evitar duplicados.');
  }else if(!previous)identities.set(entry.key,entry);
 }
 const unique=[...identities.values()];
 const groups=new Map(),nearDuplicates=new Set();
 for(const entry of unique){const key=JSON.stringify([entry.task.id,entry.record.fecha,entry.quantity]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
 for(const group of groups.values()){
  group.sort((a,b)=>Date.parse(a.record.created_at)-Date.parse(b.record.created_at));
  for(let i=1;i<group.length;i++)if(Date.parse(group[i].record.created_at)-Date.parse(group[i-1].record.created_at)<=60000){
   nearDuplicates.add(group[i].key);nearDuplicates.add(group[i-1].key);
  }
 }
 for(const entry of unique){
  if(entry.task.has_normalized_videos){hold(entry,'La visita ya tiene videos individuales; el lote no se suma para evitar duplicados.');continue;}
  // A title never supplies the filming date. A conflicting month is only a
  // reason to request verification, not permission to move counts to that month.
  const hint=entry.task.title?.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if(hint){
   const hintedDate=`${hint[3]||entry.record.fecha.slice(0,4)}-${hint[2].padStart(2,'0')}-${hint[1].padStart(2,'0')}`;
   if(isValidProductionDate(hintedDate)&&hintedDate.slice(0,7)!==entry.record.fecha.slice(0,7)){
    hold(entry,'La fecha declarada y el mes indicado en la visita no coinciden.');continue;
   }
  }
  if(nearDuplicates.has(entry.key))hold(entry,'Cargas iguales en la misma visita y fecha; falta comprobar si son videos distintos.');
 }
 for(const entry of unique){
  if(pending.has(entry.key))continue;
  candidates.push({person_id:10,key:entry.key,task_id:entry.task.id,title:entry.task.title,client:entry.task.client,
   date:entry.record.fecha,quantity:entry.quantity,priority:2,evidence:'historical_production_batch'});
 }
 return {candidates,pending:[...pending.values()]};
}
