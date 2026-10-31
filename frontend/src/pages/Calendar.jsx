import React, { useEffect, useRef, useState } from 'react';
import { FilterSelect } from '../components/FilterSelect.jsx';
import { Modal } from '../components/Modal.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { sessionViewKey } from '../shared/session/session-view.js';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { CALENDAR_PAGE_LIMIT, MAX_CALENDAR_PAGE, calendarPublicationLabel, calendarMonthContext, calendarGrid, calendarHref, calendarQuery, cordobaToday, createCalendarLoader, readPublicationCalendarSelection as readCalendarSelection, publicationPlanningHref, shiftCalendarMonth } from './calendarModel.js';
import './Calendar.css';
import './OperationalCalendars.css';
import {calendarDateLabel as dateLabel} from './calendarDateLabel.js';

const eventCount = count => `${count} ${count === 1 ? "publicación" : "publicaciones"}`;
export function CalendarPage({ sesion, onNavigate }) {
  return <CalendarContent key={sessionViewKey(sesion)} sesion={sesion} onNavigate={onNavigate} />;
}
function CalendarContent({ sesion, onNavigate }) {
  const [selection, setSelection] = useState(() => readCalendarSelection(window.location.search));
  const [result, setResult] = useState({ key: null, status: 'loading', data: null, error: '' }), [retry, setRetry] = useState(0);
  const [dayOpen,setDayOpen]=useState(false);
  const dayTrigger=useRef(null);
  const loader = useRef(null), generation = useRef(0);
  const today = cordobaToday(), grid = calendarGrid(selection.mes);
  const selectionKey = calendarHref(selection);
  const requestKey = calendarQuery(selection);
  const monthContext = calendarMonthContext(selection);
  const requestObservation = useRef(null), lastRetry = useRef(retry);
  if (!requestObservation.current || requestObservation.current.key !== requestKey || requestObservation.current.retry !== retry) requestObservation.current = { key: requestKey, retry };
  useEffect(() => {
    const instance = createCalendarLoader({ request: apiRequest, sesion, readSession: getSesion, monthly:true,
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
    if (`${window.location.pathname}${window.location.search}` !== canonical) {
      window.history.replaceState(window.history.state, '', canonical);
      notifyViewPreferenceChange(window);
    }
  }, [selectionKey]);
  useEffect(() => {
    const version = ++generation.current;
    const observation = requestObservation.current;
    const current = () => version === generation.current && requestObservation.current === observation;
    const refresh = lastRetry.current !== retry; lastRetry.current = retry;
    const preview=loader.current?.peek?.(selection);
    if(!current())return;
    setResult(previous=>({ key: requestKey, attempt: retry, observation, status: 'loading', data: null, preview, error: '', catalog:previous.data?.clients||previous.catalog||[], monthContext, monthData:preview || (previous.monthContext===monthContext ? previous.data || previous.monthData : null) }));
    loader.current?.load(selection, { refresh }).then(data => { if (data && current()) setResult({ key: requestKey, attempt: retry, observation, status: 'ready', data, catalog:data.clients, monthContext, monthData:data, error: '' }); })
      .catch(error => { if (current()) setResult(previous=>({ key: requestKey, attempt: retry, observation, status: 'error', data: null, catalog:previous.data?.clients||previous.catalog||[], error: error.message })); });
    return () => { generation.current++; loader.current?.cancel(); };
  }, [requestKey, retry]);
  function change(fields) {
    const changesContext = ['mes', 'dia', 'cliente', 'formato'].some(key => Object.hasOwn(fields, key));
    const next = readCalendarSelection(new URL(calendarHref({ ...selection, ...fields, ...(changesContext ? { pagina: 0 } : {}) }), window.location.origin).search, today);
    if (navigateWithinApp(window, calendarHref(next))) notifyViewPreferenceChange(window);
  }
  function follow(event, href) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); if (onNavigate) onNavigate(href); else navigateWithinApp(window, href);
  }
  const status = (result.key === requestKey && result.attempt === retry && result.observation === requestObservation.current) || (result.key === null && result.status === 'error') ? result.status : 'loading';
  const data = status === 'ready' ? result.data : status==='loading'&&result.key===requestKey&&result.observation===requestObservation.current ? result.preview || null : null;
  const monthData = data || (status==='loading' && result.monthContext===monthContext ? result.data || result.monthData : null);
  const catalog = data?.clients || result.catalog || [];
  const byDay = new Map((monthData?.pagination.days || []).map(day => [day.date, day]));
  const agenda = data?.events || [];
  return <main className="principal-calendar" aria-label="Calendario"><div className="principal-calendar-shell">
    <header className="principal-calendar-header"><h1>Calendario</h1><a className="principal-calendar-add" href={publicationPlanningHref(selection, true)} onClick={event => follow(event, publicationPlanningHref(selection, true))}>+ Agregar contenido</a></header>
    <div className="principal-calendar-toolbar">
      <div className="principal-calendar-filters">
        <FilterSelect label="Cliente" value={selection.cliente} onChange={event => change({ cliente: event.target.value })}><option value="">Todos los clientes</option>{selection.cliente && !catalog.some(c => String(c.id) === selection.cliente) && <option value={selection.cliente}>Cliente #{selection.cliente}</option>}{catalog.map(client => <option key={client.id} value={client.id}>{client.nombre}</option>)}</FilterSelect>
        <FilterSelect label="Contenido" value={selection.formato || ''} onChange={event=>change({formato:event.target.value})}><option value="">Todos</option><option value="reel">Reels</option><option value="carrusel">Carruseles</option></FilterSelect></div>
    </div>
    {status === "loading" && !monthData && <p role="status">Cargando calendario…</p>}
    {status === 'loading' && data && <p role="status">Actualizando calendario…</p>}
    {status === 'error' && <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button>{selection.pagina > 0 && <button type="button" onClick={() => change({ pagina: 0 })}>Primera página</button>}</div>}
    {data?.truncated && <p className="principal-calendar-notice" role="status">Agenda paginada: se muestran {agenda.length} de {data.pagination.total} eventos del día. Los recuentos del calendario incluyen todos los eventos.</p>}
    <div className="principal-calendar-layout principal-calendar-full"><section className="principal-calendar-month-view" aria-label="Selector de día">
      <header className="principal-calendar-month"><button type="button" aria-label="Mes anterior" onClick={() => change(shiftCalendarMonth(selection, -1))}>‹</button><h2>{dateLabel(`${selection.mes}-01`, { month: 'long', year: 'numeric' })}</h2><button className="calendar-today" type="button" onClick={()=>change({mes:today.slice(0,7),dia:today})}>Hoy</button><button type="button" aria-label="Mes siguiente" onClick={() => change(shiftCalendarMonth(selection, 1))}>›</button></header>
      <div className="principal-calendar-weekdays" aria-hidden="true">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="principal-calendar-grid">{grid.days.map(day => { const summary = byDay.get(day), count = summary?.total || 0, events = summary?.preview || []; if(!day.startsWith(selection.mes))return <span key={day} aria-hidden="true"/>; return <button type="button" key={day} className={day === selection.dia ? 'selected' : ''} aria-pressed={day === selection.dia} aria-current={day === today ? 'date' : undefined} aria-haspopup="dialog" aria-label={`${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}${monthData ? ` · ${eventCount(count)}` : ''}`} onClick={event => {dayTrigger.current=event.currentTarget;setDayOpen(true);change({ mes: day.slice(0, 7), dia: day });}}>
        <span>{Number(day.slice(-2))}</span>{monthData && count > 0 && <small>{count}<span className="principal-calendar-count-label"> {count === 1 ? 'evento' : 'eventos'}</span></small>}
        <div className="principal-calendar-day-preview">{events.map(item => <span key={item.key} title={`${calendarPublicationLabel(item)} · ${item.cliente_nombre}`}><strong>{item.cliente_nombre}</strong><span>{calendarPublicationLabel(item)}</span></span>)}{count>events.length&&<em>+{count-events.length} más</em>}</div>
      </button>; })}</div></section>
      </div>{dayOpen&&<Modal native closeOnBackdropClick className="calendar-day-dialog" overlayClassName="calendar-day-overlay" overlayAriaLabel="Publicaciones del día" title="Publicaciones del día" onClose={()=>setDayOpen(false)} returnFocusRef={dayTrigger}>
      <section className="principal-calendar-agenda" aria-label="Agenda del día"><header><h2>{dateLabel(selection.dia, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>{data && <p>{eventCount(data.pagination.total)}</p>}</header>
        {status==='loading'&&<p role="status">{data?'Actualizando publicaciones…':'Cargando publicaciones…'}</p>}
        {status==='error'&&<div role="alert"><p>{result.error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Reintentar</button></div>}
        {data && agenda.length === 0 && <p>{status==='loading' ? 'Consultando las publicaciones actuales de este día…' : data.pagination.total > 0 ? 'Esta página está fuera de los resultados actuales. Volvé a la primera página.' : 'No hay publicaciones para este día.'}</p>}
        {data && (selection.pagina>0 || data.pagination.has_more) && <nav className="principal-calendar-month" aria-label="Páginas de agenda">
          <button type="button" disabled={selection.pagina === 0} onClick={() => change({ pagina: selection.pagina - 1 })}>Anterior</button>
          <span>Página {selection.pagina + 1} · hasta {CALENDAR_PAGE_LIMIT} eventos por página</span>
          <button type="button" disabled={!data.pagination.has_more || selection.pagina >= MAX_CALENDAR_PAGE} onClick={() => change({ pagina: selection.pagina + 1 })}>Siguiente</button>
          {selection.pagina > 0 && <button type="button" onClick={() => change({ pagina: 0 })}>Primera página</button>}
        </nav>}
        {data && <ol>{agenda.map(item => <li key={item.key}><h3>{calendarPublicationLabel(item)}</h3><p>{item.cliente_nombre || 'Sin cliente'}</p>
        </li>)}</ol>}
      </section></Modal>}
  </div></main>;
}
