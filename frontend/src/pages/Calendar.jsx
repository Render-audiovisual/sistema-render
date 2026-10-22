import React, { useEffect, useRef, useState } from 'react';
import { FilterSelect } from '../components/FilterSelect.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { CALENDAR_KINDS, calendarEventLabel, calendarEventTitle, calendarGrid, calendarHref, calendarMilestoneState, calendarQuery, calendarTaskState, cordobaToday, createCalendarLoader, readCalendarSelection, shiftCalendarMonth } from './calendarModel.js';
import './Calendar.css';

const dateLabel = (day, options) => {
  const label = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', ...options }).format(new Date(`${day}T00:00:00Z`));
  return label.charAt(0).toLocaleUpperCase('es-AR') + label.slice(1);
};
const eventCount = count => `${count} ${count === 1 ? 'evento' : 'eventos'}`;
export function CalendarPage({ sesion, onNavigate }) {
  return <CalendarContent key={`${sesion?.usuario?.id}:${sesion?.usuario?.rol}:${sesion?.token || ''}`} sesion={sesion} onNavigate={onNavigate} />;
}
function CalendarContent({ sesion, onNavigate }) {
  const [selection, setSelection] = useState(() => readCalendarSelection(window.location.search));
  const [result, setResult] = useState({ key: null, status: 'loading', data: null, error: '' }), [retry, setRetry] = useState(0);
  const loader = useRef(null), generation = useRef(0);
  const today = cordobaToday(), grid = calendarGrid(selection.mes);
  const selectionKey = calendarHref(selection);
  const requestKey = calendarQuery(selection);
  useEffect(() => {
    const instance = createCalendarLoader({ request: apiRequest, sesion, readSession: getSesion,
      onInvalidated: () => { generation.current++; setResult({ key: null, status: 'error', data: null, error: 'La sesión cambió. Volvé a abrir el calendario desde la sesión actual.' }); } });
    loader.current = instance;
    return () => { instance.dispose(); if (loader.current === instance) loader.current = null; };
  }, []);
  useEffect(() => {
    const restore = () => setSelection(readCalendarSelection(window.location.search));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const canonical = calendarHref(readCalendarSelection(window.location.search));
    if (`${window.location.pathname}${window.location.search}` !== canonical) window.history.replaceState(window.history.state, '', canonical);
  }, [selectionKey]);
  useEffect(() => {
    const version = ++generation.current;
    setResult({ key: requestKey, status: 'loading', data: null, error: '' });
    loader.current?.load(selection).then(data => { if (data && version === generation.current) setResult({ key: requestKey, status: 'ready', data, error: '' }); })
      .catch(error => { if (version === generation.current) setResult({ key: requestKey, status: 'error', data: null, error: error.message }); });
    return () => { generation.current++; loader.current?.cancel(); };
  }, [requestKey, retry]);
  function change(fields) {
    const next = readCalendarSelection(new URL(calendarHref({ ...selection, ...fields }), window.location.origin).search, today);
    navigateWithinApp(window, calendarHref(next));
  }
  function follow(event, href) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); if (onNavigate) onNavigate(href); else navigateWithinApp(window, href);
  }
  const status = result.key === requestKey || (result.key === null && result.status === 'error') ? result.status : 'loading';
  const data = status === 'ready' ? result.data : null;
  const byDay = new Map(); for (const event of data?.events || []) { if (!byDay.has(event.date)) byDay.set(event.date, []); byDay.get(event.date).push(event); }
  const agenda = byDay.get(selection.dia) || [];
  return <main className="principal-calendar" aria-label="Calendario"><div className="principal-calendar-shell">
    <header className="principal-calendar-header"><div><h1>Calendario</h1><p>Entregas, visitas, hitos y contenido · Córdoba</p></div><button type="button" onClick={() => setRetry(value => value + 1)} disabled={status === 'loading'}>Actualizar</button></header>
    <div className="principal-calendar-toolbar"><div className="principal-calendar-month"><button type="button" aria-label="Mes anterior" onClick={() => change(shiftCalendarMonth(selection, -1))}>‹</button><h2>{dateLabel(`${selection.mes}-01`, { month: 'long', year: 'numeric' })}</h2><button type="button" aria-label="Mes siguiente" onClick={() => change(shiftCalendarMonth(selection, 1))}>›</button><button type="button" onClick={() => change({ mes: today.slice(0, 7), dia: today })}>Hoy</button></div>
      <div className="principal-calendar-filters"><FilterSelect label="Ámbito" value={selection.scope} onChange={event => change({ scope: event.target.value })}><option value="mine">Lo mío</option><option value="team">Equipo</option></FilterSelect>
        <FilterSelect label="Tipo" value={selection.tipo} onChange={event => change({ tipo: event.target.value })}>{Object.entries(CALENDAR_KINDS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</FilterSelect>
        <FilterSelect label="Cliente" value={selection.cliente} onChange={event => change({ cliente: event.target.value })}><option value="">Todos los clientes</option>{selection.cliente && !data?.clients.some(c => String(c.id) === selection.cliente) && <option value={selection.cliente}>Cliente #{selection.cliente}</option>}{data?.clients.map(client => <option key={client.id} value={client.id}>{client.nombre}</option>)}</FilterSelect></div>
    </div>
    {status === 'loading' && <p role="status">Cargando calendario…</p>}
    {status === 'error' && <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {data?.truncated && <p className="principal-calendar-notice" role="status">Vista parcial: hay más eventos que los mostrados. Acotá por cliente o tipo; los recuentos corresponden solo a esta vista.</p>}
    <div className="principal-calendar-layout"><section className="principal-calendar-month-view" aria-label="Selector de día"><div className="principal-calendar-weekdays" aria-hidden="true">{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="principal-calendar-grid">{grid.days.map(day => { const events = byDay.get(day) || []; return <button type="button" key={day} className={`${day.startsWith(selection.mes) ? '' : 'outside'} ${day === selection.dia ? 'selected' : ''}`} aria-pressed={day === selection.dia} aria-current={day === today ? 'date' : undefined} aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}${data ? ` · ${eventCount(events.length)} ${events.length === 1 ? 'mostrado' : 'mostrados'}` : ''}`} onClick={() => change({ mes: day.slice(0, 7), dia: day })}>
        <span>{Number(day.slice(-2))}</span>{data && events.length > 0 && <small>{events.length}<span className="principal-calendar-count-label"> {events.length === 1 ? 'evento' : 'eventos'}</span></small>}
        <div className="principal-calendar-day-preview" aria-hidden="true">{events.slice(0, 2).map(item => <span key={item.key}>{calendarEventTitle(item)}</span>)}</div>
      </button>; })}</div></section>
      <section className="principal-calendar-agenda" aria-label="Agenda del día"><header><h2>{dateLabel(selection.dia, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>{data && <p>{eventCount(agenda.length)} {data.truncated ? `${agenda.length === 1 ? 'mostrado' : 'mostrados'} · vista parcial` : 'en el día'}</p>}</header>
        {data && agenda.length === 0 && <p>{data.truncated ? 'No hay eventos mostrados para este día en la vista parcial.' : 'Sin eventos para este día con estos filtros.'}</p>}
        {data && <ol>{agenda.map(item => <li key={item.key}><small>{calendarEventLabel(item)}</small><h3>{calendarEventTitle(item)}</h3><p>{item.cliente_nombre || 'Sin cliente'}</p>
          {item.kind === 'tarea' && <span className="principal-calendar-state">{calendarTaskState(item.estado)}</span>}
          {item.kind === 'hito' && <span className="principal-calendar-state">{calendarMilestoneState(item.estado)}</span>}
          <a href={item.href} onClick={event => follow(event, item.href)}>{['historia', 'publicacion'].includes(item.source) ? 'Abrir contexto editorial' : item.kind === 'visita' ? 'Abrir visita' : item.kind === 'hito' ? 'Abrir proyecto' : 'Abrir tarea'} ↗</a>
        </li>)}</ol>}
      </section></div>
  </div></main>;
}
