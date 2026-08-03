import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.jsx";

// Toda la app llama a la API con rutas relativas ("/api/..."). Eso funciona
// solo cuando el mismo servidor sirve la API y el frontend (el deploy
// normal en Render). Si este build se aloja aparte de la API (por ejemplo
// una copia estática en Hostinger), VITE_API_BASE define a qué origen
// redirigir esas llamadas. Sin la variable, el comportamiento no cambia.
const API_BASE = import.meta.env.VITE_API_BASE || "";
if (API_BASE) {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? fetchOriginal(API_BASE + input, init)
      : fetchOriginal(input, init);
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
