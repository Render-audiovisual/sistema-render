import React, { useEffect, useRef, useState } from 'react';
import { useSessionView } from '../shared/session/use-session-view.js';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { getHoyLocalISO } from '../shared/date/date-utils.js';
import { homeDeadline, homeStateLabel, personalHomeNavigate, subscribePersonalHomeRefresh } from '../pages/personalHome.js';
import { canReadHomeEscalations, createHomeEscalationsLoader, ESCALATIONS_LIMIT } from './homeEscalations.js';

export function HomeEscalations({ sesion, onNavigate, request = apiRequest }) {
  const view = useSessionView(sesion);
  const identity = view;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [result, setResult] = useState(null);
  const loaderRef = useRef(null);
  const allowed = canReadHomeEscalations(view.session);
  const current = result?.identity === identity ? result : null;
  const data = allowed ? current?.data : null;
  const loading = !current || current.status === 'loading';

  useEffect(() => {
    if (!allowed) return undefined;
    const loader = createHomeEscalationsLoader({ sesion: view.session, readSession: getSesion, request,
      onChange: state => { if (identityRef.current === identity) setResult({ ...state, identity }); } });
    loaderRef.current = loader;
    void loader.refresh();
    const unsubscribe = subscribePersonalHomeRefresh(loader);
    return () => { unsubscribe(); loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null; };
  }, [view, allowed, request]);

  if (!allowed) return null;
  const refresh = () => { void loaderRef.current?.refresh(); };
  const today = getHoyLocalISO();
  return <section className="qh-section" aria-labelledby="qh-escalations-title">
    <header className="qh-section-heading"><div><h2 id="qh-escalations-title">Escaladas a dirección</h2>
      <p>Cola de escalaciones; no es la cola de revisión.</p></div>
      {data && <span className="qh-list-count">{data.total} en total</span>}
      <button type="button" className="qh-refresh" disabled={loading} onClick={refresh}>Actualizar escaladas</button>
    </header>
    {loading && <p className="qh-status" role="status">Cargando escaladas…</p>}
    {current?.error && <div className="qh-error" role="alert"><p>{current.error}</p><button type="button" onClick={refresh}>Reintentar</button></div>}
    {data && <>
      {data.items.length === 0 && <p className="qh-section-description">No hay escaladas en esta página.</p>}
      <ol className="qh-task-list">{data.items.map(task => <li key={task.id}>
        <a className="qh-task-row" href={task.href} onClick={event => personalHomeNavigate(event, task.href, onNavigate)}>
          <span className="qh-row-main"><strong>{task.titulo}</strong><span className="qh-row-meta">
            {task.cliente?.nombre || 'Sin cliente'} · {homeStateLabel(task.estado)} · Prioridad {task.prioridad}
          </span></span>
          <span className={`qh-deadline${task.fecha_vencimiento && task.fecha_vencimiento < today ? ' is-overdue' : ''}`}>{homeDeadline(task.fecha_vencimiento, today)}</span>
          <span className="qh-row-arrow" aria-hidden="true">↗</span>
        </a>
      </li>)}</ol>
      <nav className="qh-section-heading" aria-label="Páginas de escaladas a dirección">
        <button type="button" disabled={data.offset === 0} onClick={() => { void loaderRef.current?.refresh({ offset: Math.max(0, data.offset - ESCALATIONS_LIMIT) }); }}>Anterior</button>
        <span className="qh-list-count">Página {data.offset / ESCALATIONS_LIMIT + 1} · {data.total} en total</span>
        <button type="button" disabled={!data.has_more} onClick={() => { void loaderRef.current?.refresh({ offset: data.offset + ESCALATIONS_LIMIT }); }}>Siguiente</button>
      </nav>
    </>}
  </section>;
}

export default HomeEscalations;
