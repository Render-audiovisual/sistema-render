import { createEditorialSessionGuard } from '../components/EditorialPublicationControl.model.js';
import { confirmationDate, isConfirmedPublication } from '../shared/editorial/publication-evidence.js';

export const CALENDAR_KINDS = { all: 'Todos', tarea: 'Entregas de tareas', visita: 'Visitas', hito: 'Hitos de proyectos', programacion: 'Programación', publicacion: 'Publicaciones confirmadas' };
export const CALENDAR_PAGE_LIMIT = 200;
export const MAX_CALENDAR_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / CALENDAR_PAGE_LIMIT);
const pageNumber = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && String(Number(value)) === value && Number.isSafeInteger(Number(value)) && Number(value) <= MAX_CALENDAR_PAGE ? Number(value) : 0;
const calendarSnapshot = value => typeof value === 'string' && value.length === 67 && /^c1:[a-f0-9]{64}$/.test(value);
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
export function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const month = value => typeof value === 'string' && calendarDay(`${value}-01`);
const supportedMonth = value => month(value) && value !== '9999-12';
export function cordobaToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function addCalendarDays(day, amount) {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function readCalendarSelection(search, today = cordobaToday()) {
  const params = new URLSearchParams(search);
  const mes = supportedMonth(params.get('mes')) ? params.get('mes') : !params.has('mes') && calendarDay(params.get('dia')) && supportedMonth(params.get('dia').slice(0, 7)) ? params.get('dia').slice(0, 7) : today.slice(0, 7);
  const dia = calendarDay(params.get('dia')) && params.get('dia').startsWith(mes) ? params.get('dia') : today.startsWith(mes) ? today : `${mes}-01`;
  const client = params.get('cliente');
  return { mes, dia, scope: params.get('scope') === 'team' ? 'team' : 'mine', tipo: Object.hasOwn(CALENDAR_KINDS, params.get('tipo')) ? params.get('tipo') : 'all',
    cliente: /^[1-9]\d*$/.test(client || '') && positive(Number(client)) ? client : '',
    pagina: params.getAll('pagina').length === 1 && ![...params.keys()].some(key => key.startsWith('pagina[')) ? pageNumber(params.get('pagina')) : 0 };
}
export function calendarHref(selection) {
  const params = new URLSearchParams({ mes: selection.mes, dia: selection.dia, scope: selection.scope, tipo: selection.tipo });
  if (selection.vista === 'publicaciones') { params.delete('scope'); params.delete('tipo'); }
  if (selection.formato) params.set('formato',selection.formato);
  if (selection.cliente) params.set('cliente', selection.cliente);
  params.set('pagina', String(Number.isSafeInteger(selection.pagina) && selection.pagina >= 0 && selection.pagina <= MAX_CALENDAR_PAGE ? selection.pagina : 0));
  return `/calendario?${params}`;
}
export function calendarGrid(mes) {
  if (!supportedMonth(mes)) throw new Error('Mes fuera del rango de calendario disponible.');
  const first = `${mes}-01`, date = new Date(`${first}T00:00:00Z`);
  const desde = addCalendarDays(first, -((date.getUTCDay() + 6) % 7));
  date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0);
  const last = date.toISOString().slice(0, 10), hasta = addCalendarDays(last, 7 - ((date.getUTCDay() + 6) % 7));
  if (!calendarDay(desde) || !calendarDay(hasta)) throw new Error('Rango de calendario inválido.');
  const days = []; for (let day = desde; day < hasta; day = addCalendarDays(day, 1)) days.push(day);
  return { desde, hasta, days };
}
export function shiftCalendarMonth(selection, delta) {
  const date = new Date(`${selection.mes}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta);
  const mes = date.toISOString().slice(0, 7);
  return supportedMonth(mes) ? { ...selection, mes, dia: `${mes}-01`, pagina: 0 } : selection;
}
export function calendarQuery(selection, { offset = (selection.pagina || 0) * CALENDAR_PAGE_LIMIT, snapshot } = {}) {
  const grid = calendarGrid(selection.mes);
  if (!Number.isSafeInteger(offset) || offset < 0 || !calendarDay(selection.dia) || selection.dia < grid.desde || selection.dia >= grid.hasta) throw new Error('Página o día de calendario inválido.');
  const params = new URLSearchParams({ desde: grid.desde, hasta: grid.hasta, scope: selection.scope, kind: selection.tipo });
  if (selection.vista === 'publicaciones') { params.delete('scope'); params.delete('kind'); params.set('vista', 'publicaciones'); }
  if (selection.formato) params.set('formato',selection.formato);
  if (selection.cliente) params.set('cliente_id', selection.cliente);
  params.set('dia', selection.dia); params.set('limit', String(CALENDAR_PAGE_LIMIT)); params.set('offset', String(offset));
  if (snapshot !== undefined) {
    if (!calendarSnapshot(snapshot)) throw new Error('Versión de calendario inválida.');
    params.set('expected_snapshot', snapshot);
  }
  return `/api/calendario?${params}`;
}
// Principal Calendar deliberately retires scope/type preferences. Keep legacy
// helpers compatible for existing API consumers, not as hidden UI filters.
export function readPublicationCalendarSelection(search, today = cordobaToday()) {
  const formato=new URLSearchParams(search).get('formato');
  return { ...readCalendarSelection(search, today), scope: 'team', tipo: 'all', vista: 'publicaciones', ...(['reel','carrusel'].includes(formato)?{formato}: {}) };
}
export function publicationPlanningHref(selection, create = false) {
  const params = new URLSearchParams({ tab: create ? 'planilla' : 'calendario', mes: selection.mes });
  if (selection.cliente && positive(Number(selection.cliente))) params.set('cliente', selection.cliente);
  return `/planificacion-publicaciones?${params}`;
}
function eventHref(row) {
  if (typeof row.href !== 'string' || !row.href.startsWith('/') || row.href.startsWith('//') || /[\s\\\u0000-\u001f\u007f]/.test(row.href)) throw new Error();
  const url = new URL(row.href, 'https://calendar.invalid');
  if (url.origin !== 'https://calendar.invalid' || url.hash || [...url.searchParams.keys()].some((key, i, all) => all.indexOf(key) !== i)) throw new Error();
  const p = url.searchParams, keys = [...p.keys()];
  if (row.source === 'tarea') {
    if (url.pathname !== '/workspace/tareas' || keys.length !== 1 || p.get('task') !== String(row.source_id)) throw new Error();
  } else if (row.source === 'visita') {
    if (url.pathname !== '/producciones' || keys.some(k => !['visita', 'mes'].includes(k)) || p.get('visita') !== row.source_id || (p.has('mes') && p.get('mes') !== row.date.slice(0, 7))) throw new Error();
  } else if (row.source === 'hito') {
    if (url.pathname !== '/proyectos' || keys.length !== 1 || !uuid(p.get('proyecto'))) throw new Error();
  } else {
    const story = row.source === 'historia';
    if (url.pathname !== (story ? '/planificacion-historias' : '/planificacion-publicaciones') || keys.length !== 3 ||
        p.get(story ? 'vista' : 'tab') !== (story ? 'checklist' : 'calendario') || p.get('cliente') !== String(row.cliente_id) || !month(p.get('mes'))) throw new Error();
  }
  return `${url.pathname}${url.search}`;
}
export function decodeCalendar(dto, selection) {
  const invalid = () => { throw new Error('No se pudo validar el calendario.'); };
  const grid = calendarGrid(selection.mes);
  if (!dto || dto.timezone !== 'America/Argentina/Cordoba' || dto.range?.desde !== grid.desde || dto.range?.hasta !== grid.hasta ||
      dto.scope !== selection.scope || dto.kind !== selection.tipo || typeof dto.truncated !== 'boolean' || !Array.isArray(dto.clients) || !Array.isArray(dto.events) || dto.events.length > 2000) invalid();
  const clients = dto.clients.map(c => { if (!positive(c?.id) || typeof c.nombre !== 'string' || c.nombre.length > 250) invalid(); return { id: c.id, nombre: c.nombre }; });
  if (new Set(clients.map(c => c.id)).size !== clients.length) invalid();
  const seen = new Set();
  const events = dto.events.map(row => {
    if (selection.vista === 'publicaciones' && !(row?.source === 'visita' && row.kind === 'visita'
      || row?.source === 'publicacion' && ['programacion', 'publicacion'].includes(row.kind))) invalid();
    if (!row || !['tarea', 'visita', 'hito', 'programacion', 'publicacion'].includes(row.kind) ||
        (selection.tipo !== 'all' && row.kind !== selection.tipo) || !calendarDay(row.date) || row.date < grid.desde || row.date >= grid.hasta ||
        !((row.kind === 'tarea' && row.source === 'tarea' && positive(row.source_id)) || (row.kind === 'visita' && row.source === 'visita' && uuid(row.source_id)) ||
          (row.kind === 'hito' && row.source === 'hito' && uuid(row.source_id)) ||
          (['programacion', 'publicacion'].includes(row.kind) && ['historia', 'publicacion'].includes(row.source) && positive(row.source_id))) ||
        row.key !== `${row.kind}:${row.source}:${row.source_id}` || seen.has(row.key) || typeof row.title !== 'string' || row.title.length > 160 ||
        !(row.cliente_id === null || positive(row.cliente_id)) || (row.kind !== 'tarea' && !positive(row.cliente_id)) || (row.cliente_id === null ? row.cliente_nombre !== null : typeof row.cliente_nombre !== 'string' || row.cliente_nombre.length > 250) ||
        (selection.cliente && row.cliente_id !== Number(selection.cliente)) || !(row.estado === null || typeof row.estado === 'string' && row.estado.length <= 80) ||
        (row.kind === 'hito' && !['pendiente', 'completado', 'cancelado'].includes(row.estado)) ||
        !Array.isArray(row.responsable_ids) || !row.responsable_ids.every(positive)) invalid();
    let evidence = null;
    if (row.kind === 'publicacion') {
      const item = { id: row.source_id, cliente_id: row.cliente_id, estado: row.estado, 'fecha_publicación_real': row.evidence?.confirmation?.occurred_at, publicacion_evidencia: row.evidence };
      if (!isConfirmedPublication(item) || confirmationDate(item) !== row.date) invalid();
      const proof = row.evidence.confirmation;
      evidence = { classification: 'confirmada_manualmente', revision: row.evidence.revision, confirmation: { id: proof.id, actor_id: proof.actor_id, occurred_at: proof.occurred_at, recorded_at: proof.recorded_at, source: 'manual' } };
    } else if (row.evidence !== null) invalid();
    let href; try { href = eventHref(row); } catch { invalid(); }
    seen.add(row.key);
    return { key: row.key, kind: row.kind, source: row.source, source_id: row.source_id, date: row.date, title: row.title, cliente_id: row.cliente_id,
      cliente_nombre: row.cliente_nombre, estado: row.estado, href, responsable_ids: [...new Set(row.responsable_ids)], evidence };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  return { range: { desde: grid.desde, hasta: grid.hasta }, scope: dto.scope, kind: dto.kind, timezone: dto.timezone, clients, events, truncated: dto.truncated };
}
const compareCalendarEvents = (a, b) => {
  for (const key of ['date', 'kind', 'key']) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; }
  return 0;
};
export function decodePagedCalendar(dto, selection, { offset = (selection.pagina || 0) * CALENDAR_PAGE_LIMIT, snapshot } = {}) {
  const invalid = () => { throw new Error('No se pudo validar la página del calendario.'); };
  const p = dto?.pagination, grid = calendarGrid(selection.mes);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  if (!p || p.version !== 1 || p.limit !== CALENDAR_PAGE_LIMIT || p.offset !== offset || !count(p.offset) || !count(p.total)
    || !calendarSnapshot(p.snapshot) || (snapshot !== undefined && p.snapshot !== snapshot)
    || p.day !== selection.dia || !Array.isArray(p.days) || p.days.length > grid.days.length || !Array.isArray(dto.events)
    || dto.events.length !== Math.min(p.limit, Math.max(0, p.total - offset)) || dto.truncated !== (dto.events.length < p.total)
    || p.has_more !== (offset + dto.events.length < p.total)) invalid();
  if (dto.events.some((row, index, rows) => row?.date !== p.day || (index > 0 && compareCalendarEvents(rows[index - 1], row) >= 0))) invalid();
  const decoded = decodeCalendar(dto, selection);
  let previous = '', total = 0;
  const seen = new Set();
  const days = p.days.map(day => {
    if (!calendarDay(day?.date) || day.date < grid.desde || day.date >= grid.hasta || day.date <= previous || !count(day.total) || day.total === 0
      || !Array.isArray(day.preview) || day.preview.length !== Math.min(2, day.total)
      || day.preview.some((row, index, rows) => row?.date !== day.date || (index > 0 && compareCalendarEvents(rows[index - 1], row) >= 0))) invalid();
    previous = day.date; total += day.total; if (!count(total)) invalid();
    const preview = decodeCalendar({ ...dto, events: day.preview }, selection).events.sort(compareCalendarEvents);
    for (const row of preview) { if (seen.has(row.key)) invalid(); seen.add(row.key); }
    return { date: day.date, total: day.total, preview };
  });
  if ((days.find(day => day.date === p.day)?.total || 0) !== p.total) invalid();
  decoded.events.sort(compareCalendarEvents);
  if (!offset && JSON.stringify(days.find(day => day.date === p.day)?.preview || []) !== JSON.stringify(decoded.events.slice(0, 2))) invalid();
  return { ...decoded, events: decoded.events.sort(compareCalendarEvents), pagination: {
    version: 1, limit: p.limit, offset, total: p.total, has_more: p.has_more, snapshot: p.snapshot, day: p.day, days,
  } };
}
export function calendarEventLabel(event) {
  return ({ tarea: 'Entrega de tarea', visita: 'Visita de producción', hito: 'Hito de proyecto', programacion: 'Programación editorial', publicacion: 'Publicación confirmada manualmente' })[event.kind];
}
export function calendarEventTitle(event) {
  const prefix = `${calendarEventLabel(event)} · `;
  return event.title.startsWith(prefix) ? event.title.slice(prefix.length) || event.title : event.title;
}
export function calendarPublicationLabel(event) {
  const title = calendarEventTitle(event);
  return /^Carrusel(?:\s|$)/i.test(title) ? 'Carrusel' : /^Reel(?:\s|$)/i.test(title) ? 'Reel' : 'Contenido';
}
export function calendarTaskState(value) {
  return ({ pendiente: 'Pendiente', en_progreso: 'En progreso', en_revision: 'En revisión', aprobada: 'Aprobada', finalizada: 'Finalizada', publicada: 'Finalizada' })[value] || 'Estado de trabajo sin clasificar';
}
export function calendarMilestoneState(value) {
  return ({ pendiente: 'Hito pendiente', completado: 'Hito completado', cancelado: 'Hito cancelado' })[value] || 'Estado de hito sin clasificar';
}
export function calendarMonthContext(selection) {
  const params = new URLSearchParams(calendarQuery(selection).split('?')[1]);
  params.delete('dia');params.delete('offset');params.delete('expected_snapshot');
  return params.toString();
}
export function decodeCalendarMonth(dto,selection) {
  const p=dto?.pagination;
  if(!p||p.version!==1||p.limit!==CALENDAR_PAGE_LIMIT||p.offset!==0||p.day!==null||!calendarSnapshot(p.snapshot)||!Number.isSafeInteger(p.total)||p.total<0||!Array.isArray(dto.events)||!Array.isArray(p.days))throw Error('Mes no verificable.');
  if(p.total>CALENDAR_PAGE_LIMIT){if(p.has_more!==true||dto.truncated!==true||dto.events.length!==CALENDAR_PAGE_LIMIT)throw Error('Mes incompleto.');return null;}
  if(p.total>CALENDAR_PAGE_LIMIT||dto.events.length!==p.total||p.has_more!==false||dto.truncated!==false)throw Error('Mes incompleto.');
  const data=decodeCalendar(dto,{...selection,cliente:'',formato:undefined});
  const days=new Map();
  for(const event of data.events){if(!days.has(event.date))days.set(event.date,[]);days.get(event.date).push(event);}
  if(p.days.length!==days.size)throw Error('Recuento mensual inválido.');
  let previous='';
  for(const day of p.days){const expected=days.get(day.date);if(!expected||day.date<=previous||day.total!==expected.length||!Array.isArray(day.preview))throw Error('Recuento mensual inválido.');previous=day.date;const preview=decodeCalendar({...dto,events:day.preview},{...selection,cliente:'',formato:undefined}).events;if(JSON.stringify(preview)!==JSON.stringify(expected.slice(0,2)))throw Error('Resumen mensual inválido.');}
  return {...data,snapshot:p.snapshot};
}
export function calendarMonthDay(data,selection) {
  const rows=data.events.filter(event=>(!selection.cliente||event.cliente_id===Number(selection.cliente))&&(!selection.formato||calendarPublicationLabel(event)===(selection.formato==='reel'?'Reel':'Carrusel')));
  const days=new Map();for(const event of rows){if(!days.has(event.date))days.set(event.date,[]);days.get(event.date).push(event);}
  const dayRows=days.get(selection.dia)||[],offset=(selection.pagina||0)*CALENDAR_PAGE_LIMIT;
  const events=dayRows.slice(offset,offset+CALENDAR_PAGE_LIMIT);
  return {...data,events,truncated:events.length<dayRows.length,pagination:{version:1,limit:CALENDAR_PAGE_LIMIT,offset,total:dayRows.length,has_more:offset+events.length<dayRows.length,snapshot:data.snapshot,day:selection.dia,days:[...days].map(([date,rows])=>({date,total:rows.length,preview:rows.slice(0,2)}))}};
}
export function createCalendarLoader({ request, sesion, readSession, onInvalidated = () => {}, now = Date.now, monthly = false }) {
  let generation = 0, controller = null, disposed = false, anchor = null;
  let recentMonth = null;
  const recentDays = new Map();
  let completeMonth=null;
  let monthFallback=null;
  let previousMonth=null;
  const guard = createEditorialSessionGuard(sesion, readSession, onInvalidated);
  return {
    // Display-only while renewing; never authorizes a write or suppresses the
    // normal refresh. The caller must label this observation as updating.
    peek(selection) {
      if(!monthly||disposed||selection.vista!=='publicaciones'||!guard.isCurrent()||!previousMonth||now()-previousMonth.at>120000)return undefined;
      const key=calendarMonthContext({...selection,cliente:'',formato:undefined,pagina:0});
      return previousMonth.key===key ? calendarMonthDay(previousMonth.data,selection) : undefined;
    },
    async load(selection, { refresh = false } = {}) {
      controller?.abort(); const version = ++generation;
      if (disposed) return undefined;
      if (!guard.isCurrent()) throw new Error('La sesión cambió. Volvé a abrir el calendario desde la sesión actual.');
      const context = calendarMonthContext(selection);
      if (refresh || recentMonth?.context !== context || now()-recentMonth.at >= 15000) {recentMonth=null;recentDays.clear();}
      if (selection.vista === 'publicaciones' && !selection.pagina && recentMonth) {
        const saved = recentDays.get(selection.dia);
        if (saved) return saved;
        const summary = recentMonth.data.pagination.days.find(day=>day.date===selection.dia);
        if (!summary || summary.total === summary.preview.length) {
          return {...recentMonth.data,events:summary?.preview || [],truncated:false,pagination:{...recentMonth.data.pagination,day:selection.dia,offset:0,total:summary?.total || 0,has_more:false}};
        }
      }
      controller = new AbortController();
      const signal = controller.signal;
      const stale = () => disposed || version !== generation || !guard.isCurrent();
      try {
        if(monthly&&selection.vista==='publicaciones'){
          const monthSelection={...selection,cliente:'',formato:undefined,pagina:0};
          const key=calendarMonthContext(monthSelection);
          if(refresh||completeMonth?.key!==key||now()-completeMonth.at>=15000)completeMonth=null;
          if(refresh||monthFallback?.key!==key||now()-monthFallback.at>=15000)monthFallback=null;
          if(!completeMonth&&!monthFallback){
            const url=new URL(calendarQuery(monthSelection),'https://calendar.invalid');url.searchParams.delete('dia');
            const raw=await guard.request(request,url.pathname+url.search,{method:'GET',cache:'no-store',signal});
            if(stale())return undefined;
            const data=decodeCalendarMonth(raw,monthSelection);
            if(data){completeMonth={key,data,at:now()};previousMonth=completeMonth;}else {monthFallback={key,at:now()};previousMonth=null;}
          }
          if(completeMonth)return calendarMonthDay(completeMonth.data,selection);
        }
        const offset = (selection.pagina || 0) * CALENDAR_PAGE_LIMIT;
        const base = calendarQuery(selection, { offset: 0 });
        if (refresh || anchor?.base !== base) anchor = null;
        const read = async (offset, snapshot) => {
          const raw = await guard.request(request, calendarQuery(selection, { offset, snapshot }), { method: 'GET', cache: 'no-store', signal });
          if (stale()) return undefined;
          return decodePagedCalendar(raw, selection, { offset, snapshot });
        };
        if (!offset || !anchor) {
          const first = await read(0);
          if (!first || stale()) return undefined;
          if (selection.vista === 'publicaciones') {
            // A new server snapshot supersedes every previously remembered day.
            if (recentMonth?.data.pagination.snapshot !== first.pagination.snapshot) recentDays.clear();
            recentMonth={context,data:first,at:now()};recentDays.set(selection.dia,first);
          }
          anchor = { base, snapshot: first.pagination.snapshot };
          if (!offset) return first;
        }
        return await read(offset, anchor.snapshot);
      } catch (error) {
        if (stale()) return undefined;
        anchor = null;
        recentMonth=null;recentDays.clear();
        completeMonth=null;
        monthFallback=null;
        previousMonth=null;
        if (error?.status === 409) throw new Error('El calendario cambió. Reintentá explícitamente para consultar una versión actualizada.');
        throw new Error('No se pudo cargar el calendario. Reintentá la consulta.');
      }
    },
    cancel() { generation++; controller?.abort(); guard.cancel(); },
    dispose() { disposed = true; generation++; controller?.abort(); guard.cancel();recentMonth=null;recentDays.clear();completeMonth=null;monthFallback=null;previousMonth=null; },
  };
}
