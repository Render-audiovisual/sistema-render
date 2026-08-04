import React, { useEffect, useState } from "react";
import { normalizarPrimerNombre } from "../utils.jsx";
import { Modal } from "../components/Modal.jsx";
import { ROL_LABELS } from "../constants.js";

export function EmpleadosPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [error, setError] = useState(null);
  const [modalAltaAbierto, setModalAltaAbierto] = useState(false);
  const [usuarioAdministrado, setUsuarioAdministrado] = useState(null);
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rol, setRol] = useState("diseno");
  const [password, setPassword] = useState("");
  const [emailNotificaciones, setEmailNotificaciones] = useState("");
  const [correoEdicion, setCorreoEdicion] = useState("");
  const [editandoCorreo, setEditandoCorreo] = useState(false);
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [googleEmailEdicion, setGoogleEmailEdicion] = useState("");
  const [editandoGoogleEmail, setEditandoGoogleEmail] = useState(false);
  const [guardandoGoogleEmail, setGuardandoGoogleEmail] = useState(false);
  const [enviandoInvitacion, setEnviandoInvitacion] = useState(false);
  const [editandoDatos, setEditandoDatos] = useState(false);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [nombreEdicion, setNombreEdicion] = useState("");
  const [usuarioEdicion, setUsuarioEdicion] = useState("");
  const [rolEdicion, setRolEdicion] = useState("");
  const [formError, setFormError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [filtroAcceso, setFiltroAcceso] = useState("todos");

  const handleNombreChange = (event) => {
    const nuevoNombre = event.target.value;
    const usuarioActualSugerido = normalizarPrimerNombre(nombre);
    const passwordActualSugerida = usuarioActualSugerido ? `${usuarioActualSugerido}1` : "";
    const nuevoUsuarioSugerido = normalizarPrimerNombre(nuevoNombre);

    setNombre(nuevoNombre);
    if (!usuario || usuario === usuarioActualSugerido) {
      setUsuario(nuevoUsuarioSugerido);
    }
    if (!password || password === passwordActualSugerida) {
      setPassword(nuevoUsuarioSugerido ? `${nuevoUsuarioSugerido}1` : "");
    }
  };

  const cargarUsuarios = () => {
    setCargandoUsuarios(true);
    fetch("/api/usuarios")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los empleados.");
        return data;
      })
      .then((data) => {
        setError(null);
        setUsuarios(data);
        setUsuarioAdministrado((actual) => {
          if (!actual) return null;
          return data.find((item) => item.id === actual.id) || null;
        });
      })
      .catch(() => setError("No se pudieron cargar los empleados."))
      .finally(() => setCargandoUsuarios(false));
  };

  useEffect(cargarUsuarios, []);

  const abrirAlta = () => {
    setNombre("");
    setUsuario("");
    setRol("diseno");
    setPassword("");
    setEmailNotificaciones("");
    setFormError(null);
    setMensaje(null);
    setModalAltaAbierto(true);
  };

  const cerrarAlta = () => {
    if (enviando) return;
    setModalAltaAbierto(false);
    setFormError(null);
  };

  const abrirAdministracion = (u) => {
    setUsuarioAdministrado(u);
    setCorreoEdicion(u.email_notificaciones || "");
    setEditandoCorreo(false);
    setFormError(null);
    setMensaje(null);
  };

  const cerrarAdministracion = () => {
    if (guardandoCorreo) return;
    setUsuarioAdministrado(null);
    setEditandoCorreo(false);
    setFormError(null);
  };

  const handleCrear = (event) => {
    event.preventDefault();
    setFormError(null);
    setMensaje(null);
    setEnviando(true);

    fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre,
        usuario,
        rol,
        password,
        email_notificaciones: emailNotificaciones,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo crear el empleado.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(`Empleado creado: ${data.nombre} (${data.usuario}).`);
        setNombre("");
        setUsuario("");
        setRol("diseno");
        setPassword("");
        setEmailNotificaciones("");
        setModalAltaAbierto(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setEnviando(false));
  };

  const handleEliminar = (u) => {
    if (
      !window.confirm(
        `¿Dar de baja a ${u.nombre} (${u.usuario})? Perderá el acceso a la plataforma.`,
      )
    ) {
      return;
    }
    fetch(`/api/usuarios/${u.id}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo dar de baja.");
        setUsuarioAdministrado(null);
        setMensaje(`${u.nombre} fue dado de baja.`);
        cargarUsuarios();
      })
      .catch(() => setError("No se pudo dar de baja al empleado."));
  };

  const iniciarEdicionCorreo = () => {
    setCorreoEdicion(usuarioAdministrado?.email_notificaciones || "");
    setEditandoCorreo(true);
    setFormError(null);
    setMensaje(null);
  };

  const guardarCorreo = (u) => {
    setGuardandoCorreo(true);
    setFormError(null);
    setMensaje(null);

    fetch(`/api/usuarios/${u.id}/email-notificaciones`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_notificaciones: correoEdicion }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar el correo.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(
          data.email_notificaciones
            ? `Correo guardado para ${data.nombre}.`
            : `Correo eliminado para ${data.nombre}.`,
        );
        setUsuarioAdministrado(data);
        setEditandoCorreo(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setGuardandoCorreo(false));
  };

  const iniciarEdicionGoogleEmail = () => {
    setGoogleEmailEdicion(usuarioAdministrado?.google_email || usuarioAdministrado?.email_notificaciones || "");
    setEditandoGoogleEmail(true);
    setFormError(null);
    setMensaje(null);
  };

  const enviarInvitacion = (u) => {
    setEnviandoInvitacion(true);
    setFormError(null);
    setMensaje(null);
    fetch(`/api/usuarios/${u.id}/invitacion`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo enviar la invitación.");
        return data;
      })
      .then((data) => setMensaje(`Instrucciones enviadas a ${data.destinatario}.`))
      .catch((error) => setFormError(error.message))
      .finally(() => setEnviandoInvitacion(false));
  };

  const guardarGoogleEmail = (u) => {
    setGuardandoGoogleEmail(true);
    setFormError(null);
    setMensaje(null);

    fetch(`/api/usuarios/${u.id}/google-email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ google_email: googleEmailEdicion }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar el email de Google.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(
          data.google_email
            ? `Email de Google guardado para ${data.nombre}.`
            : `Email de Google eliminado para ${data.nombre}.`,
        );
        setUsuarioAdministrado(data);
        setEditandoGoogleEmail(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setGuardandoGoogleEmail(false));
  };

  const iniciarEdicionDatos = () => {
    setNombreEdicion(usuarioAdministrado?.nombre || "");
    setUsuarioEdicion(usuarioAdministrado?.usuario || "");
    setRolEdicion(usuarioAdministrado?.rol || "diseno");
    setEditandoDatos(true);
    setFormError(null);
    setMensaje(null);
  };

  const guardarDatos = (u) => {
    if (!nombreEdicion.trim()) {
      setFormError("El nombre no puede estar vacío.");
      return;
    }
    if (!usuarioEdicion.trim()) {
      setFormError("El usuario no puede estar vacío.");
      return;
    }

    setGuardandoDatos(true);
    setFormError(null);
    setMensaje(null);

    fetch(`/api/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: nombreEdicion,
        usuario: usuarioEdicion,
        rol: rolEdicion
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudieron guardar los datos.");
        }
        return data;
      })
      .then((data) => {
        setMensaje("Datos actualizados correctamente.");
        setUsuarioAdministrado(data);
        setEditandoDatos(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setGuardandoDatos(false));
  };

  const iniciales = (texto = "") =>
    texto
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase();

  const usuariosConCorreo = usuarios.filter(
    (u) => Boolean(u.email_notificaciones),
  ).length;
  const usuariosSinCorreo = usuarios.length - usuariosConCorreo;
  const usuariosConGoogle = usuarios.filter((u) => Boolean(u.google_email)).length;
  const usuariosVisibles = usuarios.filter((u) => {
    const texto = `${u.nombre} ${u.usuario} ${u.email_notificaciones || ""} ${u.google_email || ""} ${ROL_LABELS[u.rol] || u.rol}`.toLowerCase();
    const coincideBusqueda = texto.includes(busqueda.trim().toLowerCase());
    const requiereAtencion = !u.email_notificaciones || !u.google_email;
    return coincideBusqueda && (filtroAcceso === "atencion" ? requiereAtencion : true);
  });
  const usuariosConAtencion = usuarios.filter((u) => !u.email_notificaciones || !u.google_email).length;

  return (
    <main aria-label="Render platform empleados">
      <div className="frame">
        <div className="content usuarios-page">
          <div className="usuarios-header">
            <div>
              <div className="section-label">Equipo</div>
              <h2>Usuarios y accesos</h2>
              <p>Revisá quién puede ingresar, su rol y cómo recibe el acceso.</p>
            </div>
            <button className="btn primary usuarios-add" type="button" onClick={abrirAlta}>
              + Agregar usuario
            </button>
          </div>

          <div className="usuarios-stats" aria-label="Resumen de usuarios">
            <div className="usuarios-stat">
              <span>Personas con acceso</span>
              <strong>{usuarios.length}</strong>
              <small>Cuentas activas</small>
            </div>
            <div className="usuarios-stat is-ready">
              <span>Correo configurado</span>
              <strong>{usuariosConCorreo}</strong>
              <small>{usuariosSinCorreo ? `${usuariosSinCorreo} pendiente` : "Equipo completo"}</small>
            </div>
            <div className={`usuarios-stat ${usuariosConGoogle === usuarios.length ? "is-ready" : "is-pending"}`}>
              <span>Acceso con Google</span>
              <strong>{usuariosConGoogle}</strong>
              <small>{usuarios.length - usuariosConGoogle ? `${usuarios.length - usuariosConGoogle} sin vincular` : "Todos vinculados"}</small>
            </div>
          </div>

          {error && <div className="usuarios-alert is-error"><span>{error}</span><button type="button" onClick={cargarUsuarios}>Reintentar</button></div>}
          {mensaje && <div className="usuarios-alert is-success">{mensaje}</div>}

          <section className="usuarios-listado" aria-label="Listado de usuarios">
            <div className="usuarios-listado-header">
              <div>
                <strong>Personas</strong>
                <span>{usuariosVisibles.length} de {usuarios.length} cuentas</span>
              </div>
              <div className="usuarios-list-controls">
                <label className="usuarios-search">
                  <span aria-hidden="true">⌕</span>
                  <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar persona o correo" aria-label="Buscar persona o correo" />
                </label>
                <div className="usuarios-access-filter" aria-label="Filtrar cuentas">
                  <button type="button" className={filtroAcceso === "todos" ? "active" : ""} onClick={() => setFiltroAcceso("todos")}>Todos</button>
                  <button type="button" className={filtroAcceso === "atencion" ? "active" : ""} onClick={() => setFiltroAcceso("atencion")}>Atención {usuariosConAtencion > 0 && <b>{usuariosConAtencion}</b>}</button>
                </div>
              </div>
            </div>

            <div className="usuarios-columns" aria-hidden="true">
              <span>Persona</span>
              <span>Rol</span>
              <span>Correo</span>
              <span>Estado de acceso</span>
              <span />
            </div>

            <div className="usuarios-list">
              {usuariosVisibles.map((u) => (
                <article className="usuarios-row" key={u.id}>
                  <div className="usuarios-persona">
                    <div className="usuarios-avatar">
                      {u.foto_perfil ? (
                        <img src={u.foto_perfil} alt="" />
                      ) : (
                        iniciales(u.nombre)
                      )}
                    </div>
                    <div>
                      <strong>{u.nombre}</strong>
                      <span>@{u.usuario}</span>
                    </div>
                  </div>

                  <div className={`usuarios-role role-${u.rol}`}>
                    {ROL_LABELS[u.rol] || u.rol}
                  </div>

                  <div className="usuarios-access">
                    <span className="usuarios-mobile-label">Correo</span>
                    <strong>{u.email_notificaciones || "Sin correo configurado"}</strong>
                  </div>

                  <div className="usuarios-access-status">
                    <span className={u.email_notificaciones ? "is-ready" : "is-pending"}>
                      <i className={`usuarios-dot ${u.email_notificaciones ? "is-ready" : "is-pending"}`} />
                      {u.email_notificaciones ? "Correo listo" : "Falta correo"}
                    </span>
                    <span className={u.google_email ? "is-ready" : "is-pending"}>
                      <i className={`usuarios-dot ${u.google_email ? "is-ready" : "is-pending"}`} />
                      {u.google_email ? "Google vinculado" : "Google sin vincular"}
                    </span>
                  </div>

                  <button
                    className="btn usuarios-manage"
                    type="button"
                    onClick={() => abrirAdministracion(u)}
                  >
                    Administrar <span aria-hidden="true">→</span>
                  </button>
                </article>
              ))}

              {cargandoUsuarios && <div className="usuarios-loading"><span aria-hidden="true" />Cargando usuarios…</div>}
              {usuarios.length === 0 && !error && !cargandoUsuarios && (
                <div className="usuarios-empty">
                  No hay usuarios cargados todavía.
                </div>
              )}
              {usuarios.length > 0 && usuariosVisibles.length === 0 && !cargandoUsuarios && (
                <div className="usuarios-empty">No hay cuentas que coincidan con esta búsqueda.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      {modalAltaAbierto && (
        <Modal
          onClose={cerrarAlta}
          overlayAriaLabel="Agregar usuario"
          closeOnBackdropClick
          style={{ maxWidth: "720px" }}
          title={
            <div>
              <span className="usuarios-eyebrow">Nuevo acceso</span>
              <h3 style={{ margin: 0 }}>Agregar usuario</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", margin: "6px 0 0" }}>
                Creá la cuenta y dejá listo su correo de notificaciones.
              </p>
            </div>
          }
        >
            <form className="modal-body" onSubmit={handleCrear}>
              <div className="form-grid cols-2 usuarios-form-grid">
                <label className="form-field">
                  <span>Nombre y apellido *</span>
                  <input type="text" value={nombre} onChange={handleNombreChange} required autoFocus />
                </label>
                <label className="form-field">
                  <span>Rol *</span>
                  <select value={rol} onChange={(e) => setRol(e.target.value)}>
                    {Object.entries(ROL_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Usuario de acceso *</span>
                  <input
                    type="text"
                    value={usuario}
                    placeholder="ej: Luciano"
                    onChange={(e) => setUsuario(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Contraseña inicial * <small style={{fontWeight: 400, color: 'var(--muted)'}}>(mín. 8 caracteres)</small></span>
                  <div className="usuarios-password-field">
                    <input
                      type="text"
                      value={password}
                      placeholder="Contraseña segura"
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength="8"
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const random = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase();
                        setPassword(random);
                      }}
                      title="Generar contraseña segura"
                    >
                      Generar
                    </button>
                  </div>
                  <small>La persona puede cambiarla en su primer login.</small>
                </label>
                <label className="form-field usuarios-form-email">
                  <span>Correo para notificaciones</span>
                  <input
                    type="email"
                    value={emailNotificaciones}
                    placeholder="nombre@gmail.com"
                    onChange={(e) => setEmailNotificaciones(e.target.value)}
                  />
                  <small>Puede agregarse después desde Administrar.</small>
                </label>
              </div>

              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <div className="modal-actions">
                <button className="btn" type="button" onClick={cerrarAlta} disabled={enviando}>
                  Cancelar
                </button>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {usuarioAdministrado && (
        <div className="usuarios-modal-backdrop" role="presentation" onMouseDown={cerrarAdministracion}>
          <aside
            className="usuarios-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="administrar-usuario-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="usuarios-panel-header">
              <button
                className="usuarios-close"
                type="button"
                onClick={cerrarAdministracion}
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className="usuarios-panel-identity">
                <div className="usuarios-avatar is-large">
                  {usuarioAdministrado.foto_perfil ? (
                    <img src={usuarioAdministrado.foto_perfil} alt="" />
                  ) : (
                    iniciales(usuarioAdministrado.nombre)
                  )}
                </div>
                <div>
                  <span className="usuarios-eyebrow">Cuenta del equipo</span>
                  <h3 id="administrar-usuario-title">{usuarioAdministrado.nombre}</h3>
                  <div className={`usuarios-role role-${usuarioAdministrado.rol}`}>
                    {ROL_LABELS[usuarioAdministrado.rol] || usuarioAdministrado.rol}
                  </div>
                </div>
              </div>
            </div>

            <div className="usuarios-panel-body">
              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Identidad y rol</strong>
                    <span>Nombre, usuario y permisos</span>
                  </div>
                  {!editandoDatos && (
                    <button className="btn" type="button" onClick={iniciarEdicionDatos}>
                      Editar
                    </button>
                  )}
                </div>

                {editandoDatos ? (
                  <div className="usuarios-data-editor">
                    <div className="form-grid cols-2">
                      <label className="form-field">
                        <span>Nombre</span>
                        <input
                          type="text"
                          value={nombreEdicion}
                          onChange={(e) => setNombreEdicion(e.target.value)}
                          disabled={guardandoDatos}
                          autoFocus
                        />
                      </label>
                      <label className="form-field">
                        <span>Usuario de acceso</span>
                        <input
                          type="text"
                          value={usuarioEdicion}
                          onChange={(e) => setUsuarioEdicion(e.target.value)}
                          disabled={guardandoDatos}
                        />
                      </label>
                      <label className="form-field">
                        <span>Rol</span>
                        <select value={rolEdicion} onChange={(e) => setRolEdicion(e.target.value)} disabled={guardandoDatos}>
                          {Object.entries(ROL_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoDatos}
                        onClick={() => {
                          setEditandoDatos(false);
                          setFormError(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoDatos}
                        onClick={() => guardarDatos(usuarioAdministrado)}
                      >
                        {guardandoDatos ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="usuarios-detail-grid">
                    <div>
                      <span>Nombre</span>
                      <strong>{usuarioAdministrado.nombre}</strong>
                    </div>
                    <div>
                      <span>Usuario</span>
                      <strong>{usuarioAdministrado.usuario}</strong>
                    </div>
                    <div>
                      <span>Rol</span>
                      <strong>{ROL_LABELS[usuarioAdministrado.rol] || usuarioAdministrado.rol}</strong>
                    </div>
                    <div>
                      <span>Estado</span>
                      <strong className="status-ready">Activo</strong>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Correo de avisos</strong>
                    <span>Destino de las notificaciones</span>
                  </div>
                  {!editandoCorreo && (
                    <button className="btn" type="button" onClick={iniciarEdicionCorreo}>
                      {usuarioAdministrado.email_notificaciones ? "Cambiar" : "Agregar"}
                    </button>
                  )}
                </div>

                {editandoCorreo ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Correo de notificaciones</span>
                      <input
                        type="email"
                        value={correoEdicion}
                        placeholder="nombre@gmail.com"
                        onChange={(e) => setCorreoEdicion(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => {
                          setEditandoCorreo(false);
                          setFormError(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => guardarCorreo(usuarioAdministrado)}
                      >
                        {guardandoCorreo ? "Guardando..." : "Guardar correo"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>
                        {usuarioAdministrado.email_notificaciones || "Correo pendiente de configurar"}
                      </strong>
                      <span>
                        {usuarioAdministrado.email_notificaciones
                          ? "Esta persona puede recibir avisos de tareas."
                          : "Esta persona todavía no recibirá avisos por email."}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Acceso con Google</strong>
                    <span>Ingreso directo sin contraseña</span>
                  </div>
                  {!editandoGoogleEmail && (
                    <button className="btn" type="button" onClick={iniciarEdicionGoogleEmail}>
                      {usuarioAdministrado.google_email ? "Cambiar" : "Vincular"}
                    </button>
                  )}
                </div>

                {editandoGoogleEmail ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Email de Google</span>
                      <input
                        type="email"
                        value={googleEmailEdicion}
                        placeholder="nombre@gmail.com"
                        onChange={(e) => setGoogleEmailEdicion(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoGoogleEmail}
                        onClick={() => {
                          setEditandoGoogleEmail(false);
                          setFormError(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoGoogleEmail}
                        onClick={() => guardarGoogleEmail(usuarioAdministrado)}
                      >
                        {guardandoGoogleEmail ? "Guardando..." : "Guardar email"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.google_email ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.google_email ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>
                        {usuarioAdministrado.google_email || "Email de Google sin vincular"}
                      </strong>
                      <span>
                        {usuarioAdministrado.google_email
                          ? "Esta persona puede ingresar con su cuenta de Google."
                          : "Esta persona ingresa solo con contraseña."}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Enviar acceso</strong>
                    <span>Instrucciones para iniciar sesión</span>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={!usuarioAdministrado.email_notificaciones || enviandoInvitacion}
                    onClick={() => enviarInvitacion(usuarioAdministrado)}
                  >
                    {enviandoInvitacion ? "Enviando..." : "Enviar instrucciones"}
                  </button>
                </div>
                <div className="usuarios-security-note">
                  La contraseña no se muestra. Cada persona puede cambiarla
                  desde <strong>Mi perfil</strong>.
                </div>
              </section>

              <section className="usuarios-panel-section usuarios-danger-zone">
                <div>
                  <strong>Dar de baja el acceso</strong>
                  <span>La persona dejará de ingresar a la plataforma.</span>
                </div>
                <button
                  className="btn usuarios-danger-btn"
                  type="button"
                  onClick={() => handleEliminar(usuarioAdministrado)}
                >
                  Dar de baja
                </button>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
