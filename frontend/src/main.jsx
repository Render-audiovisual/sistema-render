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
  const relativeApiUrl = typeof input === "string" && input.startsWith("/api");
  if (!relativeApiUrl) return fetchOriginal(input, init);

  const headers = new Headers(init.headers || {});
  try {
    const session = JSON.parse(localStorage.getItem("render_sesion") || "null");
    if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  } catch {
    localStorage.removeItem("render_sesion");
  }

  const response = await fetchOriginal(`${API_BASE}${input}`, { ...init, headers });
  const isLoginRequest = input === "/api/login" || input === "/api/login/google";
  if (response.status === 401 && !isLoginRequest) {
    localStorage.removeItem("render_sesion");
    if (window.location.pathname !== "/login") window.location.replace("/login");
  }
  return response;
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
