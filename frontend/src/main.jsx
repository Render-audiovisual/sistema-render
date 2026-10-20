import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./design-system.css";
import { App } from "./App.jsx";
import { installUnsavedNavigation } from "./shared/navigation/unsaved.js";
import { createApplicationSession } from './shared/session/application-session.js';
import { installApplicationSession } from './shared/session/application-session-access.js';

installUnsavedNavigation(window);

// Toda la app llama a la API con rutas relativas ("/api/..."). Eso funciona
// solo cuando el mismo servidor sirve la API y el frontend (el deploy
// normal en Render). Si este build se aloja aparte de la API (por ejemplo
// una copia estática en Hostinger), VITE_API_BASE define a qué origen
// redirigir esas llamadas. Sin la variable, el comportamiento no cambia.
const API_BASE = import.meta.env.VITE_API_BASE || "";
const fetchOriginal = window.fetch.bind(window);
// Document-owned lifetime, outside StrictMode mount/cleanup. Cookie mode stays
// disabled until the existing Login/Profile/editors consume the same runtime.
const applicationSession = createApplicationSession({ mode: 'bearer', fetchImpl: fetchOriginal,
  storage: localStorage, location: window.location, apiBase: API_BASE, eventTarget: window });
installApplicationSession(applicationSession);
window.fetch = applicationSession.fetch;
// start() is initial-only; consumers read snapshots, never restore its result.
void applicationSession.start().catch(() => {});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
