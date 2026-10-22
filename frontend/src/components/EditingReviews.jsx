import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { sessionViewKey } from '../shared/session/session-view.js';
import { isEditingDeliveryTask } from './EditingDeliveries.model.js';
import { createEditingReviewsModel } from './EditingReviews.model.js';
import './EditingReviews.css';

const dateLabel = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
export function EditingReviews({ task, sesion, onSaved, onDirty, onBusy, disabled = false }) {
  if (!isEditingDeliveryTask(task)) return null;
  return <ReviewsSection key={`${task.id}:${sessionViewKey(sesion)}`} task={task} sesion={sesion} onSaved={onSaved} onDirty={onDirty} onBusy={onBusy} disabled={disabled} />;
}
function ReviewsSection({ task, sesion, onSaved, onDirty, onBusy, disabled }) {
  const [state, setState] = useState({ data: null, loading: true, notes: '', acknowledged: false, busy: false, uncertain: false });
  const model = useRef(null), saved = useRef(onSaved), observed = useRef({ revision: task.revision, estado: task.estado }); saved.current = onSaved;
  useEffect(() => {
    const instance = createEditingReviewsModel({ task, sesion, disabled, request: apiRequest, readSession: getSesion, onChange: setState,
      onSaved: async (dto, isCurrent) => { await saved.current?.(dto, isCurrent); } });
    model.current = instance; void instance.refresh();
    return () => { instance.dispose(); if (model.current === instance) model.current = null; };
  }, []);
  useEffect(() => {
    const changed = observed.current.revision !== task.revision || observed.current.estado !== task.estado;
    observed.current = { revision: task.revision, estado: task.estado };
    const instance = model.current;
    instance?.updateContext(task, disabled);
    // Approval/delivery actions elsewhere in this detail change the task. Read
    // the fresh history automatically only when no correction intent is at risk.
    const current = instance?.snapshot;
    if (changed && current && !current.busy && !current.uncertain && !current.notes) void instance.refresh();
  }, [task.id, task.revision, task.estado, task.tipo_tarea, task.propiedades_extra?.workspace, task.workspace, disabled]);
  const dirty = Boolean(state.notes || state.uncertain);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy?.(Boolean(state.busy || state.loading)); return () => onBusy?.(false); }, [state.busy, state.loading, onBusy]);
  const data = state.loading ? null : state.data, latest = data?.latest_delivery;
  const consistent = data && data.task.id === task.id && data.task.revision === task.revision && data.task.estado === task.estado;
  const locked = disabled || state.busy || state.loading || state.uncertain;
  return <section className="editing-reviews" aria-label="Decisiones de revisión de edición">
    <header><h3>Revisión y correcciones</h3><button type="button" disabled={disabled || state.busy || state.loading || state.uncertain} onClick={() => model.current?.refresh()}>Actualizar revisiones</button></header>
    {state.loading && <p role="status">Consultando decisiones…</p>}{state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    {data && <>{!consistent && <p role="status">El detalle cambió. Actualizá las revisiones antes de continuar.</p>}
      {latest ? <div className="editing-reviews-version"><strong>Última versión entregada · revisión {latest.task_revision}</strong><a href={latest.url} target="_blank" rel="noopener noreferrer">{latest.url} ↗</a><small>Entrega {latest.id} · Actor #{latest.actor_id} · {dateLabel(latest.recorded_at)} (Córdoba)</small></div> : <p>Sin entrega registrada para revisar. No se reconstruyen versiones ni aprobaciones anteriores.</p>}
      {data.can_request_corrections && sesion?.usuario?.rol === 'admin' && latest && <form onSubmit={event => { event.preventDefault(); if (!state.uncertain) void model.current?.submit(); }}>
        <label className="editing-reviews-ack"><input type="checkbox" checked={state.acknowledged && Boolean(consistent)} disabled={locked || !consistent || state.conflict} onChange={event => model.current?.acknowledge(event.target.checked)} />Revisé esta versión para pedir correcciones</label>
        <label>Correcciones para esta versión<textarea rows={3} maxLength={4000} value={state.notes} disabled={locked} onChange={event => model.current?.setNotes(event.target.value)} /></label>
        {state.uncertain ? <button type="button" disabled={disabled || state.busy} onClick={() => model.current?.retry()}>Reintentar el mismo pedido</button> : <button type="submit" disabled={locked || !consistent || state.conflict || !state.acknowledged || !state.notes.trim()}>{state.busy ? 'Registrando pedido…' : 'Pedir correcciones'}</button>}
      </form>}
      <details className="editing-reviews-history"><summary>Decisiones registradas · {data.decisions.length} de {data.total}{data.truncated ? ' · últimas 200' : ''}</summary>
        <p>Historial de decisiones registradas desde esta incorporación. No representa por sí solo la aprobación del contenido actual.</p>
        {data.total === 0 ? <p>Sin decisiones registradas. Las aprobaciones históricas no se infieren del estado de la tarea.</p> : <ol>{data.decisions.slice().reverse().map(item => <li key={item.id}><strong>{item.action === 'aprobada' ? 'Aprobación registrada' : 'Pedido de correcciones'}</strong><small>Actor #{item.actor_id} · {dateLabel(item.recorded_at)} (Córdoba) · Revisión de tarea {item.task_revision}</small><small>Entrega {item.delivery_id}</small>{item.notes && <p>{item.notes}</p>}</li>)}</ol>}
      </details>
    </>}
  </section>;
}
