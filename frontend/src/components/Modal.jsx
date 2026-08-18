import React from "react";

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
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
