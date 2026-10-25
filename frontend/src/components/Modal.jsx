import React, { useEffect, useRef } from "react";
import './Modal.css';

/*
 * Chrome compartido de los modales: overlay + contenedor + fila de header
 * con botón de cerrar. El contenido (título y cuerpo) lo define cada
 * pantalla que lo usa — este componente no impone estructura interna.
 */
export function Modal({
  onClose,
  title,
  children,
  className = "",
  style,
  overlayAriaLabel,
  closeOnBackdropClick = false,
  closeLabel = "Cerrar",
  native = false,
  closeDisabled = false,
  initialFocusRef,
  returnFocusRef,
  overlayClassName = "",
  headerClassName = "",
  chrome = true,
}) {
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef({ onClose, closeDisabled, returnFocusRef });
  onCloseRef.current = { onClose, closeDisabled, returnFocusRef };
  const requestClose = () => {
    if (!onCloseRef.current.closeDisabled) onCloseRef.current.onClose?.();
  };

  useEffect(() => {
    // A parent may disable its invoker as soon as a child opens. In that case
    // the browser has already blurred it before this effect runs.
    previousFocusRef.current = onCloseRef.current.returnFocusRef ? onCloseRef.current.returnFocusRef.current : document.activeElement;
    const dialog = native ? dialogRef.current : null;
    if (dialog) {
      try { if (!dialog.open) dialog.showModal(); }
      catch { requestClose(); return undefined; }
    }
    (initialFocusRef?.current || closeButtonRef.current)?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") requestClose();
    };
    if (!native) window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (!native) window.removeEventListener("keydown", handleKeyDown);
      if (dialog?.open) dialog.close();
      const previous = onCloseRef.current.returnFocusRef ? onCloseRef.current.returnFocusRef.current : previousFocusRef.current;
      if (previous?.isConnected !== false && !previous?.disabled && !previous?.matches?.(':disabled') && !previous?.closest?.('[inert]')) previous?.focus?.();
    };
  }, [native]);

  const handleBackdropMouseDown = (event) => {
    if (closeOnBackdropClick && event.target === event.currentTarget) {
      requestClose();
    }
  };

  const handleNativeKeyDown = event => {
    if (event.key === 'Escape') { event.stopPropagation(); return; }
    if (event.key !== 'Tab') return;
    // Portals retain React ancestry: never let an outer dialog redirect an
    // interior Tab from a child whose DOM lives elsewhere in the top layer.
    event.stopPropagation();
    if (event.defaultPrevented) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  };

  const Overlay = native ? 'dialog' : 'div';
  return (
    <Overlay
      ref={dialogRef}
      className={`modal-overlay open${native ? ' render-native-dialog' : ''}${overlayClassName ? ` ${overlayClassName}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={overlayAriaLabel}
      aria-busy={closeDisabled || undefined}
      tabIndex={native ? -1 : undefined}
      onMouseDown={handleBackdropMouseDown}
      onCancel={native ? event => { event.preventDefault(); event.stopPropagation(); requestClose(); } : undefined}
      onKeyDown={native ? handleNativeKeyDown : undefined}
    >
      {chrome ? <div className={`modal${className ? ` ${className}` : ""}`} style={style}>
        <div className={`modal-header${headerClassName ? ` ${headerClassName}` : ''}`}>
          {title}
          <button
            ref={closeButtonRef}
            className="modal-close"
            type="button"
            onClick={requestClose}
            aria-label={closeLabel}
            disabled={closeDisabled}
          >
            ×
          </button>
        </div>
        {children}
      </div> : children}
    </Overlay>
  );
}
