import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { createEditingDeliveriesModel, deliveryUrl, isEditingDeliveryTask } from './EditingDeliveries.model.js';
import './EditingDeliveries.css';

export function EditingDeliveries({ task, sesion, onSaved, onDirty, onBusy, onReviewContext }) {
  if (!isEditingDeliveryTask(task)) return null;
  return <DeliverySection key={`${task.id}:${sesion?.usuario?.id}:${sesion?.usuario?.rol}:${sesion?.token || ''}`} task={task} sesion={sesion} onSaved={onSaved} onDirty={onDirty} onBusy={onBusy} onReviewContext={onReviewContext} />;
}
function DeliveryEntry({ item }) {
  return <article className="editing-delivery-entry"><a href={item.url} target="_blank" rel="noopener noreferrer">Abrir versión entregada ↗</a>
    <small>Actor #{item.actor_id} · {new Date(item.recorded_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' })} (Córdoba) · Versión de tarea {item.task_revision}</small>
    {item.notes && <p>{item.notes}</p>}</article>;
}
function DeliverySection({ task, sesion, onSaved, onDirty, onBusy, onReviewContext }) {
  const [url, setUrl] = useState(''), [notes, setNotes] = useState('');
  const [state, setState] = useState({ loading: true, busy: false, data: null, uncertain: false, accepted: null });
  const model = useRef(null), saved = useRef(onSaved), reviewContext = useRef(onReviewContext);
  saved.current = onSaved;
  reviewContext.current = onReviewContext;
  useEffect(() => {
    const instance = createEditingDeliveriesModel({ task, sesion, readSession: getSesion, request: apiRequest, onChange: setState,
      onReviewContext: context => reviewContext.current?.(context),
      onSaved: async (dto, isCurrent) => { await saved.current?.(dto, isCurrent); } });
    model.current = instance; void instance.refresh();
    return () => { instance.dispose(); if (model.current === instance) model.current = null; };
  }, []);
  useEffect(() => { if (state.accepted) { setUrl(''); setNotes(''); } }, [state.accepted]);
  const dirty = Boolean(url || notes || state.uncertain);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy?.(Boolean(state.busy)); return () => onBusy?.(false); }, [state.busy, onBusy]);
  const latest = state.data?.deliveries.at(-1);
  let rawUrl = null;
  try { if (task.material_referencia) rawUrl = deliveryUrl(task.material_referencia); } catch { /* Unsafe raw links remain plain text. */ }
  return <section className="editing-deliveries" aria-label="Entregas de edición">
    <header><h3>Entregas de edición</h3><button type="button" disabled={state.loading || state.busy || state.uncertain} onClick={() => model.current?.refresh()}>Actualizar historial</button></header>
    <div className="editing-delivery-raw"><strong>Material de origen</strong>{rawUrl ? <a href={rawUrl} target="_blank" rel="noopener noreferrer">Abrir material de referencia ↗</a> : <span>{task.material_referencia || 'Sin enlace de origen.'}</span>}<small>Es una referencia para editar, no una versión entregada.</small></div>
    {state.loading && <p role="status">Consultando entregas…</p>}
    {state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    {state.data && <><div className="editing-delivery-latest"><h4>Última entrega registrada</h4>{latest ? <DeliveryEntry item={latest} /> : <p>Sin entrega registrada.</p>}<small>Una entrega anterior no acredita aprobación del contenido actual. La revisión y las correcciones siguen en el flujo de la tarea y sus comentarios.</small></div>
      {state.data.deliveries.length > 1 && <details><summary>Historial · {state.data.deliveries.length} entregas</summary>{state.data.deliveries.slice(0, -1).reverse().map(item => <DeliveryEntry key={item.id} item={item} />)}</details>}
      {state.data.can_deliver ? <form onSubmit={event => { event.preventDefault(); if (!state.uncertain) void model.current?.submit({ url, notes }); }}>
        <label>Enlace de la versión editada<input type="url" maxLength={2000} required value={url} disabled={state.busy || state.uncertain} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>
        <label>Notas de esta entrega (opcional)<textarea rows={3} maxLength={4000} value={notes} disabled={state.busy || state.uncertain} onChange={event => setNotes(event.target.value)} /></label>
        {state.uncertain ? <button type="button" disabled={state.busy} onClick={() => model.current?.retry()}>Reintentar el mismo envío</button> : <button type="submit" disabled={state.loading || state.busy || state.conflict || !url.trim()}>{state.busy ? 'Registrando entrega…' : 'Entregar versión y enviar a revisión'}</button>}
      </form> : <p className="editing-delivery-help">Podés consultar el historial. Solo administración o un miembro actualmente asignado puede entregar, si el estado de la tarea lo permite.</p>}
    </>}
  </section>;
}
