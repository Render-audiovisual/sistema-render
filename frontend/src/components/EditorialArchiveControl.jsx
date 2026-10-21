import React, { useLayoutEffect, useRef, useState } from 'react';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { archiveObservation, createEditorialArchiveOperation } from './EditorialArchiveControl.model.js';

export function EditorialArchiveControl({ dominio, piece, action = 'archivar', isAdmin, capture, canStart = () => true, onSaved, onLockChange }) {
  const active = useRef(false), holder = useRef(null), [, render] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  useLayoutEffect(() => {
    // StrictMode replays setup/cleanup without recreating refs. A cancelled
    // operation is terminal, so each setup owns a fresh live instance.
    const own = { capture, model: createEditorialArchiveOperation({ capture, isAdmin: () => isAdmin === true }) };
    holder.current = own; active.current = true; render(value => value + 1);
    return () => {
      own.model.cancel();
      if (holder.current === own) { active.current = false; holder.current = null; onLockChange?.(false); }
    };
  }, [capture, isAdmin, dominio, piece.id, action]);
  const state = holder.current?.model.snapshot || { locked: false, busy: false, phase: 'idle' };
  useNavigationGuard(() => ({ dirty: Boolean(holder.current?.model.snapshot.locked), busy: Boolean(holder.current?.model.snapshot.busy) }));
  if (!isAdmin) return null;
  let unavailable = '';
  try { archiveObservation(piece, dominio, action); } catch (reason) { unavailable = reason.message; }
  async function save(verify = false) {
    const model = holder.current?.model;
    if (!isAdmin || !active.current || !model || holder.current.capture !== capture || model.snapshot.busy || !canStart()) return;
    if (!verify && !window.confirm(action === 'archivar'
      ? '¿Archivar esta pieza? Se conservan su contenido, las tareas vinculadas y el historial. No se elimina ningún registro.'
      : '¿Restaurar esta pieza? Volverá a las vistas activas sin cambiar tareas ni publicaciones registradas.')) return;
    setError(''); setMessage('');
    try {
      const pending = verify ? model.verify() : model.submit(piece, dominio, action);
      onLockChange?.(model.snapshot.locked); render(value => value + 1);
      const result = await pending;
      if (!active.current || holder.current?.model !== model) return;
      result.scope.assertCurrent();
      // Replays describe CURRENT state, which may differ from their old action.
      await onSaved?.(result.dto, result.scope);
      result.scope.assertCurrent();
      if (!active.current || holder.current?.model !== model) return;
      model.complete(); setMessage(result.dto.piece.archived ? 'La pieza está archivada.' : 'La pieza está activa.');
    } catch (reason) {
      if (!active.current || holder.current?.model !== model) return;
      try { capture().assertCurrent(); } catch { return; }
      setError(reason.status === 409 ? 'La pieza cambió o no se puede archivar desde su estado actual. Recargá y revisá la lista; no repetimos el cambio.'
        : model.snapshot.phase === 'uncertain' ? 'No se pudo confirmar el resultado. Verificá el mismo intento antes de otra acción.'
          : reason.message || 'No se pudo confirmar el cambio.');
    } finally {
      if (active.current && holder.current?.model === model) { onLockChange?.(model.snapshot.locked); render(value => value + 1); }
    }
  }
  return <span className="ep-control" onClick={event => event.stopPropagation()}>
    {!state.locked && <button type="button" className="btn" disabled={Boolean(unavailable)} title={unavailable || undefined} onClick={() => void save()}>{action === 'archivar' ? 'Archivar' : 'Restaurar'}</button>}
    {state.locked && <button type="button" className="btn" disabled={state.busy || state.phase === 'blocked'} onClick={() => void save(true)}>{state.busy ? 'Guardando…' : 'Verificar cambio'}</button>}
    {unavailable && <small>{unavailable}</small>}{error && <small role="alert">{error}</small>}{message && <small role="status">{message}</small>}
  </span>;
}
