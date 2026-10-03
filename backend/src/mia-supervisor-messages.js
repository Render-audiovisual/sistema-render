import {localClock,isSupervisorWorkTime} from './mia-supervisor-policy.js';

// User-facing copy never includes identifiers or model/planner diagnostics.
export function shortText(value,max=72) {
  const text=String(value||'').replace(/https?:\/\/\S+/gi,'').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'')
    .replace(/(?:tarea\s*)?#\d+/gi,'').replace(/[\r\n?¿]+/g,' ').replace(/\s+/g,' ').trim();
  return text.length>max ? text.slice(0,max-1).trimEnd()+'…' : text;
}
export const displayDate=(date)=>String(date||'').split('-').slice(1).reverse().join('/');
export function taskLabel(task) {
  const title=shortText(task.titulo);
  const client=shortText(task.cliente_nombre,32);
  return `«${title}»${client && !title.toLowerCase().includes(client.toLowerCase())?` (${client})`:''}`;
}
export function followupMessage(task,type,proposal) {
  if(type==='missing_date') return `La tarea ${taskLabel(task)} todavía no tiene fecha. Por la carga actual, propongo el ${displayDate(proposal.fecha)}. ¿Te sirve?`;
  return `La tarea ${taskLabel(task)} venció el ${displayDate(task.fecha_vencimiento)}. ¿En qué estado está?`;
}
export function supervisorWindow(now=new Date()) {
  if(!isSupervisorWorkTime(now)) return null;
  const clock=localClock(now);
  return `${clock.date}:${clock.minute<780?'am':'pm'}`;
}
export function nextSupervisorWindow(now=new Date()) {
  const clock=localClock(now);
  if(clock.weekday!=='Sun' && clock.minute<1020) return new Date(`${clock.date}T17:00:00-03:00`);
  let date=new Date(Date.parse(`${clock.date}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  while(localClock(new Date(`${date}T12:00:00-03:00`)).weekday==='Sun') date=new Date(Date.parse(`${date}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  return new Date(`${date}T08:00:00-03:00`);
}
export function batchMessage(rows) {
  if(rows.length===1) return rows[0].mensaje;
  const shown=rows.slice(0,2);
  const labels=shown.map(row=>row.detalles.label).join(' y ');
  if(rows.every(row=>row.motivo==='supervisor_seguimiento' && row.detalles.type==='overdue'))
    return `Tenés ${rows.length} tareas vencidas: ${labels}. ¿En qué estado están?`;
  if(rows.every(row=>row.motivo==='supervisor_seguimiento' && row.detalles.type==='missing_date'))
    return `Falta acordar fecha para ${labels}. Propongo ${displayDate(rows[0].detalles.proposed_date)} para ambas. ¿Te sirve?`;
  // Leader notifications are one concise actionable summary, not one message per finding.
  const first=shortText(rows[0].mensaje,260);
  return `${first}${rows.length>1?` Hay ${rows.length-1} puntos más para revisar en el tablero.`:''}`;
}
