import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSesion } from '../utils.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { evidenceFromStatus, isConfirmedPublication, isHistoricalPublication } from '../shared/editorial/publication-evidence.js';
import { cordobaOccurrence, createEditorialAttempt, createEditorialSessionGuard, validateEditorialStatus } from './EditorialPublicationControl.model.js';
import './EditorialPublicationControl.css';

export function EditorialPublicationControl(props) {
  const sesion = props.sesion || getSesion();
  return <PublicationControl key={`${props.dominio}:${props.pieza.id}:${props.pieza.cliente_id}:${sesion?.usuario?.id}:${sesion?.usuario?.rol}:${sesion?.token || ''}`} {...props} sesion={sesion} />;
}

function PublicationControl({ dominio, pieza, sesion, onSaved, hideSummary = false, openLabel = 'Ver publicación', onOpenChange }) {
  const [open, setOpen] = useState(false), [status, setStatus] = useState(null), [date, setDate] = useState('');
  const [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(null);
  const dialog = useRef(null), alive = useRef(true), read = useRef(null), readGeneration = useRef(0);
  const writer = useRef(null);
  const sessionGuard = useRef(null);
  useEffect(() => {
    onOpenChange?.(open);
    return () => { if (open) onOpenChange?.(false); };
  }, [open, onOpenChange]);
  if (!sessionGuard.current) sessionGuard.current = createEditorialSessionGuard(sesion, getSesion, () => {
    read.current?.abort(); readGeneration.current++; writer.current?.cancel();
    if (alive.current) { setStatus(null); setUncertain(null); setAck(false); setBusy(false); setLoading(false); setError('La sesión cambió. Cerrá este registro y volvé a abrirlo desde la sesión actual.'); }
  });
  const guardedRequest = (url, options) => sessionGuard.current.request(apiRequest, url, options);
  if (!writer.current) writer.current = createEditorialAttempt(guardedRequest, undefined, pieza, () => sessionGuard.current.isCurrent());
  const admin = sesion?.usuario?.rol === 'admin' && Number.isSafeInteger(sesion?.usuario?.id) && sesion.usuario.id > 0;
  useEffect(() => { alive.current = true; return () => { alive.current = false; read.current?.abort(); writer.current.cancel(); sessionGuard.current.cancel(); }; }, []);
  async function load() {
    if (!sessionGuard.current.isCurrent()) return;
    read.current?.abort(); const generation = ++readGeneration.current;
    read.current = new AbortController(); setLoading(true); setError('');
    try {
      const dto = await guardedRequest(`/api/editorial-publicacion/${dominio}/${pieza.id}`, { signal: read.current.signal });
      if (!alive.current || !sessionGuard.current.isCurrent() || !dto || generation !== readGeneration.current) return;
      if (!evidenceFromStatus(dto) || dto.piece.id !== pieza.id || dto.piece.dominio !== dominio) throw new Error();
      validateEditorialStatus(dto, pieza, dominio);
      setStatus(dto); setConflict(false); setAck(false);
    } catch { if (alive.current && sessionGuard.current.isCurrent() && generation === readGeneration.current) { setStatus(null); setError('No se pudo validar el registro o cambió de cliente. Reintentá la consulta o recargá la lista.'); } }
    finally { if (alive.current && sessionGuard.current.isCurrent() && generation === readGeneration.current) setLoading(false); }
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) setOpen(false); }
      if (event.key === 'Tab') {
        const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus?.(); };
  }, [open, busy]);
  async function save() {
    if (!sessionGuard.current.isCurrent()) return;
    if (busy || !status || !admin || conflict || loading) return;
    let intent;
    try {
      intent = uncertain || { action: status.current_confirmation ? 'retirar' : 'confirmar', revision: status.piece.revision,
        occurredAt: status.current_confirmation ? undefined : cordobaOccurrence(date) };
    } catch (err) { setError(err.message); return; }
    setBusy(true); setError('');
    try {
      const dto = await writer.current.send(dominio, pieza.id, intent.action, intent.revision, intent.occurredAt);
      if (!alive.current || !sessionGuard.current.isCurrent() || !dto) return;
      setStatus(dto); setUncertain(null); setAck(false);
      try { onSaved?.(dto); } catch { setError('Registro guardado; no se pudo actualizar la lista.'); }
    } catch (err) {
      if (!alive.current || !sessionGuard.current.isCurrent()) return;
      setConflict(err.status === 409);
      setUncertain(writer.current.pending ? intent : null);
      if (err.message.includes('Recargá la lista')) { setStatus(null); setError('La pieza cambió de contexto. Recargá la lista antes de continuar.'); }
      else setError(err.status === 409 ? 'El registro cambió. Consultá la revisión actual y revisá tu intención antes de confirmar.' : writer.current.pending ? 'Resultado incierto. Solo podés reintentar exactamente el mismo intento.' : 'No se pudo guardar el registro.');
    } finally { if (alive.current && sessionGuard.current.isCurrent()) setBusy(false); }
  }
  const label = isConfirmedPublication(pieza) ? 'Confirmada manualmente' : isHistoricalPublication(pieza) ? 'Histórica · sin confirmación' : 'Sin confirmación';
  return <span className="ep-control" onClick={event => event.stopPropagation()}>
    {!hideSummary && <span>{label}</span>}<button type="button" onClick={() => { setOpen(true); if (!uncertain) load(); }}>{openLabel}</button>
    {open && createPortal(<div className="ep-overlay"><section className="ep-dialog" role="dialog" aria-modal="true" aria-label="Registro de publicación" tabIndex={-1} ref={dialog}>
      <h2>Registro de publicación</h2><p>Registro manual; no es una verificación externa. {dominio === 'historia' ? 'Historia' : 'Publicación'} #{pieza.id} · Cliente #{pieza.cliente_id}.</p>
      {loading && <p role="status">Consultando registro…</p>}{error && <p role="alert">{error}</p>}
      {status && <><p>{status.classification === 'confirmada_manualmente' ? 'Confirmada manualmente' : status.classification === 'historica_sin_confirmacion' ? 'Histórica sin confirmación' : 'Sin publicación confirmada'} · Versión {status.piece.revision}</p>
        {status.current_confirmation && <p>Actor #{status.current_confirmation.actor_id} · {new Date(status.current_confirmation.occurred_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' })} (Córdoba)</p>}
        {admin && (status.can_confirm || status.current_confirmation) && <><label>Fecha y hora real · Córdoba (UTC−03:00)<input type="datetime-local" value={date} disabled={busy || !!uncertain || !!status.current_confirmation} onChange={event => setDate(event.target.value)} /></label>
          <label><input type="checkbox" checked={ack} disabled={busy || !!uncertain} onChange={event => setAck(event.target.checked)} /> {status.current_confirmation ? 'Confirmo que quiero retirar esta confirmación manual.' : 'Confirmo que esta pieza efectivamente se publicó en esa fecha y hora.'}</label></>}
        {!admin && <p>Solo administración puede confirmar o retirar publicaciones.</p>}</>}
      <footer><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cerrar</button>
        {!uncertain && <button type="button" disabled={busy || loading} onClick={load}>{conflict ? 'Consultar nueva revisión' : 'Actualizar registro'}</button>}
        {admin && (status?.can_confirm || status?.current_confirmation) && <button type="button" disabled={busy || loading || conflict || (!uncertain && (!ack || (!status.current_confirmation && !date)))} onClick={save}>{busy ? 'Guardando…' : uncertain ? 'Reintentar mismo intento' : status.current_confirmation ? 'Retirar confirmación' : 'Confirmar publicación'}</button>}
      </footer>
    </section></div>, document.body)}
  </span>;
}
