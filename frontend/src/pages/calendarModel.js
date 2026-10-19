import { createEditorialSessionGuard } from '../components/EditorialPublicationControl.model.js';
import { confirmationDate, isConfirmedPublication } from '../shared/editorial/publication-evidence.js';

export const CALENDAR_KINDS = { all: 'Todos', tarea: 'Entregas de tareas', visita: 'Visitas', hito: 'Hitos de proyectos', programacion: 'Programación', publicacion: 'Publicaciones confirmadas' };
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
    cliente: /^[1-9]\d*$/.test(client || '') && positive(Number(client)) ? client : '' };
}
export function calendarHref(selection) {
  const params = new URLSearchParams({ mes: selection.mes, dia: selection.dia, scope: selection.scope, tipo: selection.tipo });
  if (selection.cliente) params.set('cliente', selection.cliente);
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
  return supportedMonth(mes) ? { ...selection, mes, dia: `${mes}-01` } : selection;
}
export function calendarQuery(selection) {
  const grid = calendarGrid(selection.mes);
  const params = new URLSearchParams({ desde: grid.desde, hasta: grid.hasta, scope: selection.scope, kind: selection.tipo });
  if (selection.cliente) params.set('cliente_id', selection.cliente);
  return `/api/calendario?${params}`;
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
export function calendarEventLabel(event) {
  return ({ tarea: 'Entrega de tarea', visita: 'Visita de producción', hito: 'Hito de proyecto', programacion: 'Programación editorial', publicacion: 'Publicación confirmada manualmente' })[event.kind];
}
export function calendarEventTitle(event) {
  const prefix = `${calendarEventLabel(event)} · `;
  return event.title.startsWith(prefix) ? event.title.slice(prefix.length) || event.title : event.title;
}
export function calendarTaskState(value) {
  return ({ pendiente: 'Pendiente', en_progreso: 'En progreso', en_revision: 'En revisión', aprobada: 'Aprobada', finalizada: 'Finalizada', publicada: 'Finalizada' })[value] || 'Estado de trabajo sin clasificar';
}
export function calendarMilestoneState(value) {
  return ({ pendiente: 'Hito pendiente', completado: 'Hito completado', cancelado: 'Hito cancelado' })[value] || 'Estado de hito sin clasificar';
}
export function createCalendarLoader({ request, sesion, readSession, onInvalidated = () => {} }) {
  let generation = 0, controller = null, disposed = false;
  const guard = createEditorialSessionGuard(sesion, readSession, onInvalidated);
  return {
    async load(selection) {
      controller?.abort(); const version = ++generation;
      if (disposed) return undefined;
      if (!guard.isCurrent()) throw new Error('La sesión cambió. Volvé a abrir el calendario desde la sesión actual.');
      controller = new AbortController();
      try {
        const raw = await guard.request(request, calendarQuery(selection), { signal: controller.signal });
        if (disposed || version !== generation || !guard.isCurrent() || !raw) return undefined;
        return decodeCalendar(raw, selection);
      } catch {
        if (disposed || version !== generation || !guard.isCurrent()) return undefined;
        throw new Error('No se pudo cargar el calendario. Reintentá la consulta.');
      }
    },
    cancel() { generation++; controller?.abort(); guard.cancel(); },
    dispose() { disposed = true; generation++; controller?.abort(); guard.cancel(); },
  };
}
