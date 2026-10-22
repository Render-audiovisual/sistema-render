import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./design-system.css";
import { App } from "./App.jsx";
import { installUnsavedNavigation } from "./shared/navigation/unsaved.js";
import { createApplicationSession } from './shared/session/application-session.js';
import { installApplicationSession } from './shared/session/application-session-access.js';
import { createBrowserSessionCoordination } from './shared/session/browser-session-coordination.js';

installUnsavedNavigation(window);

// The operational browser app and API must share an origin. A foreign legacy
// API base fails closed; it must not silently restore XSS-readable bearer auth.
const API_BASE = import.meta.env.VITE_API_BASE || "";
const fetchOriginal = window.fetch.bind(window);
const root = createRoot(document.getElementById("root"));
const coordination = createBrowserSessionCoordination();
try {
  // Document-owned, outside StrictMode. Web Locks serialize cookie writers
  // across tabs; broadcasts only withdraw stale observations, never log in.
  const applicationSession = createApplicationSession({ mode: 'browser', fetchImpl: fetchOriginal,
    location: window.location, apiBase: API_BASE, locks: window.navigator.locks,
    sessionChanges: coordination, notifyChange: coordination.notifyChange });
  installApplicationSession(applicationSession);
  window.fetch = applicationSession.fetch;
  // Retire only the historical credential key, never drafts or preferences.
  try { window.localStorage.removeItem('render_sesion'); } catch { /* Storage is not required for cookie authentication. */ }
  // start() is initial-only; consumers read snapshots, never restore its result.
  void applicationSession.start().catch(() => {});

  root.render(<React.StrictMode><App /></React.StrictMode>);
} catch {
  coordination.dispose();
  root.render(<main className="route-loading" role="alert">
    <strong>No pudimos iniciar una sesión segura.</strong>
    <p>Abrí Render en un navegador actualizado y desde el mismo origen que su API. No se usará la sesión antigua.</p>
    <button type="button" onClick={() => window.location.reload()}>Volver a verificar</button>
  </main>);
}
