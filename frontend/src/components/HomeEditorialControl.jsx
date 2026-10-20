import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { personalHomeNavigate, subscribePersonalHomeRefresh } from '../pages/personalHome.js';
import { EditorialPublicationControl } from './EditorialPublicationControl.jsx';
import { EditorialPieceDetails } from './EditorialPieceDetails.jsx';
import { canReadEditorialControl, createHomeEditorialLoader, EDITORIAL_BUCKETS, EDITORIAL_LIMIT,
  homeEditorialContextHref, homeEditorialRecordPiece } from './homeEditorialControl.js';
import { readEditorialLocation, loadEditorialView, saveEditorialView, normalizeEditorialView,
  editorialViewUrl } from './homeEditorialViewContext.js';

const evidenceLabel = value => ({ confirmada_manualmente: 'Publicación confirmada manualmente',
  historica_sin_confirmacion: 'Registro histórico sin confirmación', no_publicada: 'Sin publicación confirmada' })[value];
const stateLabel = value => ({ lista: 'Lista', publicada: 'Publicada', bloqueada: 'Bloqueada',
  pendiente: 'Pendiente', en_revision: 'En revisión', 'en_revisión': 'En revisión',
  'en_diseño': 'En diseño', 'en_edición': 'En edición' })[value] || value;

export function HomeEditorialControl({ sesion, onNavigate, onRecordOpenChange, request = apiRequest }) {
  const id = sesion?.usuario?.id, role = sesion?.usuario?.rol, active = sesion?.usuario?.activo, token = sesion?.token;
  const identity = useMemo(() => ({ id, role, active, token }), [id, role, active, token]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [result, setResult] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const recordOpenRef = useRef(false);
  const deferredLocationRef = useRef(null);
  const selectionRef = useRef(null);
  recordOpenRef.current = recordOpen;
  const changeRecordOpen = useCallback(open => {
    recordOpenRef.current = open;
    setRecordOpen(open);
    onRecordOpenChange?.(open);
    if (!open && deferredLocationRef.current) {
      const apply = deferredLocationRef.current;
      deferredLocationRef.current = null;
      apply();
    }
  }, [onRecordOpenChange]);
  const loaderRef = useRef(null);
  const allowed = canReadEditorialControl(sesion);
  const current = result?.identity === identity ? result : null;
  const data = allowed ? current?.data : null;
  const loading = !current || current.status === 'loading';
  const bucket = current?.bucket ?? 'today';
  useEffect(() => {
    if (!allowed) return undefined;
    let storage;
    try { storage = window.localStorage; } catch { /* Preferences are optional. */ }
    selectionRef.current = null;
    const loader = createHomeEditorialLoader({ sesion: { token, usuario: { id, rol: role, activo: active } },
      readSession: getSesion, request,
      onChange: state => {
        const selected = selectionRef.current;
        if (identityRef.current === identity && selected && state.bucket === selected.bucket && state.offset === selected.offset)
          setResult({ ...state, identity });
      } });
    loaderRef.current = loader;
    const applyLocation = () => {
      if (window.location.pathname !== '/inicio' || identityRef.current !== identity) return;
      try {
        const fromUrl = readEditorialLocation(window.location.search);
        const selected = fromUrl ?? loadEditorialView(storage, id);
        const canonicalUrl = editorialViewUrl(window.location.href, selected);
        window.history.replaceState(window.history.state, '', canonicalUrl);
        selectionRef.current = selected;
        saveEditorialView(storage, id, selected);
        void loader.refresh(selected);
      } catch {
        selectionRef.current = null;
        setResult({ status: 'error', data: null, bucket: 'today', offset: 0, identity,
          error: 'La vista editorial del enlace no es válida. Elegí una vista para continuar.' });
      }
    };
    const onLocation = () => {
      if (recordOpenRef.current) { deferredLocationRef.current = applyLocation; return; }
      applyLocation();
    };
    applyLocation();
    window.addEventListener('popstate', onLocation);
    const unsubscribe = subscribePersonalHomeRefresh({ refresh: options => recordOpenRef.current || !selectionRef.current ? false : loader.refresh(options) });
    return () => {
      window.removeEventListener('popstate', onLocation);
      deferredLocationRef.current = null;
      unsubscribe(); loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, [identity, allowed, request, id, role, active, token]);
  if (!allowed) return null;
  const refresh = () => { if (!recordOpenRef.current) void loaderRef.current?.refresh(); };
  const recordSaved = () => { void loaderRef.current?.refresh(); };
  const selectPage = changes => {
    if (recordOpenRef.current || !loaderRef.current) return;
    const selected = normalizeEditorialView({ bucket: changes.bucket ?? bucket, offset: changes.offset ?? 0 });
    const targetUrl = editorialViewUrl(window.location.href, selected);
    window.history.pushState(window.history.state, '', targetUrl);
    const actual = readEditorialLocation(window.location.search);
    if (actual?.bucket !== selected.bucket || actual?.offset !== selected.offset) return;
    selectionRef.current = selected;
    try { saveEditorialView(window.localStorage, id, selected); } catch { /* Optional preferences. */ }
    void loaderRef.current.refresh(selected);
  };
  return <section className="qh-section" aria-labelledby="qh-editorial-title">
    <header className="qh-section-heading"><div><h2 id="qh-editorial-title">Control editorial</h2>
      <p>Historias y publicaciones de todos los clientes.</p></div>
      <button type="button" className="qh-refresh" disabled={loading || recordOpen || !selectionRef.current} onClick={refresh}>Actualizar contenido</button>
    </header>
    <div className="qh-section-heading" role="group" aria-label="Vistas del control editorial">
      {EDITORIAL_BUCKETS.map(option => <button type="button" key={option.value} disabled={recordOpen} aria-pressed={bucket === option.value}
        onClick={() => selectPage({ bucket: option.value, offset: 0 })}>
        {option.label}{data ? ` (${data.summary[option.value]})` : ''}
      </button>)}
    </div>
    {loading && <p className="qh-status" role="status">Cargando contenido…</p>}
    {current?.error && <div className="qh-error" role="alert"><p>{current.error}</p>{selectionRef.current && <button type="button" onClick={refresh}>Reintentar</button>}</div>}
    {data && <>
      <p className="qh-section-description">{data.total} piezas en esta vista · {data.today}. Una pieza puede aparecer en más de una vista.</p>
      {data.items.length === 0 && <p className="qh-empty">No hay piezas en esta página.</p>}
      <ul className="qh-compact-list">{data.items.map(item => {
        const href = homeEditorialContextHref(item);
        return <li key={`${item.domain}:${item.id}`}><div className="qh-compact-row">
          <div className="qh-row-main"><strong>{item.titulo || 'Sin título'}</strong>
            <small>{item.cliente.nombre} · {item.domain === 'historia' ? 'Historia' : 'Publicación'} #{item.id} · {stateLabel(item.estado)}</small>
            <small>{item.fecha_programada || 'Sin fecha'} · {evidenceLabel(item.publication_classification)}</small>
            {href ? <a href={href} onClick={event => personalHomeNavigate(event, href, onNavigate)}>Ver planificación del cliente</a>
              : <small>Sin fecha de planificación. Consultá la pieza en su sección.</small>}
            <EditorialPublicationControl dominio={item.domain} pieza={homeEditorialRecordPiece(item)} sesion={sesion}
              hideSummary openLabel="Ver registro de publicación" onOpenChange={changeRecordOpen} onSaved={recordSaved}/>
            <EditorialPieceDetails piece={item} sesion={sesion} request={request}/>
          </div>
        </div></li>;
      })}</ul>
      <nav className="qh-section-heading" aria-label="Páginas del control editorial">
        <button type="button" disabled={recordOpen || data.offset === 0} onClick={() => selectPage({ offset: Math.max(0, data.offset - EDITORIAL_LIMIT) })}>Anterior</button>
        <span className="qh-list-count">Página {data.offset / EDITORIAL_LIMIT + 1} · {data.total} piezas</span>
        <button type="button" disabled={recordOpen || !data.has_more || data.offset + EDITORIAL_LIMIT > 1000000}
          onClick={() => selectPage({ offset: data.offset + EDITORIAL_LIMIT })}>Siguiente</button>
      </nav>
    </>}
  </section>;
}
