import React from "react";

export function PageState({ type = "loading", title, description, onRetry, compact = false }) {
  return (
    <div className={`page-state is-${type}${compact ? " is-compact" : ""}`} role={type === "error" ? "alert" : "status"}>
      <span aria-hidden="true">{type === "error" ? "!" : type === "empty" ? "—" : "◌"}</span>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {onRetry && <button className="btn" type="button" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}
