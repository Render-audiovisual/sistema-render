import React, { useCallback, useEffect, useRef, useState } from "react";
import { getSesion, guardarSesion } from "../utils.jsx";
import { getApplicationSession } from "../shared/session/application-session-access.js";
import { createLoginAttempts } from "../shared/session/login-attempt.js";
import { readLoginDestination, resolveLoginDestination } from "../shared/navigation/login-destination.js";
import { OWNER_ACCESS_CHOICES, ownerAccessLabel, readOwnerAccessChoice, rememberOwnerAccessChoice } from '../shared/session/owner-access-choice.js';
import './OwnerAccess.css';

// Fallback hardcodeado: el hosting de Hostinger no inyecta las
// "Variables de entorno" del panel durante `npm run build` (solo en
// runtime del backend), así que import.meta.env.VITE_GOOGLE_CLIENT_ID
// llega undefined ahí. No es un secreto (viaja al navegador de todas
// formas), así que hardcodearlo es seguro.
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "468370687841-do43hb7rje2t6agcliof3asq5gmbqssv.apps.googleusercontent.com";

export function LoginPage({ sessionPending = false }) {
  const [ownerChoice, setOwnerChoice] = useState(() => { try { return readOwnerAccessChoice(window.sessionStorage); } catch { return null; } });
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const googleBtnRef = useRef(null);
  const sessionPendingRef = useRef(sessionPending);
  sessionPendingRef.current = sessionPending;
  const attemptsRef = useRef(null);
  const capturedDestination = useRef(readLoginDestination(window.location.search));
  if (!attemptsRef.current) attemptsRef.current = createLoginAttempts({
    getRuntime: getApplicationSession,
    request: (...args) => fetch(...args),
    readSession: getSesion,
    save: guardarSesion,
    navigate: (user) => { window.location.replace(resolveLoginDestination(capturedDestination.current, user)); },
    onState: ({ busy, error: nextError }) => {
      setCargando(busy);
      if (nextError !== undefined) setError(nextError);
    },
  });
  useEffect(() => {
    const attempts = attemptsRef.current;
    attempts.mount();
    return () => attempts.cleanup();
  }, []);

  const iniciarSesion = useCallback((kind, body) => attemptsRef.current.login(kind, body), []);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (sessionPendingRef.current) return;
    void iniciarSesion('password', { usuario, password });
  };

  const handleGoogleCredential = useCallback(
    (response) => {
      if (sessionPendingRef.current) return;
      void iniciarSesion('google', { credential: response?.credential });
    },
    [iniciarSesion],
  );

  useEffect(() => {
    let active = true;
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) return; // sin configurar: no mostramos el botón

    const renderBoton = () => {
      if (!active || !window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => { if (active) handleGoogleCredential(response); },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        locale: "es",
        width: 320,
      });
    };

    let script = document.getElementById("google-identity-script");
    const existing = Boolean(script);
    if (!script) script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderBoton);
    if (!existing) document.head.appendChild(script);
    renderBoton();
    return () => {
      active = false;
      script.removeEventListener('load', renderBoton);
    };
  }, [handleGoogleCredential]);


  return (
    <main className="login-main" aria-label="Render platform login">
      <section className="login-card" aria-label="Inicio de sesión RENDER">
        <div className="login-brand">
          <div className="login-logo">RENDER</div>
          <div className="login-title">Sistema interno</div>
          <p>Ingresá con tu usuario asignado para ver tu tablero de trabajo.</p>
        </div>

        <div className="login-owner-access" role="group" aria-label="Acceso de dueños">
          {OWNER_ACCESS_CHOICES.map(owner => <button type="button" className="btn" key={owner.id}
            aria-pressed={ownerChoice === owner.id} disabled={cargando || sessionPending}
            onClick={() => { setOwnerChoice(owner.id); setUsuario(''); setPassword(''); setError(null);
              try { rememberOwnerAccessChoice(owner.id, window.sessionStorage); } catch { /* Label only. */ } }}>
            {owner.label}
          </button>)}
        </div>
        {ownerAccessLabel(ownerChoice) && <p className="login-owner-hint">Acceso de {ownerAccessLabel(ownerChoice)}. Ingresá con tu cuenta personal.</p>}
        <div ref={googleBtnRef} className="login-google-btn" />

        {GOOGLE_CLIENT_ID && (
          <div className="login-divider"><span>o con tu usuario</span></div>
        )}

        <form onSubmit={handleSubmit} className="login-form login-form-card">
          <label className="login-field">
            <span className="detail-label">Usuario o correo</span>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              placeholder="nombre@correo.com"
              required
              spellCheck={false}
            />
          </label>
          <label className="login-field">
            <span className="detail-label">Contraseña</span>
            <div className="password-input-wrap">
              <input
                type={mostrarPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none"
                autoComplete="current-password"
                placeholder="Contraseña"
                required
                spellCheck={false}
              />
              <button
                aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="password-toggle"
                onClick={() => setMostrarPassword((valor) => !valor)}
                title={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                type="button"
              >
                {mostrarPassword ? "◐" : "👁"}
              </button>
            </div>
          </label>

          {error && <div className="caption login-error">{error}</div>}

          <button className="btn primary login-submit" type="submit" disabled={cargando || sessionPending}>
            {cargando ? "Ingresando..." : "Ingresar al sistema"}
          </button>
        </form>
      </section>
    </main>
  );
}
