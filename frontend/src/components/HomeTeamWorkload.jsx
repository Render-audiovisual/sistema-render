import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { personalHomeNavigate, subscribePersonalHomeRefresh } from '../pages/personalHome.js';
import { canReadHomeEscalations } from './homeEscalations.js';
import { createHomeTeamLoader, homeTeamTaskHref, TEAM_LIMIT } from './homeTeamWorkload.js';

export function HomeTeamWorkload({ sesion, onNavigate, request = apiRequest }) {
  const id = sesion?.usuario?.id, role = sesion?.usuario?.rol, active = sesion?.usuario?.activo, token = sesion?.token;
  const identity = useMemo(() => ({ id, role, active, token }), [id, role, active, token]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [result, setResult] = useState(null);
  const loaderRef = useRef(null);
  const allowed = canReadHomeEscalations(sesion);
  const current = result?.identity === identity ? result : null;
  const data = allowed ? current?.data : null;
  const loading = !current || current.status === 'loading';
  useEffect(() => {
    if (!allowed) return undefined;
    const loader = createHomeTeamLoader({ sesion: { token, usuario: { id, rol: role, activo: active } },
      readSession: getSesion, request,
      onChange: state => { if (identityRef.current === identity) setResult({ ...state, identity }); } });
    loaderRef.current = loader;
    void loader.refresh();
    const unsubscribe = subscribePersonalHomeRefresh(loader);
    return () => { unsubscribe(); loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null; };
  }, [identity, allowed, request, id, role, active, token]);
  if (!allowed) return null;
  const refresh = () => { void loaderRef.current?.refresh(); };
  return <section className="qh-section" aria-labelledby="qh-team-title">
    <header className="qh-section-heading"><div><h2 id="qh-team-title">Trabajo del equipo</h2>
      <p>Tareas abiertas por integrante.</p></div>
      <button type="button" className="qh-refresh" disabled={loading} onClick={refresh}>Actualizar equipo</button>
    </header>
    {loading && <p className="qh-status" role="status">Cargando equipo…</p>}
    {current?.error && <div className="qh-error" role="alert"><p>{current.error}</p><button type="button" onClick={refresh}>Reintentar</button></div>}
    {data && <>
      <p className="qh-section-description">{data.total_tasks} tareas abiertas · {data.total_overdue} vencidas · {data.today}</p>
      <p className="qh-section-description">Sin asignación por ID: {data.unassigned.open} abiertas · {data.unassigned.overdue} vencidas.</p>
      <p className="qh-section-description">Incluye colaboradores. El total global no duplica tareas compartidas.</p>
      {data.items.length === 0 && <p className="qh-empty">No hay integrantes con tareas abiertas en esta página.</p>}
      <ul className="qh-compact-list">{data.items.map(item => {
        const href = homeTeamTaskHref(item.user.id);
        return <li key={item.user.id}><a className="qh-compact-row" href={href}
          onClick={event => personalHomeNavigate(event, href, onNavigate)}>
          <span><strong>{item.user.nombre} · #{item.user.id}{!item.user.activo && ' · Cuenta inactiva'}</strong>
            <small>{item.open} abiertas · {item.overdue} vencidas · {item.review} en revisión · {item.approved} aprobadas</small></span>
          <span aria-hidden="true">↗</span>
        </a></li>;
      })}</ul>
      <nav className="qh-section-heading" aria-label="Páginas del trabajo del equipo">
        <button type="button" disabled={data.offset === 0} onClick={() => { void loaderRef.current?.refresh({ offset: Math.max(0, data.offset - TEAM_LIMIT) }); }}>Anterior</button>
        <span className="qh-list-count">Página {data.offset / TEAM_LIMIT + 1} · {data.total_people} integrantes</span>
        <button type="button" disabled={!data.has_more || data.offset + TEAM_LIMIT > 1000000} onClick={() => { void loaderRef.current?.refresh({ offset: data.offset + TEAM_LIMIT }); }}>Siguiente</button>
      </nav>
    </>}
  </section>;
}
