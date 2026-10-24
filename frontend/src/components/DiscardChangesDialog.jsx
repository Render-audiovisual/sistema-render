import React, { useEffect, useId, useRef } from 'react';
import './DiscardChangesDialog.css';

export function DiscardChangesDialog({ open, busy, onKeepEditing, onDiscard,
  description = 'Los cambios de este borrador no se guardaron. Si los descartás, perderás lo que editaste sin guardar.' }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const keepRef = useRef(null);
  const sessionRef = useRef(null);
  const handledRef = useRef(false);
  const latest = useRef({ open, busy, onKeepEditing, onDiscard });
  latest.current = { open, busy, onKeepEditing, onDiscard };

  function finish(discard = false) {
    const session = sessionRef.current;
    if (!session?.active || handledRef.current || !latest.current.open
      || (discard && latest.current.busy)) return;
    handledRef.current = true;
    if (discard) {
      // Parent closes TaskDetail and restores board focus. Never focus its invoker.
      latest.current.onDiscard?.();
      return;
    }
    if (session.dialog.open) session.dialog.close();
    const usable = element => element?.isConnected && !element.disabled
      && !element.matches?.(':disabled') && !element.closest?.('[inert]');
    if (usable(session.invoker)) session.invoker.focus({ preventScroll: true });
    else {
      const panel = session.dialog.parentElement?.querySelector('.ros-task-workspace[role="dialog"]');
      if (usable(panel)) panel.focus({ preventScroll: true });
    }
    latest.current.onKeepEditing?.();
  }

  useEffect(() => {
    if (!open) { handledRef.current = false; return undefined; }
    if (handledRef.current) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const session = { dialog, invoker: dialog.ownerDocument.activeElement, active: true };
    sessionRef.current = session;
    const closed = event => {
      event.stopPropagation();
      // Ignore queued close events from StrictMode cleanup after a modal reopened.
      if (session.active && !dialog.open) finish(false);
    };
    dialog.addEventListener('close', closed);
    try {
      if (!dialog.isConnected) throw new Error('Dialog disconnected');
      if (!dialog.open) dialog.showModal();
      keepRef.current?.focus({ preventScroll: true });
    } catch {
      // Missing/failed native modal support is never consent to lose a draft.
      finish(false);
    }
    return () => {
      session.active = false;
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
      if (sessionRef.current === session) sessionRef.current = null;
      // No callbacks or explicit focus restoration during cleanup/unmount.
    };
  }, [open]);

  return <dialog ref={dialogRef} className="render-discard-dialog"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onClick={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); finish(false); }}
    onKeyDownCapture={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    }}
    onKeyUpCapture={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <h2 id={titleId}>¿Descartar los cambios?</h2>
    <p id={descriptionId}>{description}</p>
    <div className="render-discard-dialog-actions">
      <button ref={keepRef} type="button" autoFocus onClick={() => finish(false)}>Seguir editando</button>
      <button type="button" className="render-discard-dialog-discard" disabled={busy}
        onClick={() => { if (!latest.current.busy) finish(true); }}>Descartar cambios</button>
    </div>
  </dialog>;
}

export default DiscardChangesDialog;
