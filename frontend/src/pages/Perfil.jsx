import React, { useEffect, useRef, useState } from "react";
import { getSesion, guardarSesion, inicialesUsuario } from "../utils.jsx";
import { getRolLabel } from "../constants.js";
import { createProfileSessionGuard, profileFailureMessage } from '../shared/session/profile-session.js';
import { getApplicationSession } from '../shared/session/application-session-access.js';
import { newPasswordError } from '../../../shared/password-policy.mjs';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';

export function PerfilPage() {
  const sesion = getSesion();
  const usuario = sesion?.usuario;
  const [perfilUsuario, setPerfilUsuario] = useState(usuario);
  const [fotoPerfil, setFotoPerfil] = useState(usuario?.foto_perfil || "");
  const [usuarioNuevo, setUsuarioNuevo] = useState(usuario?.usuario || "");
  const [passwordUsuario, setPasswordUsuario] = useState("");
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mensajeFoto, setMensajeFoto] = useState(null);
  const [errorFoto, setErrorFoto] = useState(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [mensajeUsuario, setMensajeUsuario] = useState(null);
  const [errorUsuario, setErrorUsuario] = useState(null);
  const [enviandoUsuario, setEnviandoUsuario] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const mounted = useRef(false);
  const operationPending = useRef(false);
  const busy = enviandoFoto || enviandoUsuario || enviando;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const capture = () => createProfileSessionGuard({ session: sesion, readSession: getSesion,
    runtime: getApplicationSession(),
    isMounted: () => mounted.current, save: guardarSesion,
    clear: key => localStorage.removeItem(key), navigate: href => window.location.replace(href) });
  const profileNavigationStatus = () => {
    if (!capture().current()) return { dirty: false, busy: false };
    return {
      dirty: Boolean(usuarioNuevo !== (perfilUsuario?.usuario || '') || passwordUsuario || actual || nueva || confirmar),
      busy: Boolean(operationPending.current || busy),
    };
  };
  useNavigationGuard(profileNavigationStatus);

  useEffect(() => {
    setPerfilUsuario(usuario);
    setFotoPerfil(usuario?.foto_perfil || "");
    setUsuarioNuevo(usuario?.usuario || "");
  }, [usuario?.id, usuario?.usuario, usuario?.nombre, usuario?.rol, usuario?.foto_perfil]);

  const actualizarSesionPerfil = async (data, guard) => {
    const usuarioActualizado = await guard.applyPhoto(data);
    // Browser refreshProfile publishes a new observation and intentionally
    // remounts this page. Never paint success into the previous profile view.
    if (getApplicationSession()?.mode === 'browser') return null;
    if (!usuarioActualizado || !guard.current()) return null;
    setPerfilUsuario(usuarioActualizado);
    setFotoPerfil(usuarioActualizado.foto_perfil);
    return usuarioActualizado;
  };

  const reducirFotoPerfil = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const size = 360;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          const x = (size - width) / 2;
          const y = (size - height) / 2;
          ctx.fillStyle = "#f5f5f5";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(image, x, y, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.onerror = () => reject(new Error("No se pudo leer la imagen."));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsDataURL(file);
    });

  const guardarFotoPerfil = (foto, guard) => {
    if (!guard.current()) return Promise.resolve();
    return guard.request(fetch, "/api/usuarios/foto", {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        foto_perfil: foto,
      }),
    })
      .then(async (response) => {
        if (!guard.current()) return null;
        const data = await response.json();
        if (!guard.current()) return null;
        if (!response.ok) {
          throw Object.assign(new Error('No se pudo confirmar la foto.'), { code: data?.code });
        }
        return data;
      })
      .then(async (data) => {
        if (!guard.current() || !await actualizarSesionPerfil(data, guard)) return;
        setMensajeFoto(foto ? "Foto de perfil actualizada." : "Foto de perfil quitada.");
      })
      .finally(() => { if (guard.current()) { operationPending.current = false; setEnviandoFoto(false); } });
  };

  const canChangePhoto = () => {
    if (operationPending.current) return false;
    if (getApplicationSession()?.mode === 'browser' &&
      (usuarioNuevo !== (perfilUsuario?.usuario || '') || passwordUsuario || actual || nueva || confirmar)) {
      setErrorFoto('Guardá o descartá los cambios de usuario y contraseña antes de cambiar la foto.');
      return false;
    }
    return true;
  };

  const handleFotoPerfil = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!canChangePhoto()) return;
    const guard = capture();
    if (!guard.current()) return;
    setMensajeFoto(null);
    setErrorFoto(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorFoto("Elegí una imagen válida.");
      return;
    }
    operationPending.current = true;
    setEnviandoFoto(true);
    try {
      const fotoReducida = await reducirFotoPerfil(file);
      if (!guard.current()) return;
      await guardarFotoPerfil(fotoReducida, guard);
    } catch (err) {
      if (guard.current()) setErrorFoto(profileFailureMessage(err));
    } finally {
      if (guard.current()) { operationPending.current = false; setEnviandoFoto(false); }
    }
  };

  const handleQuitarFotoPerfil = () => {
    if (!canChangePhoto()) return;
    const guard = capture();
    if (!guard.current()) return;
    setMensajeFoto(null);
    setErrorFoto(null);
    operationPending.current = true;
    setEnviandoFoto(true);
    guardarFotoPerfil("", guard).catch((err) => { if (guard.current()) setErrorFoto(profileFailureMessage(err)); });
  };

  const handleCambiarUsuario = (event) => {
    event.preventDefault();
    if (operationPending.current) return;
    const guard = capture();
    if (!guard.current()) return;
    setMensajeUsuario(null);
    setErrorUsuario(null);

    const usuarioLimpio = usuarioNuevo.trim();
    const heldIdentity = { id: perfilUsuario?.id, rol: perfilUsuario?.rol };
    if (!usuarioLimpio) {
      setErrorUsuario("El usuario nuevo no puede estar vacío.");
      return;
    }

    operationPending.current = true;
    setEnviandoUsuario(true);
    guard.request(fetch, "/api/usuarios/perfil", {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_actual: perfilUsuario.usuario,
        password_actual: passwordUsuario,
        usuario_nuevo: usuarioLimpio,
      }),
    })
      .then(async (response) => {
        if (!guard.current()) return null;
        const data = await response.json();
        if (!guard.current()) return null;
        if (!response.ok) {
          throw Object.assign(new Error('No se pudo confirmar el usuario.'), { code: data?.code });
        }
        return data;
      })
      .then((data) => {
        if (!guard.current()) return;
        if (!Number.isSafeInteger(heldIdentity.id) || heldIdentity.id < 1 || heldIdentity.id > 2147483647
          || typeof heldIdentity.rol !== 'string' || !heldIdentity.rol || data?.id !== heldIdentity.id
          || data.usuario !== usuarioLimpio || data.rol !== heldIdentity.rol) throw new Error('No se pudo confirmar el usuario.');
        setMensajeUsuario("Usuario actualizado. Por seguridad, volvé a iniciar sesión.");
        guard.requireReauthentication();
      })
      .catch((err) => { if (guard.current()) setErrorUsuario(profileFailureMessage(err)); })
      .finally(() => { if (guard.current()) { operationPending.current = false; setEnviandoUsuario(false); } });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (operationPending.current) return;
    const guard = capture();
    if (!guard.current()) return;
    setMensaje(null);
    setError(null);

    const passwordError = newPasswordError(nueva);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (nueva !== confirmar) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    operationPending.current = true;
    setEnviando(true);
    guard.request(fetch, "/api/usuarios/password", {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        password_actual: actual,
        password_nueva: nueva,
      }),
    })
      .then(async (response) => {
        if (!guard.current()) return null;
        const data = await response.json();
        if (!guard.current()) return null;
        if (!response.ok) {
          throw Object.assign(new Error('No se pudo confirmar la contraseña.'), { code: data?.code });
        }
        return data;
      })
      .then((data) => {
        if (!guard.current()) return;
        if (data?.ok !== true) throw new Error('No se pudo confirmar la contraseña.');
        setMensaje("Contraseña actualizada. Por seguridad, volvé a iniciar sesión.");
        setActual("");
        setNueva("");
        setConfirmar("");
        guard.requireReauthentication();
      })
      .catch((err) => { if (guard.current()) setError(profileFailureMessage(err)); })
      .finally(() => { if (guard.current()) { operationPending.current = false; setEnviando(false); } });
  };

  return (
    <main aria-label="Render platform perfil">
      <div className="frame">
        <div className="content profile-page">
          <header className="profile-heading">
            <div><div className="section-label">Cuenta</div><h2>Mi perfil</h2><p>Administrá tu identidad y las opciones de acceso.</p></div>
          </header>

          <div className="profile-layout">
            <section className="profile-identity-card" aria-label="Identidad de la cuenta">
              <div className="profile-photo-preview">
                {fotoPerfil ? (
                  <img src={fotoPerfil} alt="" />
                ) : (
                  inicialesUsuario(perfilUsuario?.nombre)
                )}
              </div>
              <div className="profile-identity-copy">
                <h3>{perfilUsuario?.nombre}</h3>
                <p>@{perfilUsuario?.usuario}</p>
                <span>{getRolLabel(perfilUsuario?.rol)}</span>
              </div>
              <div className="profile-photo-actions">
                <label className={`btn primary ${busy ? "disabled" : ""}`}>
                  {enviandoFoto ? "Guardando..." : fotoPerfil ? "Cambiar foto" : "Subir foto"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFotoPerfil}
                    disabled={busy}
                    hidden
                  />
                </label>
                {fotoPerfil && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleQuitarFotoPerfil}
                    disabled={busy}
                  >
                    Quitar foto
                  </button>
                )}
              </div>
              {errorFoto && <div className="profile-feedback is-error">{errorFoto}</div>}
              {mensajeFoto && <div className="profile-feedback is-success">{mensajeFoto}</div>}
              <div className="profile-account-data">
                <div><span>Nombre</span><strong>{perfilUsuario?.nombre}</strong></div>
                <div><span>Usuario de acceso</span><strong>{perfilUsuario?.usuario}</strong></div>
                <div><span>Categoría</span><strong>{getRolLabel(perfilUsuario?.rol)}</strong></div>
              </div>
              <small className="profile-readonly-note">El nombre y el rol los administra el Líder.</small>
            </section>

            <section className="profile-settings" aria-label="Acceso y seguridad">
              <header><span className="section-label">Configuración</span><h3>Acceso y seguridad</h3><p>Abrí únicamente la opción que necesitás cambiar.</p></header>
              <details className="profile-setting-panel">
                <summary><span><strong>Usuario de acceso</strong><small>Cambiá el nombre que usás para iniciar sesión.</small></span><b>Editar</b></summary>
                <form onSubmit={handleCambiarUsuario} className="profile-setting-form">
                  <label className="login-field"><span className="detail-label">Nuevo usuario</span><input disabled={busy} type="text" value={usuarioNuevo} onChange={(e) => setUsuarioNuevo(e.target.value)} autoComplete="username" required /></label>
                  <label className="login-field"><span className="detail-label">Contraseña actual</span><input disabled={busy} type="password" value={passwordUsuario} onChange={(e) => setPasswordUsuario(e.target.value)} autoComplete="current-password" required /></label>
                  {errorUsuario && <div className="profile-feedback is-error">{errorUsuario}</div>}
                  {mensajeUsuario && <div className="profile-feedback is-success">{mensajeUsuario}</div>}
                  <button className="btn primary" type="submit" disabled={busy}>{enviandoUsuario ? "Guardando..." : "Guardar usuario"}</button>
                </form>
              </details>
              <details className="profile-setting-panel">
                <summary><span><strong>Contraseña</strong><small>Después de actualizarla tendrás que iniciar sesión nuevamente.</small></span><b>Cambiar</b></summary>
                <form onSubmit={handleSubmit} className="profile-setting-form">
                  <label className="login-field"><span className="detail-label">Contraseña actual</span><input disabled={busy} type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required /></label>
                  <label className="login-field"><span className="detail-label">Nueva contraseña</span><input disabled={busy} type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" minLength={12} aria-describedby="profile-password-policy" required /><small id="profile-password-policy">Al menos 12 caracteres y hasta 72 bytes UTF-8. Los espacios no se recortan. El servidor valida la contraseña.</small></label>
                  <label className="login-field"><span className="detail-label">Repetir nueva contraseña</span><input disabled={busy} type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" minLength={12} required /></label>
                  {error && <div className="profile-feedback is-error">{error}</div>}
                  {mensaje && <div className="profile-feedback is-success">{mensaje}</div>}
                  <button className="btn primary" type="submit" disabled={busy}>{enviando ? "Guardando..." : "Guardar contraseña"}</button>
                </form>
              </details>
              <div className="profile-security-note"><strong>Protegé tu acceso</strong><span>Cambiar el usuario o la contraseña revoca las sesiones anteriores y requiere iniciar sesión nuevamente. No modifica tu rol ni tus permisos.</span></div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
