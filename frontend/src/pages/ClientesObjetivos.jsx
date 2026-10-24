import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import { Modal } from '../components/Modal.jsx';
import { PageState } from '../components/PageState.jsx';
import { validateGoalQuota, goalQuotaProgress, goalQuotaReviewBody, validGoalQuotaRevision, verifiedGoalPreparationAck, goalPreparationRevision, goalPreparationBody } from './clientGoalQuota.js';
import './ClientesObjetivos.css';
import { clientOperationHref } from './clientOperation.js';
import { navigateWithinApp, requestAppNavigation } from '../shared/navigation/location.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { parseGoalClientId, goalClientLocationUrl, resolveGoalClient } from './clientGoalLocation.js';

const STATES = { pendiente: 'Pendiente', en_progreso: 'En proceso', en_revision: 'En revisión', aprobada: 'Aprobada', finalizada: 'Finalizada', programada: 'Programada', publicada: 'Finalizada' };
const AUTO_UPDATE_ERROR = 'No se pudo actualizar el avance. Reintentaremos automáticamente.';
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').slice(0, 2).join('-');
function monthLabel(period) { const [year, month] = period.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))); }
function goalPeriod(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => key.startsWith('periodo['))) throw new Error('Período inválido. Elegí un mes válido.');
  const values = params.getAll('periodo');
  if (!values.length) return currentMonth();
  if (values.length !== 1 || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(values[0])) throw new Error('Período inválido. Elegí un mes válido.');
  return values[0];
}
const goalId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const goalTime = value => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
function goalOverview(value, period) {
  if (value?.periodo !== period || !Array.isArray(value.clientes)) throw new Error('Respuesta de objetivos inválida.');
  const keys = new Set(), ids = new Set();
  for (const client of value.clientes) {
    if (typeof client.clave !== 'string' || keys.has(client.clave) || typeof client.nombre !== 'string' || !Array.isArray(client.cuentas) || !Array.isArray(client.piezas)
      || ![client.reels, client.carruseles].every(n => Number.isSafeInteger(n) && n >= 0)
      || client.cuentas.some(account => !goalId(account.id) || typeof account.nombre !== 'string')) throw new Error('Respuesta de objetivos inválida.');
    keys.add(client.clave);
    validateGoalQuota(client);
    goalPreparationRevision(client);
    for (const piece of client.piezas) {
      if (!goalId(piece.id) || ids.has(piece.id) || !['video', 'carrusel'].includes(piece.tipo) || typeof piece.estado !== 'string'
        || !Array.isArray(piece.responsables) || piece.responsables.some(name => typeof name !== 'string')
        || (piece.tarea_id != null && !goalId(piece.tarea_id))) throw new Error('Respuesta de piezas inválida.');
      ids.add(piece.id);
    }
  }
  return value;
}
function useGoalSession(sesion, context) {
  const view = useSessionView(sesion || getSesion());
  const live = useRef({ view, context, epoch: 0 });
  if (live.current.view !== view || live.current.context !== context) live.current = { view, context, epoch: live.current.epoch + 1 };
  const observation = live.current, mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const capture = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current === observation }), [view, observation]);
  const captureLifetime = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current.view === view }), [view]);
  return { view, capture, captureLifetime, epoch: observation.epoch };
}
const done = piece => ['finalizada', 'publicada'].includes(piece.estado);
const pieceLabel = piece => piece.tipo === 'video' ? `Reel ${piece.numero}` : piece.titulo || `Carrusel ${piece.numero}`;

function GoalPieceButton({piece,onOpen}) {
  return <button className={`cg-piece${done(piece) ? ' is-done' : ''}`} onClick={()=>onOpen(piece)} aria-label={`${pieceLabel(piece)} · ${STATES[piece.estado] || piece.estado}`}>
    <span className="cg-check" aria-hidden="true">{done(piece)&&<GoalIcon name="check"/>}</span><span className="cg-piece-text"><strong>{pieceLabel(piece)}</strong><small className={`cg-state cg-state-${piece.estado}`}><span aria-hidden="true"/>{STATES[piece.estado]||piece.estado}{!piece.tarea_id?' · Registro conservado':''}</small></span><GoalIcon name="arrow" className="cg-piece-arrow"/>
  </button>;
}

function GoalIcon({ name, className = '' }) {
  const shapes = {
    clients: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15" /></>,
    video: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 8 6 4-6 4Z" /></>,
    carousel: <><rect x="3" y="6" width="15" height="15" rx="3" /><path d="M7 3h11a3 3 0 0 1 3 3v11M7 15l3-3 4 5M7.5 10h.01" /></>,
    arrow: <path d="m9 6 6 6-6 6" />,
    external: <><path d="M14 4h6v6M20 4 10 14M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    sync: <><path d="m16 3 4 4-4 4M20 7H6M8 21l-4-4 4-4M4 17h14" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  };
  return <svg className={`cg-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function GoalLoading() {
  return <div className="cg-loading" role="status"><span className="cg-loading-label"><GoalIcon name="refresh" />Cargando objetivos del mes…</span><div className="cg-skeleton-layout" aria-hidden="true"><div className="cg-skeleton-clients">{[1, 2, 3].map(key => <span key={key} />)}</div><div className="cg-skeleton-board"><span className="cg-skeleton-title" /><span className="cg-skeleton-progress" /><div className="cg-skeleton-pieces">{[1, 2, 3, 4].map(key => <span key={key} />)}</div></div></div></div>;
}

function useGoalModalFocus() {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trap = event => {
      if (event.key !== 'Tab') return;
      const controls = [...document.querySelectorAll('.cg-modal button:not(:disabled),.cg-modal a[href],.cg-modal input:not(:disabled),.cg-modal textarea:not(:disabled)')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', trap); };
  }, []);
}

export function ClientesObjetivosPage({ sesion }) {
  const view = useSessionView(sesion || getSesion());
  const identity = useRef({ view, epoch: 0 });
  if (identity.current.view !== view) identity.current = { view, epoch: identity.current.epoch + 1 };
  return <GoalPage key={identity.current.epoch} sesion={view.session} />;
}

function GoalPage({ sesion }) {
  const initial = useRef(null);
  if (!initial.current) { try { initial.current = { period: goalPeriod(window.location.search), clientId:parseGoalClientId(window.location.search), error: '' }; } catch (reason) { initial.current = { period: currentMonth(), clientId:null, error: reason.message }; } }
  const [period, setPeriod] = useState(initial.current.period), [locationError, setLocationError] = useState(initial.current.error);
  const { view, capture, epoch } = useGoalSession(sesion, period);
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(''), [selectedPiece, setSelectedPiece] = useState(null);
  const [revision, setRevision] = useState(0), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(initial.current.clientId);
  const activeHref = useRef(window.location.href);
  const modalOpen = useRef(false), deferred = useRef(false), pendingPeriod = useRef(null), readGeneration = useRef(0), loaded = useRef(false);
  modalOpen.current = Boolean(preparing || selectedPiece);
  const canManage = ['admin', 'community'].includes(view.role);
  const refresh = () => { if (modalOpen.current) { deferred.current = true; return; } setRevision(value => value + 1); };
  const closeModal = () => {
    if (preparing) { loaded.current = false; setLoading(true); deferred.current = true; }
    modalOpen.current = false; setPreparing(false); setSelectedPiece(null);
    if (pendingPeriod.current) {
      const next = pendingPeriod.current; pendingPeriod.current = null;
      window.history.replaceState(window.history.state, '', next.href);
      activeHref.current = window.location.href;
      setPeriod(next.period); setSelectedClientId(next.clientId); setLocationError(next.error); setNotice('');
    }
    if (deferred.current) { deferred.current = false; setRevision(value => value + 1); }
  };
  useEffect(() => {
    const pop = () => {
      if (window.location.pathname !== '/clientes') return;
      let next; try { next = { period: goalPeriod(window.location.search), clientId:parseGoalClientId(window.location.search), error: '' }; } catch (reason) { next = { period, clientId:selectedClientId, error: reason.message }; }
      next.href = window.location.href;
      if (modalOpen.current) {
        pendingPeriod.current = next;
        window.history.replaceState(window.history.state, '', activeHref.current);
        setNotice('El cambio de cliente o mes se aplicará al cerrar el detalle.'); return;
      }
      activeHref.current = next.href;
      setPeriod(next.period); setSelectedClientId(next.clientId); setLocationError(next.error);
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [period, selectedClientId]);
  useEffect(() => {
    const controller = new AbortController();
    const scope = capture(), generation = ++readGeneration.current;
    loaded.current = false; setLoading(true); setError(''); setData(null);
    if (locationError) { setError(locationError); setLoading(false); return () => controller.abort(); }
    window.history.replaceState(window.history.state, '', goalClientLocationUrl(window.location.href,{clientId:selectedClientId,period}));
    activeHref.current = window.location.href;
    scope.request(`/api/cliente-objetivos?periodo=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(value => { const result = goalOverview(value, period); if (!scope.current() || controller.signal.aborted || generation !== readGeneration.current) return; if (modalOpen.current) { deferred.current = true; return; } loaded.current = true; setData(result); setSelectedKey(key => result.clientes.some(client => client.clave === key) ? key : result.clientes[0]?.clave || ''); })
      .catch(reason => { if (scope.current() && !controller.signal.aborted && generation === readGeneration.current && !isSessionFailure(reason)) setError(reason.message); })
      .finally(() => { if (scope.current() && !controller.signal.aborted && generation === readGeneration.current) setLoading(false); });
    return () => controller.abort();
  }, [period, revision, capture, locationError]);
  useEffect(() => {
    const controller = new AbortController();
    const scope = capture(); let busy = false, stopped = false;
    const update = async () => {
      if (document.visibilityState !== 'visible' || busy || stopped || !scope.current() || locationError || !loaded.current) return;
      if (modalOpen.current) { deferred.current = true; return; }
      busy = true; const generation = ++readGeneration.current;
      try {
        const result = goalOverview(await scope.request(`/api/cliente-objetivos?periodo=${encodeURIComponent(period)}`, { signal: controller.signal }), period);
        if (!scope.current() || controller.signal.aborted || generation !== readGeneration.current) return;
        if (modalOpen.current) { deferred.current = true; return; }
        setData(result);
        setNotice(current => current === AUTO_UPDATE_ERROR ? '' : current);
      } catch (reason) { if (isSessionFailure(reason) || [401,403].includes(reason.status)) stopped = true; if (scope.current() && !controller.signal.aborted && !stopped && !modalOpen.current && generation === readGeneration.current) setNotice(AUTO_UPDATE_ERROR); }
      finally { busy = false; }
    };
    const timer = setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); controller.abort(); document.removeEventListener('visibilitychange', update); };
  }, [period, capture, locationError]);
  const clients = data?.periodo === period ? data.clientes : [];
  const filtered = clients;
  const client = locationError ? null : resolveGoalClient(filtered, selectedClientId, selectedKey);
  const activeKey = client?.clave || '';
  function changeGoalContext(changes) {
    const scope=capture();
    if (modalOpen.current || !scope.current()) return false;
    const href=goalClientLocationUrl(window.location.href,{clientId:selectedClientId,period,...changes});
    if (href===`${window.location.pathname}${window.location.search}${window.location.hash}`) return true;
    if (!requestAppNavigation(window,href) || modalOpen.current || !scope.current()) return false;
    window.history.pushState(window.history.state,'',href);
    window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));
    setNotice(''); return true;
  }
  function chooseClient(key) {
    if (modalOpen.current) return;
    const next=clients.find(item=>item.clave===key), id=next?.cuentas[0]?.id;
    if (!goalId(id) || !changeGoalContext({clientId:id})) return;
    setSelectedKey(key); setSelectedPiece(null);
  }
  const total = client ? client.reels + client.carruseles : 0;
  const completed = client ? goalQuotaProgress(client).completed : 0;
  const additional = client ? goalQuotaProgress(client).additional : [];
  const historic = period < '2026-10';
  const canReviewQuota = view.role === 'admin' && !historic && client?.preparado && client.cuota_desactualizada && client.cuota_actual !== null && validGoalQuotaRevision(client.cuota_revision);
  const openQuotaReview = () => {
    if (!capture().current() || !loaded.current || !canReviewQuota || modalOpen.current) return;
    modalOpen.current = true; deferred.current = true; setPreparing('reconcile');
  };
  const openPreparation = () => {
    if(!capture().current()||!loaded.current||modalOpen.current||!canManage||historic||!client||client.cuota_desactualizada||!validGoalQuotaRevision(client.preparacion_revision)||total===0)return;
    modalOpen.current=true;setPreparing(true);
  };

  return <main className="client-goals" aria-label="Objetivos mensuales de clientes"><div className="frame"><div className="content cg-content">
    <header className="cg-header"><div className="cg-heading-group"><span className="cg-page-icon"><GoalIcon name="clients" /></span><div><span className="cg-eyebrow">Seguimiento del equipo</span><h1>Clientes</h1><p>Todo el contenido del mes, en un mismo lugar.</p></div></div>
      <div className="cg-header-actions"><label className="cg-month"><span>Mes de trabajo</span><input aria-label="Mes de trabajo" type="month" value={period} disabled={Boolean(preparing || selectedPiece)} onChange={event => { if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) changeGoalContext({period:event.target.value}); }} /></label>
      </div></header>
    {notice && <p className="cg-notice" role="status">{notice}</p>}
    {loading ? <GoalLoading /> : error ? <PageState type="error" title="No pudimos cargar los objetivos" description={error} onRetry={refresh} /> : clients.length === 0 ? <PageState type="empty" title={selectedClientId != null ? `El cliente #${selectedClientId} no tiene un objetivo disponible en este período` : 'No hay clientes para este mes'} description="Elegí otro período para consultar su seguimiento." /> : <div className="cg-layout">
      <aside className="cg-clients" aria-label="Elegir cliente"><div className="cg-clients-heading"><span>Clientes</span><span>{filtered.length}</span></div>
        <div className="cg-client-items">{filtered.map(item => {
          const count = goalQuotaProgress(item).completed, quantity = item.reels + item.carruseles;
          return <button className={`cg-client${item.clave === activeKey ? ' is-selected' : ''}`} disabled={Boolean(preparing || selectedPiece)} key={item.clave} aria-pressed={item.clave === activeKey} aria-label={`${item.nombre}: ${item.preparado ? `${count} de ${quantity} completados` : 'Objetivo por preparar'}`} onClick={() => chooseClient(item.clave)}>
            <span className="cg-avatar" aria-hidden="true">{item.nombre.slice(0, 1)}</span><span className="cg-client-text"><strong>{item.nombre}</strong>{item.preparado ? <span className="cg-client-progress" aria-hidden="true"><span style={{width:`${quantity ? Math.min(100, count / quantity * 100) : 0}%`}} /></span> : <small>Objetivo por preparar</small>}</span><GoalIcon name="arrow" className="cg-client-arrow" />
          </button>;
        })}{filtered.length === 0 && <p className="cg-muted">No encontramos ese cliente.</p>}</div>
      </aside>
      <label className="cg-mobile-client"><span>Cliente</span><select aria-label="Elegir cliente" value={activeKey} disabled={!filtered.length || Boolean(preparing || selectedPiece)} onChange={event => chooseClient(event.target.value)}>{!client && <option value="">Elegí otro cliente</option>}{filtered.map(item => <option key={item.clave} value={item.clave}>{item.nombre}</option>)}</select>{!filtered.length && <small>No encontramos ese cliente.</small>}</label>
      {!client && selectedClientId != null && <p className="cg-notice" role="status">El cliente #{selectedClientId} no tiene un objetivo disponible en este período. Elegí otro cliente del listado; no se seleccionó un objetivo diferente.</p>}
      {client && <section className="cg-board" key={client.clave} aria-label={`Objetivo mensual de ${client.nombre}`}>
        <nav aria-label="Operación por cuenta">{client.cuentas.map(account => <a className="cg-button" key={account.id} href={clientOperationHref(account.id, period)} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); if (modalOpen.current) return;
          navigateWithinApp(window, clientOperationHref(account.id, period));
        }}>Ver operación de {account.nombre}</a>)}</nav>
        <div className="cg-board-summary"><header className="cg-board-header"><div><span className="cg-eyebrow">Objetivo mensual · {monthLabel(period)}</span><h2>{client.nombre}</h2>{client.cuentas.length > 1 && <p className="cg-shared">Objetivo compartido · {client.cuentas.map(account => account.nombre).join(' + ')}</p>}</div>{client.preparado && total>0 && <div className={`cg-overall${completed === total ? ' is-complete' : ''}`}><span>Contenido completado</span><strong>{completed}<span> / {total}</span></strong></div>}</header>
        {client.preparado && total>0 && <><div className="cg-progress" role="progressbar" aria-label="Avance mensual" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><span style={{ width: `${Math.min(100, completed / total * 100)}%` }} /></div>
        <div className="cg-progress-caption"><span>{completed === total ? 'Objetivo del mes completado' : `${Math.max(0, total - completed)} piezas pendientes`}</span><strong>{Math.round(completed / total * 100)}%</strong></div></>}</div>
        {client.preparado && client.cuota_desactualizada && <section className="cg-quota-notice" aria-label="Cuota mensual desactualizada"><div><strong>La cuota del objetivo cambió</strong><p>Preparada: {client.reels} reels · {client.carruseles} carruseles.{client.cuota_actual ? ` Vigente: ${client.cuota_actual.reels} reels · ${client.cuota_actual.carruseles} carruseles.` : ' No hay una cuota vigente verificable para este objetivo.'}</p><small>El avance conserva la cuota preparada hasta que administración revise el cambio.</small></div>{canReviewQuota && <button type="button" className="cg-button" onClick={openQuotaReview}>Revisar cuota</button>}</section>}
        {!client.preparado && <div className="cg-prepare-state"><strong>{historic ? 'El historial anterior se conserva' : 'Objetivo por preparar'}</strong><p>{historic ? 'El seguimiento comienza en octubre de 2026. El historial anterior no se modifica.' : 'Todavía no se preparó el objetivo de este mes. Prepararlo vincula tareas existentes y crea sólo las faltantes según la cuota observada.'}</p>
          {total>0 ? <p>Cuota del mes: {client.reels} reels · {client.carruseles} carruseles{client.cuentas.length>1?' compartidos entre todas las cuentas, no por cuenta':''}.</p> : <p>No hay piezas incluidas en la cuota de este mes.</p>}
          {!historic && total>0 && (canManage ? <button className="cg-button cg-primary" disabled={!validGoalQuotaRevision(client.preparacion_revision)} onClick={openPreparation}>Preparar objetivo del mes</button> : <small>Administración o CM pueden preparar este objetivo.</small>)}
          {!historic && total===0 && view.role==='admin' && <nav className="cg-prepare-links" aria-label="Administrar cuentas">{client.cuentas.map(account=><a className="cg-button" key={account.id} href={`/clientes?gestion=1&cliente=${account.id}&periodo=${period}`}>Administrar {account.nombre}</a>)}</nav>}
        </div>}
        {client.preparado && <div className="cg-format-grid">{[['video', 'Reels', client.reels], ['carrusel', 'Carruseles', client.carruseles]].map(([type, label, quantity]) => {
          const {quota:pieces,completed:count} = goalQuotaProgress(client,type);
          return <section className={`cg-format cg-format-${type}`} key={type} aria-label={label}><header><h3><span className="cg-format-icon"><GoalIcon name={type === 'video' ? 'video' : 'carousel'} /></span>{label}</h3>{quantity>0 && <span className={`cg-format-count${count === quantity ? ' is-complete' : ''}`}>{count} de {quantity}</span>}</header>
            <p className="cg-format-subtitle">{quantity === 0 ? 'No incluido este mes' : count === quantity ? 'Objetivo completado' : `${quantity - count === 1 ? 'Falta' : 'Faltan'} ${quantity - count} para completar el mes`}</p>
            <div className="cg-piece-list">{pieces.map(piece => <GoalPieceButton key={piece.id} piece={piece} onOpen={value=>{modalOpen.current=true;setSelectedPiece(value)}}/>)}{!client.preparado && quantity > 0 && <p className="cg-format-empty">{quantity} tareas previstas · aún sin vincular</p>}</div>
          </section>;
        })}</div>}
        {additional.length > 0 && <section className="cg-additional" aria-label="Contenido adicional"><header><h3>Contenido adicional</h3><span>No cuenta para la cuota</span></header><p className="cg-muted">Se conservan sus tareas, entregas, correcciones e historial.</p><div className="cg-piece-list">{additional.map(piece=><GoalPieceButton key={piece.id} piece={piece} onOpen={value=>{modalOpen.current=true;setSelectedPiece(value)}}/>)}</div></section>}
        <footer className="cg-board-footer"><GoalIcon name="sync" /><p>Conectado con Tareas. El avance refleja trabajo finalizado, no publicaciones confirmadas. Las tareas existentes conservan sus responsables.</p>{canManage && client.preparado && !historic && total>0 && !client.cuota_desactualizada && validGoalQuotaRevision(client.preparacion_revision) && <button className="cg-button" onClick={openPreparation}>Actualizar responsables y completar objetivo</button>}</footer>
      </section>}
    </div>}
    {preparing && client && <PrepareGoal key={`${epoch}:${period}:${client.clave}:${preparing === 'reconcile' ? 'reconcile' : 'prepare'}`} sesion={view.session} client={client} period={period} mode={preparing === 'reconcile' ? 'reconcile' : 'prepare'} close={closeModal} saved={result => { closeModal(); setNotice(`${result.vinculadas} tareas vinculadas · ${result.creadas} tareas nuevas. ${preparing === 'reconcile' ? 'Cuota revisada; el contenido existente se conserva.' : 'El objetivo está preparado.'}`); refresh(); }} />}
    {selectedPiece && client && <PieceDetail key={`${epoch}:${period}:${client.clave}:${selectedPiece.id}:${selectedPiece.tarea_id}`} sesion={view.session} piece={selectedPiece} client={client} canManage={canManage} close={closeModal} saved={() => { closeModal(); refresh(); }} />}
  </div></div></main>;
}

function PrepareGoal({ sesion, client, period, mode = 'prepare', close, saved }) {
  useGoalModalFocus();
  const { view, capture, captureLifetime } = useGoalSession(sesion, `${period}:${client.clave}:${mode}`);
  const pending = useRef(false);
  const reviewBlocked = useRef(false);
  const [blocked, setBlocked] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const reconciling = mode === 'reconcile';
  const quota = reconciling ? client.cuota_actual : {reels:client.reels,carruseles:client.carruseles};
  const shared = client.cuentas.length > 1;
  const [users, setUsers] = useState([]), [selected, setSelected] = useState(() => Object.fromEntries(['video','carrusel'].map(type => [type,(client.responsables_por_formato?.[type] || []).map(user => user.id)]))), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [accounts, setAccounts] = useState(() => Object.fromEntries(client.cuentas.map(account => [account.id,
    (client.responsables_por_cuenta?.[account.id] || client.responsables_por_formato?.carrusel || []).map(user => user.id)])));
  const formats = { ...selected, carrusel: shared ? [...new Set(Object.values(accounts).flat())] : selected.carrusel };
  const initialSelection = useRef(JSON.stringify({ selected, accounts }));
  const preparationNavigationStatus = () => {
    if (!capture().current()) return { dirty:false, busy:false };
    return { dirty:Boolean(reviewBlocked.current || acknowledged || JSON.stringify({ selected, accounts }) !== initialSelection.current), busy:Boolean(pending.current) };
  };
  useNavigationGuard(preparationNavigationStatus);
  const closeSafely = () => {
    if (pending.current || !capture().current()) return;
    if ((reviewBlocked.current || acknowledged || JSON.stringify({ selected, accounts }) !== initialSelection.current) && !window.confirm(reviewBlocked.current ? 'El envío puede haberse guardado sin confirmación. ¿Cerrar esta revisión y recargar los datos guardados?' : '¿Descartar esta revisión de responsables sin guardar?')) return;
    close();
  };
  const fields = [{key:'video',label:'Reels',quantity:quota?.reels,ids:selected.video}, ...(shared
    ? client.cuentas.map(account => ({key:String(account.id),label:`Carruseles · ${account.nombre}`,ids:accounts[account.id]}))
    : [{key:'carrusel',label:'Carruseles',quantity:quota?.carruseles,ids:selected.carrusel}])];
  const toggle = (field, id) => {
    if (pending.current || reviewBlocked.current || !capture().current()) return;
    const update = current => ({...current,[field.key]:current[field.key].includes(id) ? current[field.key].filter(value => value !== id) : [...current[field.key],id]});
    if (shared && field.key !== 'video') setAccounts(update); else setSelected(update);
    setAcknowledged(false);
  };
  useEffect(() => { const controller = new AbortController(), scope = capture(); scope.request('/api/cliente-objetivos/responsables', { signal: controller.signal }).then(value => { if (!Array.isArray(value) || value.some(user => !goalId(user.id) || typeof user.nombre !== 'string') || new Set(value.map(user => user.id)).size !== value.length) throw new Error('Responsables inválidos.'); if (scope.current() && !controller.signal.aborted) setUsers(value); }).catch(reason => { if (scope.current() && !controller.signal.aborted && !isSessionFailure(reason)) setError(reason.message); }); return () => controller.abort(); }, [capture]);
  const submit = async event => {
    event.preventDefault(); if (pending.current || reviewBlocked.current) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    let body;
    try { body = JSON.stringify(reconciling
      ? goalQuotaReviewBody({client,period,formats,accounts,role:view.role,acknowledged})
      : goalPreparationBody({client,period,formats,accounts,role:view.role,acknowledged}));
    } catch(reason) { if(scope.current())setError(reason.message); return; }
    pending.current = true; setBusy(true); setError('');
    try { const response = await scope.request(reconciling ? '/api/cliente-objetivos/reconciliar' : '/api/cliente-objetivos/preparar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const result = verifiedGoalPreparationAck(response,client.preparado ? client.id : undefined);
      scope.assertCurrent(); reviewBlocked.current=true; saved(result);
    } catch (reason) { if (scope.current() && !isSessionFailure(reason)) {
      reviewBlocked.current=true;setBlocked(true);setError(`${reason.status===409?'La cuota, los responsables o el objetivo cambiaron.':'No pudimos confirmar el resultado.'} Conservamos tus selecciones. Cerrá y volvé a abrir la revisión para cargar los datos guardados; no repetiremos el envío.`);
    } }
    finally { pending.current = false; if (lifetime.current()) setBusy(false); }
  };
  return <Modal title={reconciling ? 'Revisar cuota mensual' : client.preparado ? 'Actualizar responsables y completar objetivo' : 'Preparar objetivo del mes'} overlayAriaLabel={reconciling ? 'Revisar cuota mensual' : 'Preparar objetivo mensual'} onClose={closeSafely} className="cg-modal"><form className={`cg-modal-body${shared ? ' cg-shared-responsables' : ''}`} onSubmit={submit}>
    <h2>{client.nombre}</h2><section className="cg-preparation-observation" aria-label="Preparación observada"><p>Mes de trabajo: <strong>{monthLabel(period)}</strong></p><p>Cuota: <strong>{quota?.reels} reels · {quota?.carruseles} carruseles</strong></p><p>Cuentas incluidas:</p><ul>{client.cuentas.map(account=><li key={account.id}>{account.nombre} · #{account.id}</li>)}</ul></section><p>Los responsables seleccionados se guardan para futuras preparaciones. Las tareas existentes mantienen sus responsables. Esta acción también vincula o crea las tareas faltantes del mes seleccionado; no es sólo un cambio de asignaciones.</p>
    {reconciling && <section className="cg-quota-review" aria-label="Comparación de cuota mensual"><p>Mes de trabajo: <strong>{monthLabel(period)}</strong></p><dl><div><dt>Formato</dt><dd>Preparada → Vigente</dd></div><div><dt>Reels</dt><dd>{client.reels} → {quota?.reels ?? 'No disponible'}</dd></div><div><dt>Carruseles</dt><dd>{client.carruseles} → {quota?.carruseles ?? 'No disponible'}</dd></div></dl><p>Se crean o vinculan sólo las tareas faltantes. Si la cuota baja, lo que exceda queda como contenido adicional, fuera del avance de cuota. No se borran ni dividen tareas, entregas o correcciones.</p></section>}
    {shared && <p className="cg-muted">{quota?.carruseles ?? client.carruseles} carruseles compartidos entre las cuentas, no por cuenta. Cada tarea nueva usa los responsables de su cuenta; los reels mantienen una asignación común.</p>}
    {fields.map(field => <fieldset className="cg-responsables" key={field.key}><legend>{field.label}</legend>
      <small>{field.quantity !== undefined ? `${field.quantity} piezas · ` : ''}Podés elegir varias personas, sin responsable principal.</small>
      {users.map(user => <label key={user.id}><input type="checkbox" disabled={busy || blocked} checked={field.ids.includes(user.id)} onChange={() => toggle(field,user.id)} /><span>{user.nombre}</span></label>)}
    </fieldset>)}
    <p className="cg-muted">Se vinculan las tareas existentes y se crean únicamente las que faltan para el mes seleccionado.</p>
    <label className="cg-quota-ack"><input type="checkbox" checked={acknowledged} disabled={busy || blocked} onChange={event=>{if(!pending.current&&!reviewBlocked.current&&capture().current())setAcknowledged(event.target.checked)}}/><span>{reconciling ? 'Revisé ambas cuotas y confirmo que se conservarán las tareas, el contenido y su historial.' : 'Revisé el mes, la cuota, todas las cuentas y los responsables. Confirmo vincular las tareas existentes y crear sólo las faltantes, conservando su historial.'}</span></label>{error && <p className="cg-error" role="alert">{error}</p>}
    <footer><button className="cg-button" type="button" disabled={busy} onClick={closeSafely}>Cancelar</button><button className="cg-button cg-primary" disabled={busy || blocked || !acknowledged || (reconciling ? view.role !== 'admin' || !quota || !validGoalQuotaRevision(client.cuota_revision) : !['admin','community'].includes(view.role) || !validGoalQuotaRevision(client.preparacion_revision) || client.cuota_desactualizada || !(quota?.reels + quota?.carruseles > 0)) || (quota?.reels > 0 && !selected.video.length) || (shared ? Object.values(accounts).some(ids => !ids.length) : quota?.carruseles > 0 && !selected.carrusel.length) || !Object.values(formats).flat().length}>{busy ? 'Guardando…' : reconciling ? 'Confirmar nueva cuota' : client.preparado ? 'Actualizar y completar objetivo' : 'Confirmar preparación del mes'}</button></footer>
  </form></Modal>;
}

function PieceDetail({ sesion, piece, client, canManage, close, saved }) {
  useGoalModalFocus();
  const { capture, captureLifetime } = useGoalSession(sesion, `${client.clave}:${piece.id}:${piece.tarea_id}`);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const [editing,setEditing] = useState(false), [title,setTitle] = useState(piece.titulo), [copy,setCopy] = useState(piece.copy || ''), [taskVersion,setTaskVersion] = useState(''), [taskRevision,setTaskRevision] = useState(null);
  const editBaseline = useRef(null);
  const contentNavigationStatus = () => {
    if (!capture().current()) return { dirty: false, busy: false };
    return { dirty: editing && JSON.stringify({ title, copy }) !== editBaseline.current, busy: pending.current };
  };
  useNavigationGuard(contentNavigationStatus);
  const discardAllowed = () => {
    if (pending.current || !capture().current()) return false;
    return !editing || JSON.stringify({ title, copy }) === editBaseline.current || window.confirm('¿Descartar los cambios de contenido sin guardar?');
  };
  const closeSafely = () => { if (discardAllowed()) close(); };
  const cancelEdit = () => { if (discardAllowed()) setEditing(false); };
  const finalizable = piece.estado === 'aprobada' || done(piece);
  const beginEdit = async () => {
    if (pending.current) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    pending.current = true;
    setBusy(true); setError('');
    try { const task = await scope.request(`/api/tareas/${piece.tarea_id}?workspace=render_os`);
      if (task?.id !== piece.tarea_id || !goalId(task.revision) || !goalTime(task.updated_at) || typeof task.titulo !== 'string' || (task.propiedades_extra?.copy_trabajo != null && typeof task.propiedades_extra.copy_trabajo !== 'string')) throw new Error('No se pudo verificar la tarea.');
      scope.assertCurrent(); editBaseline.current = JSON.stringify({ title: task.titulo, copy: task.propiedades_extra?.copy_trabajo ?? piece.copy ?? '' }); setTaskVersion(task.updated_at); setTaskRevision(task.revision); setTitle(task.titulo); setCopy(task.propiedades_extra?.copy_trabajo ?? piece.copy ?? ''); setEditing(true); }
    catch (reason) { if (scope.current() && !isSessionFailure(reason)) setError(reason.message); }
    finally { pending.current = false; if (lifetime.current()) setBusy(false); }
  };
  const saveContent = async () => {
    if (pending.current || !goalId(taskRevision) || !goalTime(taskVersion)) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await scope.request(`/api/cliente-objetivos/piezas/${piece.id}/contenido`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({titulo:title,copy,expected_updated_at:taskVersion,expected_revision:taskRevision})});
      if (!goalTime(result?.updated_at) || !goalId(result?.revision) || result.revision <= taskRevision) throw new Error('No se pudo verificar el guardado. Revisá la tarea antes de reintentar.');
      scope.assertCurrent(); saved(); }
    catch (reason) { if (scope.current() && !isSessionFailure(reason)) setError(reason.message); }
    finally { pending.current = false; if (lifetime.current()) setBusy(false); }
  };
  const finish = async () => {
    if (pending.current || !canManage || !finalizable) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    if (!goalId(piece.tarea_revision) || !goalTime(piece.tarea_updated_at)) { setError('Actualizá y revisá la tarea antes de continuar.'); return; }
    if (done(piece) && !window.confirm('¿Reabrir esta tarea y dejar la pieza pendiente? El cambio quedará registrado.')) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await scope.request(`/api/tareas/${piece.tarea_id}?workspace=render_os`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: done(piece) ? 'pendiente' : 'finalizada', expected_updated_at: piece.tarea_updated_at, expected_revision: piece.tarea_revision }) });
      if (result?.id !== piece.tarea_id || !goalId(result.revision) || result.estado !== (done(piece) ? 'pendiente' : 'finalizada')) throw new Error('No se pudo verificar el cambio. Revisá la tarea antes de reintentar.');
      scope.assertCurrent(); saved();
    } catch (reason) { if (scope.current() && !isSessionFailure(reason)) setError(reason.message); }
    finally { pending.current = false; if (lifetime.current()) setBusy(false); }
  };
  return <Modal title={<span className="cg-detail-breadcrumb"><GoalIcon name={piece.tipo === 'video' ? 'video' : 'carousel'} />{client?.nombre} <span aria-hidden="true">/</span> {piece.tipo === 'video' ? 'Reel' : 'Carrusel'}</span>} overlayAriaLabel="Detalle de la pieza" onClose={closeSafely} className="cg-modal"><div className="cg-modal-body"><span className={`cg-detail-state${done(piece) ? ' is-done' : ''}`}>{done(piece) && <GoalIcon name="check" />}{STATES[piece.estado] || piece.estado}</span><h2>{pieceLabel(piece)}</h2><div className="cg-detail-responsables"><GoalIcon name="clients" /><div><span>Responsables</span><p>{piece.responsables.join(' · ') || 'Sin responsables registrados'}</p></div></div><div className="cg-copy-heading"><h3>Copy de la publicación</h3>{piece.copy && <button className="cg-button" onClick={async () => { const scope = capture(); if (!scope.current()) return; try { await navigator.clipboard.writeText(piece.copy); if (scope.current()) setCopied(true); } catch { if (scope.current()) setError('No se pudo copiar. Podés seleccionar el texto manualmente.'); } }}><GoalIcon name={copied ? 'check' : 'copy'} />{copied ? 'Copiado' : 'Copiar texto'}</button>}</div><div className={`cg-copy${!piece.copy ? ' is-empty' : ''}`}>{piece.copy || 'Todavía no hay un copy guardado para esta pieza. Podés cargarlo en la tarea vinculada.'}</div>
    {editing && <div className="cg-content-editor"><label>Título<input maxLength={500} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>Copy<textarea maxLength={20000} value={copy} disabled={busy} onChange={event => setCopy(event.target.value)} rows={6} /></label><p>Se guarda también en la tarea. Si ya estaba aprobada, los cambios requieren otra revisión.</p></div>}
    {piece.completada_at && <p className="cg-muted cg-completion-date"><GoalIcon name="check" />Completada el {new Date(piece.completada_at).toLocaleDateString('es-AR')}</p>}{!piece.tarea_id && <p className="cg-muted">La tarea ya no está disponible. El resultado mensual y su contenido se conservaron.</p>}{error && <p className="cg-error" role="alert">{error}</p>}<footer>{editing ? <><button className="cg-button" disabled={busy} onClick={cancelEdit}>Cancelar edición</button><button className="cg-button cg-primary" disabled={busy || !title.trim()} onClick={saveContent}>{busy ? 'Guardando…' : 'Guardar contenido'}</button></> : <>{piece.tarea_id && <><a className="cg-button" href={`/workspace/tareas?task=${piece.tarea_id}`}>Abrir tarea<GoalIcon name="external" /></a><button className="cg-button" disabled={busy} onClick={beginEdit}>Editar contenido</button></>}{canManage && piece.tarea_id && <button className={`cg-button${done(piece) ? '' : ' cg-primary'}`} disabled={busy || !finalizable} onClick={finish}>{busy ? 'Guardando…' : done(piece) ? 'Reabrir tarea' : finalizable ? 'Finalizar tarea' : 'Requiere aprobación'}</button>}</>}</footer></div></Modal>;
}
