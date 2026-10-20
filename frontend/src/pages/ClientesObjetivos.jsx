import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import { Modal } from '../components/Modal.jsx';
import { PageState } from '../components/PageState.jsx';
import './ClientesObjetivos.css';

const STATES = { pendiente: 'Pendiente', en_progreso: 'En proceso', en_revision: 'En revisión', aprobada: 'Aprobada', finalizada: 'Finalizada', programada: 'Programada', publicada: 'Finalizada' };
const AUTO_UPDATE_ERROR = 'No se pudo actualizar el avance. Reintentaremos automáticamente.';
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').slice(0, 2).join('-');
function monthLabel(period) { const [year, month] = period.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))); }
function goalPeriod(search) {
  const values = new URLSearchParams(search).getAll('periodo');
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
  if (!initial.current) { try { initial.current = { period: goalPeriod(window.location.search), error: '' }; } catch (reason) { initial.current = { period: currentMonth(), error: reason.message }; } }
  const [period, setPeriod] = useState(initial.current.period), [locationError, setLocationError] = useState(initial.current.error);
  const { view, capture, epoch } = useGoalSession(sesion, period);
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(''), [selectedPiece, setSelectedPiece] = useState(null);
  const [revision, setRevision] = useState(0), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState('');
  const modalOpen = useRef(false), deferred = useRef(false), pendingPeriod = useRef(null), readGeneration = useRef(0), loaded = useRef(false);
  modalOpen.current = Boolean(preparing || selectedPiece);
  const canManage = ['admin', 'community'].includes(view.role);
  const isDemo = ['127.0.0.1', 'localhost'].includes(window.location.hostname) && sesion?.usuario?.usuario === 'community-demo';
  const refresh = () => { if (modalOpen.current) { deferred.current = true; return; } setRevision(value => value + 1); };
  const closeModal = () => {
    modalOpen.current = false; setPreparing(false); setSelectedPiece(null);
    if (pendingPeriod.current) { const next = pendingPeriod.current; pendingPeriod.current = null; setPeriod(next.period); setLocationError(next.error); }
    if (deferred.current) { deferred.current = false; setRevision(value => value + 1); }
  };
  useEffect(() => {
    const pop = () => {
      let next; try { next = { period: goalPeriod(window.location.search), error: '' }; } catch (reason) { next = { period, error: reason.message }; }
      if (modalOpen.current) {
        pendingPeriod.current = next;
        const params = new URLSearchParams(window.location.search); params.set('periodo', period);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
        setNotice('El cambio de mes se aplicará al cerrar el detalle.'); return;
      }
      setPeriod(next.period); setLocationError(next.error);
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [period]);
  useEffect(() => {
    const controller = new AbortController();
    const scope = capture(), generation = ++readGeneration.current;
    loaded.current = false; setLoading(true); setError(''); setData(null);
    if (locationError) { setError(locationError); setLoading(false); return () => controller.abort(); }
    const params = new URLSearchParams(window.location.search); params.set('periodo', period);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
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
  const client = filtered.find(item => item.clave === selectedKey) || filtered[0];
  const total = client ? client.reels + client.carruseles : 0;
  const completed = client?.piezas.filter(done).length || 0;
  const historic = period < '2026-10';

  return <main className="client-goals" aria-label="Objetivos mensuales de clientes"><div className="frame"><div className="content cg-content">
    <header className="cg-header"><div className="cg-heading-group"><span className="cg-page-icon"><GoalIcon name="clients" /></span><div><span className="cg-eyebrow">Seguimiento del equipo</span><h1>Clientes</h1><p>Todo el contenido del mes, en un mismo lugar.</p></div></div>
      <div className="cg-header-actions"><label className="cg-month"><span>Mes de trabajo</span><input aria-label="Mes de trabajo" type="month" value={period} disabled={Boolean(preparing || selectedPiece)} onChange={event => { if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { setPeriod(event.target.value); setLocationError(''); setNotice(''); } }} /></label>
      </div></header>
    {isDemo && <p className="cg-demo" role="note"><span>Vista de ejemplo</span>Los cambios de esta vista no afectan al sistema publicado.</p>}
    {notice && <p className="cg-notice" role="status">{notice}</p>}
    {loading ? <GoalLoading /> : error ? <PageState type="error" title="No pudimos cargar los objetivos" description={error} onRetry={refresh} /> : clients.length === 0 ? <PageState type="empty" title="No hay clientes para este mes" description="Elegí otro período para consultar su seguimiento." /> : <div className="cg-layout">
      <aside className="cg-clients" aria-label="Elegir cliente"><div className="cg-clients-heading"><span>Clientes</span><span>{filtered.length}</span></div>
        <div className="cg-client-items">{filtered.map(item => {
          const count = item.piezas.filter(done).length, quantity = item.reels + item.carruseles;
          return <button className={`cg-client${item.clave === selectedKey ? ' is-selected' : ''}`} disabled={Boolean(preparing || selectedPiece)} key={item.clave} aria-pressed={item.clave === selectedKey} aria-label={`${item.nombre}: ${item.preparado ? `${count} de ${quantity} completados` : 'Objetivo por preparar'}`} onClick={() => { setSelectedKey(item.clave); setSelectedPiece(null); }}>
            <span className="cg-avatar" aria-hidden="true">{item.nombre.slice(0, 1)}</span><span className="cg-client-text"><strong>{item.nombre}</strong><span className="cg-client-progress" aria-hidden="true"><span style={{width:`${quantity ? Math.min(100, count / quantity * 100) : 0}%`}} /></span></span><GoalIcon name="arrow" className="cg-client-arrow" />
          </button>;
        })}{filtered.length === 0 && <p className="cg-muted">No encontramos ese cliente.</p>}</div>
      </aside>
      <label className="cg-mobile-client"><span>Cliente</span><select aria-label="Elegir cliente" value={client?.clave || ''} disabled={!filtered.length || Boolean(preparing || selectedPiece)} onChange={event => setSelectedKey(event.target.value)}>{!filtered.length && <option value="">Sin coincidencias</option>}{filtered.map(item => <option key={item.clave} value={item.clave}>{item.nombre}</option>)}</select>{!filtered.length && <small>No encontramos ese cliente.</small>}</label>
      {client && <section className="cg-board" key={client.clave} aria-label={`Objetivo mensual de ${client.nombre}`}>
        <div className="cg-board-summary"><header className="cg-board-header"><div><span className="cg-eyebrow">Objetivo mensual · {monthLabel(period)}</span><h2>{client.nombre}</h2>{client.cuentas.length > 1 && <p className="cg-shared">Objetivo compartido · {client.cuentas.map(account => account.nombre).join(' + ')}</p>}</div><div className={`cg-overall${total > 0 && completed === total ? ' is-complete' : ''}`}><span>Contenido completado</span><strong>{completed}<span> / {total}</span></strong></div></header>
        <div className="cg-progress" role="progressbar" aria-label="Avance mensual" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed}><span style={{ width: `${total ? Math.min(100, completed / total * 100) : 0}%` }} /></div>
        <div className="cg-progress-caption"><span>{client.preparado ? total > 0 && completed === total ? 'Objetivo del mes completado' : `${Math.max(0, total - completed)} piezas pendientes` : 'Objetivo por preparar'}</span><strong>{total ? Math.round(completed / total * 100) : 0}%</strong></div></div>
        {!client.preparado && <div className="cg-prepare-state"><strong>{historic ? 'El historial anterior se conserva' : 'Generación mensual automática'}</strong><p>{historic ? 'El nuevo seguimiento comienza en octubre. Podés consultar las piezas anteriores en Publicaciones.' : 'Las tareas del mes actual se crean automáticamente con los responsables del cliente. Si falta una asignación, configurala una vez. No se duplican tareas ni se cambia el historial.'}</p>
          {historic ? <a className="cg-button" href={`/planificacion-publicaciones?mes=${period}&cliente=${client.cliente_id}`}>Consultar publicaciones</a> : canManage ? <button className="cg-button cg-primary" onClick={() => { modalOpen.current = true; setPreparing(true); }}>Configurar responsables</button> : <small>La CM o el Líder pueden completar la asignación del cliente.</small>}
        </div>}
        <div className="cg-format-grid">{[['video', 'Reels', client.reels], ['carrusel', 'Carruseles', client.carruseles]].map(([type, label, quantity]) => {
          const pieces = client.piezas.filter(piece => piece.tipo === type), count = pieces.filter(done).length;
          return <section className={`cg-format cg-format-${type}`} key={type} aria-label={label}><header><h3><span className="cg-format-icon"><GoalIcon name={type === 'video' ? 'video' : 'carousel'} /></span>{label}</h3><span className={`cg-format-count${quantity > 0 && count === quantity ? ' is-complete' : ''}`}>{count} de {quantity}</span></header>
            <p className="cg-format-subtitle">{quantity === 0 ? 'No incluido este mes' : count === quantity ? 'Objetivo completado' : `${quantity - count === 1 ? 'Falta' : 'Faltan'} ${quantity - count} para completar el mes`}</p>
            <div className="cg-piece-list">{pieces.map(piece => <button key={piece.id} className={`cg-piece${done(piece) ? ' is-done' : ''}`} onClick={() => { modalOpen.current = true; setSelectedPiece(piece); }} aria-label={`${pieceLabel(piece)} · ${STATES[piece.estado] || piece.estado}`}>
              <span className="cg-check" aria-hidden="true">{done(piece) && <GoalIcon name="check" />}</span><span className="cg-piece-text"><strong>{pieceLabel(piece)}</strong><small className={`cg-state cg-state-${piece.estado}`}><span aria-hidden="true" />{STATES[piece.estado] || piece.estado}{!piece.tarea_id ? ' · Registro conservado' : ''}</small></span><GoalIcon name="arrow" className="cg-piece-arrow" />
            </button>)}{!client.preparado && quantity > 0 && <p className="cg-format-empty">{quantity} tareas previstas · aún sin vincular</p>}</div>
          </section>;
        })}</div>
        <footer className="cg-board-footer"><GoalIcon name="sync" /><p>Conectado con Tareas. Cada mes se generan las piezas con los responsables del cliente. El avance se actualiza al finalizar.</p>{canManage && client.preparado && <button className="cg-button" onClick={() => { modalOpen.current = true; setPreparing(true); }}>Responsables del cliente</button>}</footer>
      </section>}
    </div>}
    {preparing && client && <PrepareGoal key={`${epoch}:${period}:${client.clave}`} sesion={view.session} client={client} period={period} close={closeModal} saved={result => { closeModal(); setNotice(`${result.vinculadas} tareas vinculadas · ${result.creadas} tareas nuevas. El objetivo está preparado.`); refresh(); }} />}
    {selectedPiece && client && <PieceDetail key={`${epoch}:${period}:${client.clave}:${selectedPiece.id}:${selectedPiece.tarea_id}`} sesion={view.session} piece={selectedPiece} client={client} canManage={canManage} close={closeModal} saved={() => { closeModal(); refresh(); }} />}
  </div></div></main>;
}

function PrepareGoal({ sesion, client, period, close, saved }) {
  useGoalModalFocus();
  const { capture, captureLifetime } = useGoalSession(sesion, `${period}:${client.clave}`);
  const pending = useRef(false);
  const shared = client.cuentas.length > 1;
  const [users, setUsers] = useState([]), [selected, setSelected] = useState(() => Object.fromEntries(['video','carrusel'].map(type => [type,(client.responsables_por_formato?.[type] || []).map(user => user.id)]))), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [accounts, setAccounts] = useState(() => Object.fromEntries(client.cuentas.map(account => [account.id,
    (client.responsables_por_cuenta?.[account.id] || client.responsables_por_formato?.carrusel || []).map(user => user.id)])));
  const formats = { ...selected, carrusel: shared ? [...new Set(Object.values(accounts).flat())] : selected.carrusel };
  const initialSelection = useRef(JSON.stringify({ selected, accounts }));
  const closeSafely = () => {
    if (pending.current || !capture().current()) return;
    if (JSON.stringify({ selected, accounts }) !== initialSelection.current && !window.confirm('¿Descartar los cambios de responsables sin guardar?')) return;
    close();
  };
  const fields = [{key:'video',label:'Reels',quantity:client.reels,ids:selected.video}, ...(shared
    ? client.cuentas.map(account => ({key:String(account.id),label:`Carruseles · ${account.nombre}`,ids:accounts[account.id]}))
    : [{key:'carrusel',label:'Carruseles',quantity:client.carruseles,ids:selected.carrusel}])];
  const toggle = (field, id) => {
    const update = current => ({...current,[field.key]:current[field.key].includes(id) ? current[field.key].filter(value => value !== id) : [...current[field.key],id]});
    if (shared && field.key !== 'video') setAccounts(update); else setSelected(update);
  };
  useEffect(() => { const controller = new AbortController(), scope = capture(); scope.request('/api/cliente-objetivos/responsables', { signal: controller.signal }).then(value => { if (!Array.isArray(value) || value.some(user => !goalId(user.id) || typeof user.nombre !== 'string') || new Set(value.map(user => user.id)).size !== value.length) throw new Error('Responsables inválidos.'); if (scope.current() && !controller.signal.aborted) setUsers(value); }).catch(reason => { if (scope.current() && !controller.signal.aborted && !isSessionFailure(reason)) setError(reason.message); }); return () => controller.abort(); }, [capture]);
  const submit = async event => {
    event.preventDefault(); if (pending.current) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    pending.current = true; setBusy(true); setError('');
    const body = JSON.stringify({ periodo: period, clave: client.clave, responsables: [...new Set(Object.values(formats).flat())], responsables_por_formato: formats, ...(shared ? {responsables_por_cuenta:accounts} : {}) });
    try { const result = await scope.request('/api/cliente-objetivos/preparar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!goalId(result?.objetivo_id) || ![result.creadas,result.vinculadas].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('No se pudo verificar la preparación. Revisá el resultado antes de reintentar.');
      scope.assertCurrent(); saved(result);
    } catch (reason) { if (scope.current() && !isSessionFailure(reason)) setError(reason.message); }
    finally { pending.current = false; if (lifetime.current()) setBusy(false); }
  };
  return <Modal title="Responsables del cliente" overlayAriaLabel="Responsables del cliente" onClose={closeSafely} className="cg-modal"><form className={`cg-modal-body${shared ? ' cg-shared-responsables' : ''}`} onSubmit={submit}>
    <h2>{client.nombre}</h2><p>Esta asignación se reutiliza cada mes. Las tareas existentes mantienen sus responsables.</p>
    {shared && <p className="cg-muted">{client.carruseles} carruseles compartidos entre las cuentas, no por cuenta. Cada tarea nueva usa los responsables de su cuenta; los reels mantienen una asignación común.</p>}
    {fields.map(field => <fieldset className="cg-responsables" key={field.key}><legend>{field.label}</legend>
      <small>{field.quantity !== undefined ? `${field.quantity} piezas · ` : ''}Podés elegir varias personas, sin responsable principal.</small>
      {users.map(user => <label key={user.id}><input type="checkbox" disabled={busy} checked={field.ids.includes(user.id)} onChange={() => toggle(field,user.id)} /><span>{user.nombre}</span></label>)}
    </fieldset>)}
    <p className="cg-muted">Se vinculan las tareas existentes y se crean únicamente las que faltan para el mes seleccionado.</p>{error && <p className="cg-error" role="alert">{error}</p>}
    <footer><button className="cg-button" type="button" disabled={busy} onClick={closeSafely}>Cancelar</button><button className="cg-button cg-primary" disabled={busy || (client.reels > 0 && !selected.video.length) || (shared ? Object.values(accounts).some(ids => !ids.length) : client.carruseles > 0 && !selected.carrusel.length) || !Object.values(formats).flat().length}>{busy ? 'Guardando…' : 'Guardar responsables'}</button></footer>
  </form></Modal>;
}

function PieceDetail({ sesion, piece, client, canManage, close, saved }) {
  useGoalModalFocus();
  const { capture, captureLifetime } = useGoalSession(sesion, `${client.clave}:${piece.id}:${piece.tarea_id}`);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const [editing,setEditing] = useState(false), [title,setTitle] = useState(piece.titulo), [copy,setCopy] = useState(piece.copy || ''), [taskVersion,setTaskVersion] = useState(''), [taskRevision,setTaskRevision] = useState(null);
  const editBaseline = useRef(null);
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
