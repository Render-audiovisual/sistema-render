import React, { useEffect, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { PageState } from '../components/PageState.jsx';
import './ClientesObjetivos.css';

const STATES = { pendiente: 'Pendiente', en_progreso: 'En proceso', en_revision: 'En revisión', programada: 'Programada', publicada: 'Completado' };
const AUTO_UPDATE_ERROR = 'No se pudo actualizar el avance. Reintentaremos automáticamente.';
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').slice(0, 2).join('-');
function monthLabel(period) { const [year, month] = period.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))); }
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'No se pudo cargar la información. Reintentá.');
  return data;
}
const done = piece => piece.estado === 'publicada';
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
  const [period, setPeriod] = useState(() => new URLSearchParams(window.location.search).get('periodo') || currentMonth());
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(''), [selectedPiece, setSelectedPiece] = useState(null);
  const [revision, setRevision] = useState(0), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState('');
  const canManage = ['admin', 'community'].includes(sesion?.usuario?.rol);
  const isDemo = ['127.0.0.1', 'localhost'].includes(window.location.hostname) && sesion?.usuario?.usuario === 'community-demo';
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null); setSelectedPiece(null);
    const params = new URLSearchParams(window.location.search); params.set('periodo', period);
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
    api(`/api/cliente-objetivos?periodo=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(result => { setData(result); setSelectedKey(key => result.clientes.some(client => client.clave === key) ? key : result.clientes[0]?.clave || ''); })
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, revision]);
  useEffect(() => {
    const controller = new AbortController();
    const update = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await api(`/api/cliente-objetivos?periodo=${encodeURIComponent(period)}`, { signal: controller.signal });
        setData(result);
        setSelectedPiece(piece => piece ? result.clientes.flatMap(client => client.piezas).find(item => item.id === piece.id) || null : null);
        setNotice(current => current === AUTO_UPDATE_ERROR ? '' : current);
      } catch (reason) { if (reason.name !== 'AbortError') setNotice(AUTO_UPDATE_ERROR); }
    };
    const timer = setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); controller.abort(); document.removeEventListener('visibilitychange', update); };
  }, [period]);
  const clients = data?.clientes || [];
  const filtered = clients;
  const client = filtered.find(item => item.clave === selectedKey) || filtered[0];
  const total = client ? client.reels + client.carruseles : 0;
  const completed = client?.piezas.filter(done).length || 0;
  const historic = period < '2026-10';

  return <main className="client-goals" aria-label="Objetivos mensuales de clientes"><div className="frame"><div className="content cg-content">
    <header className="cg-header"><div className="cg-heading-group"><span className="cg-page-icon"><GoalIcon name="clients" /></span><div><span className="cg-eyebrow">Seguimiento del equipo</span><h1>Clientes</h1><p>Todo el contenido del mes, en un mismo lugar.</p></div></div>
      <div className="cg-header-actions"><label className="cg-month"><span>Mes de trabajo</span><input aria-label="Mes de trabajo" type="month" value={period} onChange={event => { if (event.target.value) { setPeriod(event.target.value); setNotice(''); } }} /></label>
        {sesion?.usuario?.rol === 'admin' && <a className="cg-button" href={`/clientes?gestion=1&periodo=${period}`}>Administración</a>}
      </div></header>
    {isDemo && <p className="cg-demo" role="note"><span>Vista de ejemplo</span>Los cambios de esta vista no afectan al sistema publicado.</p>}
    {notice && <p className="cg-notice" role="status">{notice}</p>}
    {loading ? <GoalLoading /> : error ? <PageState type="error" title="No pudimos cargar los objetivos" description={error} onRetry={refresh} /> : clients.length === 0 ? <PageState type="empty" title="No hay clientes para este mes" description="Elegí otro período para consultar su seguimiento." /> : <div className="cg-layout">
      <aside className="cg-clients" aria-label="Elegir cliente"><div className="cg-clients-heading"><span>Clientes</span><span>{filtered.length}</span></div>
        <div className="cg-client-items">{filtered.map(item => {
          const count = item.piezas.filter(done).length, quantity = item.reels + item.carruseles;
          return <button className={`cg-client${item.clave === selectedKey ? ' is-selected' : ''}`} key={item.clave} aria-pressed={item.clave === selectedKey} aria-label={`${item.nombre}: ${item.preparado ? `${count} de ${quantity} completados` : 'Objetivo por preparar'}`} onClick={() => { setSelectedKey(item.clave); setSelectedPiece(null); }}>
            <span className="cg-avatar" aria-hidden="true">{item.nombre.slice(0, 1)}</span><span className="cg-client-text"><strong>{item.nombre}</strong><span className="cg-client-progress" aria-hidden="true"><span style={{width:`${quantity ? Math.min(100, count / quantity * 100) : 0}%`}} /></span></span><GoalIcon name="arrow" className="cg-client-arrow" />
          </button>;
        })}{filtered.length === 0 && <p className="cg-muted">No encontramos ese cliente.</p>}</div>
      </aside>
      <label className="cg-mobile-client"><span>Cliente</span><select aria-label="Elegir cliente" value={client?.clave || ''} disabled={!filtered.length} onChange={event => setSelectedKey(event.target.value)}>{!filtered.length && <option value="">Sin coincidencias</option>}{filtered.map(item => <option key={item.clave} value={item.clave}>{item.nombre}</option>)}</select>{!filtered.length && <small>No encontramos ese cliente.</small>}</label>
      {client && <section className="cg-board" key={client.clave} aria-label={`Objetivo mensual de ${client.nombre}`}>
        <div className="cg-board-summary"><header className="cg-board-header"><div><span className="cg-eyebrow">Objetivo mensual · {monthLabel(period)}</span><h2>{client.nombre}</h2>{client.cuentas.length > 1 && <p className="cg-shared">Objetivo compartido · {client.cuentas.map(account => account.nombre).join(' + ')}</p>}</div><div className={`cg-overall${total > 0 && completed === total ? ' is-complete' : ''}`}><span>Contenido completado</span><strong>{completed}<span> / {total}</span></strong></div></header>
        <div className="cg-progress" role="progressbar" aria-label="Avance mensual" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed}><span style={{ width: `${total ? Math.min(100, completed / total * 100) : 0}%` }} /></div>
        <div className="cg-progress-caption"><span>{client.preparado ? total > 0 && completed === total ? 'Objetivo del mes completado' : `${Math.max(0, total - completed)} piezas pendientes` : 'Objetivo por preparar'}</span><strong>{total ? Math.round(completed / total * 100) : 0}%</strong></div></div>
        {!client.preparado && <div className="cg-prepare-state"><strong>{historic ? 'El historial anterior se conserva' : 'Generación mensual automática'}</strong><p>{historic ? 'El nuevo seguimiento comienza en octubre. Podés consultar las piezas anteriores en Publicaciones.' : 'Las tareas del mes actual se crean automáticamente con los responsables del cliente. Si falta una asignación, configurala una vez. No se duplican tareas ni se cambia el historial.'}</p>
          {historic ? <a className="cg-button" href={`/planificacion-publicaciones?mes=${period}&cliente=${client.cliente_id}`}>Consultar publicaciones</a> : canManage ? <button className="cg-button cg-primary" onClick={() => setPreparing(true)}>Configurar responsables</button> : <small>La CM o el Líder pueden completar la asignación del cliente.</small>}
        </div>}
        <div className="cg-format-grid">{[['video', 'Reels', client.reels], ['carrusel', 'Carruseles', client.carruseles]].map(([type, label, quantity]) => {
          const pieces = client.piezas.filter(piece => piece.tipo === type), count = pieces.filter(done).length;
          return <section className={`cg-format cg-format-${type}`} key={type} aria-label={label}><header><h3><span className="cg-format-icon"><GoalIcon name={type === 'video' ? 'video' : 'carousel'} /></span>{label}</h3><span className={`cg-format-count${quantity > 0 && count === quantity ? ' is-complete' : ''}`}>{count} de {quantity}</span></header>
            <p className="cg-format-subtitle">{quantity === 0 ? 'No incluido este mes' : count === quantity ? 'Objetivo completado' : `${quantity - count === 1 ? 'Falta' : 'Faltan'} ${quantity - count} para completar el mes`}</p>
            <div className="cg-piece-list">{pieces.map(piece => <button key={piece.id} className={`cg-piece${done(piece) ? ' is-done' : ''}`} onClick={() => setSelectedPiece(piece)} aria-label={`${pieceLabel(piece)} · ${STATES[piece.estado] || piece.estado}`}>
              <span className="cg-check" aria-hidden="true">{done(piece) && <GoalIcon name="check" />}</span><span className="cg-piece-text"><strong>{pieceLabel(piece)}</strong><small className={`cg-state cg-state-${piece.estado}`}><span aria-hidden="true" />{STATES[piece.estado] || piece.estado}{!piece.tarea_id ? ' · Registro conservado' : ''}</small></span><GoalIcon name="arrow" className="cg-piece-arrow" />
            </button>)}{!client.preparado && quantity > 0 && <p className="cg-format-empty">{quantity} tareas previstas · aún sin vincular</p>}</div>
          </section>;
        })}</div>
        <footer className="cg-board-footer"><GoalIcon name="sync" /><p>Conectado con Tareas. Cada mes se generan las piezas con los responsables del cliente. El avance se actualiza al finalizar.</p>{canManage && client.preparado && <button className="cg-button" onClick={() => setPreparing(true)}>Responsables del cliente</button>}</footer>
      </section>}
    </div>}
    {preparing && client && <PrepareGoal client={client} period={period} close={() => setPreparing(false)} saved={result => { setPreparing(false); setNotice(`${result.vinculadas} tareas vinculadas · ${result.creadas} tareas nuevas. El objetivo está preparado.`); refresh(); }} />}
    {selectedPiece && <PieceDetail piece={selectedPiece} client={client} canManage={canManage} close={() => setSelectedPiece(null)} saved={() => { setSelectedPiece(null); refresh(); }} />}
  </div></div></main>;
}

function PrepareGoal({ client, period, close, saved }) {
  useGoalModalFocus();
  const [users, setUsers] = useState([]), [selected, setSelected] = useState(() => Object.fromEntries(['video','carrusel'].map(type => [type,(client.responsables_por_formato?.[type] || []).map(user => user.id)]))), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); api('/api/cliente-objetivos/responsables', { signal: controller.signal }).then(setUsers).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); }); return () => controller.abort(); }, []);
  const submit = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { saved(await api('/api/cliente-objetivos/preparar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodo: period, clave: client.clave, responsables: [...new Set(Object.values(selected).flat())], responsables_por_formato: selected }) })); }
    catch (reason) { setError(reason.message); setBusy(false); }
  };
  return <Modal title="Responsables del cliente" overlayAriaLabel="Responsables del cliente" onClose={() => { if (!busy) close(); }} className="cg-modal"><form className="cg-modal-body" onSubmit={submit}><h2>{client.nombre}</h2><p>Esta asignación se reutiliza cada mes. Las tareas existentes mantienen sus responsables.</p>{[['video','Reels',client.reels],['carrusel','Carruseles',client.carruseles]].map(([type,label,quantity]) => <fieldset className="cg-responsables" key={type}><legend>{label}</legend><small>{quantity} piezas · podés elegir varias personas, sin responsable principal.</small>{users.map(user => <label key={user.id}><input type="checkbox" disabled={busy} checked={selected[type].includes(user.id)} onChange={() => setSelected(current => ({...current,[type]:current[type].includes(user.id) ? current[type].filter(id => id !== user.id) : [...current[type],user.id]}))} /><span>{user.nombre}</span></label>)}</fieldset>)}<p className="cg-muted">Se vinculan las tareas existentes y se crean únicamente las que faltan para el mes seleccionado.</p>{error && <p className="cg-error" role="alert">{error}</p>}<footer><button className="cg-button" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="cg-button cg-primary" disabled={busy || (client.reels > 0 && !selected.video.length) || (client.carruseles > 0 && !selected.carrusel.length) || !Object.values(selected).flat().length}>{busy ? 'Guardando…' : 'Guardar responsables'}</button></footer></form></Modal>;
}

function PieceDetail({ piece, client, canManage, close, saved }) {
  useGoalModalFocus();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const [editing,setEditing] = useState(false), [title,setTitle] = useState(piece.titulo), [copy,setCopy] = useState(piece.copy || ''), [taskVersion,setTaskVersion] = useState('');
  const beginEdit = async () => {
    setBusy(true); setError('');
    try { const task = await api(`/api/tareas/${piece.tarea_id}?workspace=render_os`); setTaskVersion(task.updated_at); setTitle(task.titulo); setCopy(task.propiedades_extra?.copy_trabajo ?? piece.copy ?? ''); setEditing(true); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const saveContent = async () => {
    if (busy) return; setBusy(true); setError('');
    try { await api(`/api/cliente-objetivos/piezas/${piece.id}/contenido`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({titulo:title,copy,expected_updated_at:taskVersion})}); saved(); }
    catch (reason) { setError(reason.message); setBusy(false); }
  };
  const finish = async () => {
    if (busy) return;
    if (done(piece) && !window.confirm('¿Reabrir esta tarea y dejar la pieza pendiente? El cambio quedará registrado.')) return;
    setBusy(true); setError('');
    try {
      const task = await api(`/api/tareas/${piece.tarea_id}?workspace=render_os`);
      await api(`/api/tareas/${piece.tarea_id}?workspace=render_os`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: done(piece) ? 'pendiente' : 'publicada', expected_updated_at: task.updated_at }) });
      saved();
    } catch (reason) { setError(reason.message); setBusy(false); }
  };
  return <Modal title={<span className="cg-detail-breadcrumb"><GoalIcon name={piece.tipo === 'video' ? 'video' : 'carousel'} />{client?.nombre} <span aria-hidden="true">/</span> {piece.tipo === 'video' ? 'Reel' : 'Carrusel'}</span>} overlayAriaLabel="Detalle de la pieza" onClose={() => { if (!busy) close(); }} className="cg-modal"><div className="cg-modal-body"><span className={`cg-detail-state${done(piece) ? ' is-done' : ''}`}>{done(piece) && <GoalIcon name="check" />}{STATES[piece.estado] || piece.estado}</span><h2>{pieceLabel(piece)}</h2><div className="cg-detail-responsables"><GoalIcon name="clients" /><div><span>Responsables</span><p>{piece.responsables.join(' · ') || 'Sin responsables registrados'}</p></div></div><div className="cg-copy-heading"><h3>Copy de la publicación</h3>{piece.copy && <button className="cg-button" onClick={async () => { try { await navigator.clipboard.writeText(piece.copy); setCopied(true); } catch { setError('No se pudo copiar. Podés seleccionar el texto manualmente.'); } }}><GoalIcon name={copied ? 'check' : 'copy'} />{copied ? 'Copiado' : 'Copiar texto'}</button>}</div><div className={`cg-copy${!piece.copy ? ' is-empty' : ''}`}>{piece.copy || 'Todavía no hay un copy guardado para esta pieza. Podés cargarlo en la tarea vinculada.'}</div>
    {editing && <div className="cg-content-editor"><label>Título<input maxLength={500} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>Copy<textarea maxLength={20000} value={copy} disabled={busy} onChange={event => setCopy(event.target.value)} rows={6} /></label><p>Se guarda también en la tarea. No cambia su estado ni sus responsables.</p></div>}
    {piece.completada_at && <p className="cg-muted cg-completion-date"><GoalIcon name="check" />Completada el {new Date(piece.completada_at).toLocaleDateString('es-AR')}</p>}{!piece.tarea_id && <p className="cg-muted">La tarea ya no está disponible. El resultado mensual y su contenido se conservaron.</p>}{error && <p className="cg-error" role="alert">{error}</p>}<footer>{editing ? <><button className="cg-button" disabled={busy} onClick={() => setEditing(false)}>Cancelar edición</button><button className="cg-button cg-primary" disabled={busy || !title.trim()} onClick={saveContent}>{busy ? 'Guardando…' : 'Guardar contenido'}</button></> : <>{piece.tarea_id && <><a className="cg-button" href={`/workspace/tareas?task=${piece.tarea_id}`}>Abrir tarea<GoalIcon name="external" /></a><button className="cg-button" disabled={busy} onClick={beginEdit}>Editar contenido</button></>}{canManage && piece.tarea_id && <button className={`cg-button${done(piece) ? '' : ' cg-primary'}`} disabled={busy} onClick={finish}>{busy ? 'Guardando…' : done(piece) ? 'Reabrir tarea' : 'Finalizar tarea'}</button>}</>}</footer></div></Modal>;
}
