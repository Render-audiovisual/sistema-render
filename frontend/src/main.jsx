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
const fetchOriginal = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const inputUrl =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
  const esApiRelativa = inputUrl.startsWith("/api");
  const destino = esApiRelativa && API_BASE ? API_BASE + inputUrl : input;

  if (!esApiRelativa) {
    return fetchOriginal(destino, init);
  }

  const headers = new Headers(
    init.headers || (input instanceof Request ? input.headers : undefined),
  );
  const esLogin = inputUrl === "/api/login";

  if (!esLogin) {
    try {
      const sesion = JSON.parse(localStorage.getItem("render_sesion") || "null");
      if (sesion?.token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${sesion.token}`);
      }
    } catch {
      localStorage.removeItem("render_sesion");
    }
  }

  const response = await fetchOriginal(destino, { ...init, headers });

  if (!esLogin && response.status === 401) {
    localStorage.removeItem("render_sesion");
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  return response;
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
