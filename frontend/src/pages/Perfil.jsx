import React, { useEffect, useState } from "react";
import { getSesion, guardarSesion, inicialesUsuario } from "../utils.jsx";
import { ROL_LABELS } from "../constants.js";

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

  useEffect(() => {
    setPerfilUsuario(usuario);
    setFotoPerfil(usuario?.foto_perfil || "");
    setUsuarioNuevo(usuario?.usuario || "");
  }, [usuario?.usuario, usuario?.foto_perfil]);

  const actualizarSesionPerfil = (data) => {
    const usuarioActualizado = {
      usuario: data.usuario,
      nombre: data.nombre,
      rol: data.rol,
      foto_perfil: data.foto_perfil || "",
    };
    guardarSesion(sesion.token, usuarioActualizado);
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

  const guardarFotoPerfil = (foto) => {
    setEnviandoFoto(true);
    return fetch("/api/usuarios/foto", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        foto_perfil: foto,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar la foto.");
        }
        return data;
      })
      .then((data) => {
        actualizarSesionPerfil(data);
        setMensajeFoto(foto ? "Foto de perfil actualizada." : "Foto de perfil quitada.");
      })
      .finally(() => setEnviandoFoto(false));
  };

  const handleFotoPerfil = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMensajeFoto(null);
    setErrorFoto(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorFoto("Elegí una imagen válida.");
      return;
    }
    try {
      const fotoReducida = await reducirFotoPerfil(file);
      await guardarFotoPerfil(fotoReducida);
    } catch (err) {
      setErrorFoto(err.message);
    }
  };

  const handleQuitarFotoPerfil = () => {
    setMensajeFoto(null);
    setErrorFoto(null);
    guardarFotoPerfil("").catch((err) => setErrorFoto(err.message));
  };

  const handleCambiarUsuario = (event) => {
    event.preventDefault();
    setMensajeUsuario(null);
    setErrorUsuario(null);

    const usuarioLimpio = usuarioNuevo.trim();
    if (!usuarioLimpio) {
      setErrorUsuario("El usuario nuevo no puede estar vacío.");
      return;
    }

    setEnviandoUsuario(true);
    fetch("/api/usuarios/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario_actual: perfilUsuario.usuario,
        password_actual: passwordUsuario,
        usuario_nuevo: usuarioLimpio,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo cambiar el usuario.");
        }
        return data;
      })
      .then((data) => {
        actualizarSesionPerfil(data);
        setUsuarioNuevo(data.usuario);
        setPasswordUsuario("");
        setMensajeUsuario("Usuario actualizado correctamente.");
      })
      .catch((err) => setErrorUsuario(err.message))
      .finally(() => setEnviandoUsuario(false));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setMensaje(null);
    setError(null);

    if (nueva.length < 4) {
      setError("La nueva contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (nueva !== confirmar) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    setEnviando(true);
    fetch("/api/usuarios/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        password_actual: actual,
        password_nueva: nueva,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo cambiar la contraseña.");
        }
        return data;
      })
      .then(() => {
        setMensaje("Contraseña actualizada correctamente.");
        setActual("");
        setNueva("");
        setConfirmar("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
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
                <span>{ROL_LABELS[perfilUsuario?.rol] || perfilUsuario?.rol}</span>
              </div>
              <div className="profile-photo-actions">
                <label className={`btn primary ${enviandoFoto ? "disabled" : ""}`}>
                  {enviandoFoto ? "Guardando..." : fotoPerfil ? "Cambiar foto" : "Subir foto"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFotoPerfil}
                    disabled={enviandoFoto}
                    hidden
                  />
                </label>
                {fotoPerfil && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleQuitarFotoPerfil}
                    disabled={enviandoFoto}
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
                <div><span>Rol</span><strong>{ROL_LABELS[perfilUsuario?.rol] || perfilUsuario?.rol}</strong></div>
              </div>
              <small className="profile-readonly-note">El nombre y el rol los administra el Líder.</small>
            </section>

            <section className="profile-settings" aria-label="Acceso y seguridad">
              <header><span className="section-label">Configuración</span><h3>Acceso y seguridad</h3><p>Abrí únicamente la opción que necesitás cambiar.</p></header>
              <details className="profile-setting-panel">
                <summary><span><strong>Usuario de acceso</strong><small>Cambiá el nombre que usás para iniciar sesión.</small></span><b>Editar</b></summary>
                <form onSubmit={handleCambiarUsuario} className="profile-setting-form">
                  <label className="login-field"><span className="detail-label">Nuevo usuario</span><input type="text" value={usuarioNuevo} onChange={(e) => setUsuarioNuevo(e.target.value)} autoComplete="username" required /></label>
                  <label className="login-field"><span className="detail-label">Contraseña actual</span><input type="password" value={passwordUsuario} onChange={(e) => setPasswordUsuario(e.target.value)} autoComplete="current-password" required /></label>
                  {errorUsuario && <div className="profile-feedback is-error">{errorUsuario}</div>}
                  {mensajeUsuario && <div className="profile-feedback is-success">{mensajeUsuario}</div>}
                  <button className="btn primary" type="submit" disabled={enviandoUsuario}>{enviandoUsuario ? "Guardando..." : "Guardar usuario"}</button>
                </form>
              </details>
              <details className="profile-setting-panel">
                <summary><span><strong>Contraseña</strong><small>Actualizala sin cerrar tu sesión actual.</small></span><b>Cambiar</b></summary>
                <form onSubmit={handleSubmit} className="profile-setting-form">
                  <label className="login-field"><span className="detail-label">Contraseña actual</span><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required /></label>
                  <label className="login-field"><span className="detail-label">Nueva contraseña</span><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" required /></label>
                  <label className="login-field"><span className="detail-label">Repetir nueva contraseña</span><input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required /></label>
                  {error && <div className="profile-feedback is-error">{error}</div>}
                  {mensaje && <div className="profile-feedback is-success">{mensaje}</div>}
                  <button className="btn primary" type="submit" disabled={enviando}>{enviando ? "Guardando..." : "Guardar contraseña"}</button>
                </form>
              </details>
              <div className="profile-security-note"><strong>Tu cuenta sigue activa</strong><span>Estos cambios no alteran tu rol ni los permisos del sistema.</span></div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
