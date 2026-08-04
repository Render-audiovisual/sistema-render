import React, { useEffect, useRef } from "react";

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
}) {
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, []);

  const handleBackdropMouseDown = (event) => {
    if (closeOnBackdropClick && event.target === event.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div
      className="modal-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label={overlayAriaLabel}
      onMouseDown={handleBackdropMouseDown}
    >
      <div className={`modal${className ? ` ${className}` : ""}`} style={style}>
        <div className="modal-header">
          {title}
          <button
            ref={closeButtonRef}
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
