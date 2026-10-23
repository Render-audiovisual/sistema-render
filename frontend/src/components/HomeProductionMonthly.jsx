import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionView } from '../shared/session/use-session-view.js';
import { getSesion } from '../utils.jsx';
import { createHomeProductionPageLoader, PRODUCTION_PAGE_LIMIT } from './homeProductionPage.js';

export function HomeProductionMonthly({ data, period, sesion, request }) {
  const view = useSessionView(sesion);
  const scope = useMemo(() => ({ period, view }), [period, view]);
  const snapshot = useMemo(() => ({ data, scope, request }), [data, scope, request]);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const initialSnapshot = useRef(snapshot);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const offsetRef = useRef({ scope, offset: 0 });
  if (offsetRef.current.scope !== scope) offsetRef.current = { scope, offset: 0 };
  const [result, setResult] = useState(null);
  const loaderRef = useRef(null);
  const current = result?.scope === scope && result.snapshot === snapshot ? result : null;
  const page = current ? current.data : snapshot === initialSnapshot.current
    ? { ...data, offset: 0, has_more: data.client_count > PRODUCTION_PAGE_LIMIT } : null;
  const loading = current?.status === 'loading' || (!current && !page);
  useEffect(() => {
    const loader = createHomeProductionPageLoader({ sesion: view.session, period,
      readSession: getSesion, request, onChange: state => {
        if (scopeRef.current === scope && snapshotRef.current === snapshot) setResult({ ...state, scope, snapshot });
      } });
    const binding = { loader, snapshot };
    loaderRef.current = binding;
    // The first page is already verified by Home. Later snapshots re-read the
    // selected offset instead of treating their first-page data as a reset.
    if (snapshot !== initialSnapshot.current) void loader.refresh({ offset: offsetRef.current.offset });
    return () => { loader.dispose(); if (loaderRef.current === binding) loaderRef.current = null; };
  }, [snapshot, scope, view, period, request]);
  const refresh = offset => {
    const binding = loaderRef.current;
    if (!binding || snapshot !== snapshotRef.current || binding.snapshot !== snapshotRef.current) return;
    const next = offset === undefined ? offsetRef.current.offset : offset;
    offsetRef.current.offset = next;
    void binding.loader.refresh({ offset: next });
  };
  return <details className="qh-monthly-production">
    <summary>Producción por cliente{page ? ` · ${page.completed} / ${page.total} tareas terminadas` : ' · Sin resultado confirmado'}</summary>
    <p className="qh-section-description">Tu trabajo de producción del mes. No cuenta videos grabados ni cuotas de contenido.</p>
    {loading && <p className="qh-empty" role="status">Cargando clientes…</p>}
    {current?.error && <div className="qh-error" role="alert"><p>{current.error}</p>
      <button type="button" onClick={() => refresh()}>Reintentar</button>
      <button type="button" onClick={() => refresh(0)}>Primera página</button>
    </div>}
    {page && <>
      <p className="qh-section-description">{page.completed} / {page.total} tareas terminadas · {period}</p>
      {page.clients.length ? <ul className="qh-client-list">{page.clients.map(row => <li key={row.client?.id ?? 'none'}>
        <span>{row.client ? `${row.client.nombre} · #${row.client.id}` : 'Sin cliente'}</span>
        <span>{row.completed} / {row.total} terminadas</span>
      </li>)}</ul> : <p className="qh-empty">No hay clientes en esta página.</p>}
      <nav className="qh-section-heading" aria-label="Páginas de producción por cliente">
        <button type="button" disabled={page.offset === 0} onClick={() => refresh(Math.max(0, page.offset - PRODUCTION_PAGE_LIMIT))}>Anterior</button>
        <span className="qh-list-count">Página {page.offset / PRODUCTION_PAGE_LIMIT + 1} · {page.client_count} grupos de cliente</span>
        <button type="button" disabled={!page.has_more || page.offset + PRODUCTION_PAGE_LIMIT > 1000000}
          onClick={() => refresh(page.offset + PRODUCTION_PAGE_LIMIT)}>Siguiente</button>
      </nav>
      {page.has_more && <p className="qh-section-description">Los totales incluyen todos los grupos.</p>}
    </>}
  </details>;
}
