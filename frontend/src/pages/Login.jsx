import React, { useCallback, useEffect, useRef, useState } from "react";
import { getRutaUsuario, guardarSesion } from "../utils.jsx";

// Fallback hardcodeado: el hosting de Hostinger no inyecta las
// "Variables de entorno" del panel durante `npm run build` (solo en
// runtime del backend), así que import.meta.env.VITE_GOOGLE_CLIENT_ID
// llega undefined ahí. No es un secreto (viaja al navegador de todas
// formas), así que hardcodearlo es seguro.
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "468370687841-do43hb7rje2t6agcliof3asq5gmbqssv.apps.googleusercontent.com";

export function LoginPage() {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const googleBtnRef = useRef(null);

  const iniciarConToken = useCallback((fetchPromise) => {
    setError(null);
    setCargando(true);
    fetchPromise
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo iniciar sesión.");
        }
        return data;
      })
      .then((data) => {
        guardarSesion(data.token, data.usuario);
        const destino = getRutaUsuario(data.usuario.usuario, data.usuario.rol);
        window.location.href = destino;
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setCargando(false);
      });
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    iniciarConToken(
      fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      }),
    );
  };

  const handleGoogleCredential = useCallback(
    (response) => {
      iniciarConToken(
        fetch("/api/login/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        }),
      );
    },
    [iniciarConToken],
  );

  useEffect(() => {
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) return; // sin configurar: no mostramos el botón

    const renderBoton = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
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

    if (document.getElementById("google-identity-script")) {
      renderBoton();
      return;
    }
    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderBoton;
    document.head.appendChild(script);
  }, [handleGoogleCredential]);


  return (
    <main className="login-main" aria-label="Render platform login">
      <section className="login-card" aria-label="Inicio de sesión RENDER">
        <div className="login-brand">
          <div className="login-logo">RENDER</div>
          <div className="login-title">Sistema interno</div>
          <p>Ingresá con tu usuario asignado para ver tu tablero de trabajo.</p>
        </div>

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

          <button className="btn primary login-submit" type="submit" disabled={cargando}>
            {cargando ? "Ingresando..." : "Ingresar al sistema"}
          </button>
        </form>
      </section>
    </main>
  );
}
