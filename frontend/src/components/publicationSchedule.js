export const DISPATCH_TIME_ZONE = 'America/Argentina/Cordoba';
const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPATCH_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
const validDate = value => {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
const validTime = value => typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const invalid = () => new Error('Completá una fecha y hora válidas de Córdoba, o dejá ambas vacías para guardar un borrador sin programar.');

// One business timezone, independent of browser/host settings. A missing stored
// schedule remains missing; malformed observations never turn into today's date.
export function dispatchScheduleFields(value) {
  if(value===null||value===undefined||value==='')return{date:'',time:''};
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ||!validDate(value.slice(0,10))||!validTime(value.slice(11,16))||Number(value.slice(17,19))>59)throw invalid();
  const instant=new Date(value);
  if(!Number.isFinite(instant.getTime()))throw invalid();
  const parts=Object.fromEntries(civilFormatter.formatToParts(instant).map(part=>[part.type,part.value]));
  return{date:`${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}

export function dispatchScheduleInstant({date,time,observedScheduledAt=null},mode='draft') {
  if(!['draft','now','schedule'].includes(mode))throw invalid();
  if(date===''&&time===''&&mode==='draft')return null;
  if(!validDate(date)||!validTime(time))throw invalid();
  if(observedScheduledAt!==null&&observedScheduledAt!==undefined&&observedScheduledAt!==''){
    const observed=dispatchScheduleFields(observedScheduledAt);
    if(observed.date===date&&observed.time===time)return observedScheduledAt;
  }
  const desired=Date.parse(`${date}T${time}:00.000Z`);
  // Start at the existing -03 planning offset, then verify/correct against the
  // explicit timezone. Bounded correction rejects nonexistent civil times.
  let candidate=desired+3*60*60*1000;
  for(let pass=0;pass<4;pass++){
    if(!Number.isFinite(candidate))throw invalid();
    const iso=new Date(candidate).toISOString();
    const shown=dispatchScheduleFields(iso);
    if(shown.date===date&&shown.time===time)return iso;
    candidate+=desired-Date.parse(`${shown.date}T${shown.time}:00.000Z`);
  }
  throw invalid();
}

export function dispatchToday(now=new Date()) {
  return dispatchScheduleFields(now.toISOString()).date;
}
