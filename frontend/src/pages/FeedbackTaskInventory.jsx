import React, { useEffect, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { createFeedbackInventoryLoader, readInventoryLocation, inventoryLocationUrl } from './feedbackTaskInventory.js';
import './FeedbackTaskInventory.css';

const states = { pendiente: 'Pendiente', en_progreso: 'En progreso', en_revision: 'En revisión', aprobada: 'Trabajo aprobado', finalizada: 'Trabajo finalizado', publicada: 'Trabajo finalizado (estado histórico)', programada: 'Programada' };
function locationState() { try { return { selection: readInventoryLocation(window.location.search), error: '' }; } catch { return { selection: null, error: 'Los filtros de revisión no son válidos.' }; } }
export function FeedbackTaskInventory({ sesion, clients = [], request = apiRequest }) {
  return <Inventory key={`${sesion?.usuario?.id}:${sesion?.usuario?.rol}:${sesion?.usuario?.activo}:${sesion?.token}`} sesion={sesion} clients={clients} request={request}/>;
}
function Inventory({ sesion, clients, request }) {
  const [location, setLocation] = useState(locationState), [result, setResult] = useState(null), [reload, setReload] = useState(0);
  const [query, setQuery] = useState(location.selection?.q ?? ''), [client, setClient] = useState(location.selection?.cliente_id?.toString() ?? '');
  useEffect(() => { const sync = () => setLocation(locationState()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  useEffect(() => { setQuery(location.selection?.q ?? ''); setClient(location.selection?.cliente_id?.toString() ?? ''); }, [location]);
  useEffect(() => {
    if (!location.selection) return undefined;
    const loader = createFeedbackInventoryLoader({ sesion, readSession: getSesion, request, onChange: state => setResult({ ...state, location }) });
    void loader.load(location.selection); return () => loader.dispose();
  }, [location, reload, request]);
  const current = result?.location === location ? result : null, data = current?.data;
  const clientOptions = Array.isArray(clients) ? clients.filter(item => Number.isSafeInteger(item?.id) && item.id > 0 && item.id <= 2147483647 && typeof item.nombre === 'string') : [];
  const move = changes => { try { navigateWithinApp(window, inventoryLocationUrl(window.location.href, { ...(location.selection ?? {}), ...changes })); } catch { /* Keep URL and existing filters untouched. */ } };
  const openTask = (event, href) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigateWithinApp(window, href); };
  return <section className="rf-task-inventory" aria-label="Revisión de edición">
    <header className="rf-intro"><div><h2>Revisión de edición</h2><p>Entregas y decisiones de tareas reales, separadas de las notas. El historial de correcciones no significa que haya correcciones pendientes.</p></div></header>
    <form className="rf-task-inventory-filters" onSubmit={event => { event.preventDefault(); move({ q: query, cliente_id: client ? Number(client) : null, offset: 0 }); }}>
      <label>Vista<select value={location.selection?.view ?? 'all'} onChange={event => move({ view: event.target.value, offset: 0 })}>
        <option value="all">Todas</option><option value="awaiting_review">Para revisar</option><option value="with_corrections">Con historial de correcciones</option>
      </select></label>
      <label>Buscar tarea<input maxLength={200} value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label>Cliente<select value={client} onChange={event => setClient(event.target.value)}>
        <option value="">Todos los clientes</option>
        {client && !clientOptions.some(item => String(item.id) === client) && <option value={client}>Cliente no disponible (#{client})</option>}
        {clientOptions.map(item => <option key={item.id} value={String(item.id)}>{item.nombre}</option>)}
      </select></label>
      <button className="rf-back-tasks" type="submit">Buscar</button>
      <button className="rf-back-tasks" type="button" disabled={current?.status === 'loading'} onClick={() => setReload(n => n + 1)}>Actualizar</button>
    </form>
    {(location.error || current?.error) && <p role="alert">{location.error || current.error}</p>}
    {!location.error && (!current || current.status === 'loading') && <p role="status">Cargando revisión de edición…</p>}
    {data && <>
      <p role="status">{data.total} tareas en total · Página {Math.floor(data.offset / 20) + 1}</p>
      {data.items.length ? <ul className="rf-task-inventory-items">{data.items.map(task => <li key={task.task_id}>
        <a href={task.href} onClick={event => openTask(event, task.href)}>{task.titulo || 'Sin título'} · #{task.task_id}</a>
        <p>{task.cliente?.nombre || 'Sin cliente'} · Estado actual: {states[task.estado]}</p>
        <p>Última decisión: {task.latest_decision ? task.latest_decision.action === 'aprobada' ? 'Aprobación registrada' : 'Correcciones solicitadas' : 'Sin decisión registrada'}.</p>
        {task.has_corrections && <p>Con historial de correcciones.</p>}
      </li>)}</ul> : <p>No hay tareas para estos filtros.</p>}
      <nav aria-label="Páginas de revisión de edición">
        <button className="rf-back-tasks" type="button" disabled={data.offset === 0} onClick={() => move({ offset: Math.max(0, data.offset - 20) })}>Anterior</button>
        <button className="rf-back-tasks" type="button" disabled={!data.has_more} onClick={() => move({ offset: data.offset + 20 })}>Siguiente</button>
      </nav>
    </>}
  </section>;
}
