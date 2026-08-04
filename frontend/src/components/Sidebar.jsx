import React, { useEffect, useState } from "react";
import { getRutaUsuario, inicialesUsuario } from "../utils.jsx";

function SidebarIcon({ name }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 8 1.5 1.5L12 7"/><path d="M14 8h3"/><path d="m8 14 1.5 1.5L12 13"/><path d="M14 14h3"/></>,
    content: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/></>,
    clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    users: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5"/></>,
  };
  return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.content}</svg>;
}

export function Sidebar({ path, sesion, onCerrarSesion, ROL_LABELS }) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaTablero = getRutaUsuario(sesion?.usuario?.usuario, sesion?.usuario?.rol);
  const primerNombre = sesion?.usuario?.nombre?.trim().split(/\s+/)[0] || "equipo";

  const seccionesNav = {
    inicio: [
      { href: rutaTablero || "/", label: "Inicio", icon: "home" },
    ],
    trabajo: [
      { href: "/workspace/tareas", label: "Tareas", icon: "tasks" },
    ],
    planificacion: esAdmin ? [
      {
        href: "/planificacion-historias",
        label: "Historias",
        description: "Planificá historias por cliente y período.",
      },
      {
        href: "/planificacion-publicaciones",
        label: "Publicaciones",
        description: "Organizá y seguí las publicaciones.",
      },
    ] : [],
    gestion: esAdmin ? [
      { href: "/reportes-historias", label: "Reportes", icon: "reports" },
    ] : [],
    admin: esAdmin ? [
      { href: "/clientes", label: "Clientes", icon: "clients" },
    ] : [],
    cuenta: [
      { href: "/perfil", label: "Perfil", icon: "profile" },
      ...(esAdmin ? [{ href: "/empleados", label: "Usuarios", icon: "users" }] : []),
    ],
  };

  const enlacesCuenta = seccionesNav.cuenta;
  const cuentaActiva = enlacesCuenta.some((enlace) => path === enlace.href);

  useEffect(() => {
    const cerrarConEscape = (event) => {
      if (event.key === "Escape") setMenuAbierto(false);
    };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, []);

  const renderLinksSección = (enlaces) =>
    enlaces.map((enlace) => (
      <a
        key={enlace.href}
        href={enlace.href}
        target="_self"
        className={`sidebar-link ${path === enlace.href ? "active" : ""}`}
      >
        {enlace.icon && <SidebarIcon name={enlace.icon}/>}
        {enlace.description ? (
          <span className="sidebar-link-copy">
            <strong>{enlace.label}</strong>
            <small>{enlace.description}</small>
          </span>
        ) : enlace.label}
      </a>
    ));

  return (
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="sidebar-header">
        <a className="brand-mark" href={rutaTablero || "/"} aria-label="Ir al Inicio">
          <span className="brand-initial">R</span>
          <span className="brand-greeting">
            <strong>Hola, {primerNombre}</strong>
            <small>Vamos equipo, ¡a cerrar un gran mes!</small>
          </span>
        </a>
        <button
          type="button"
          className="sidebar-menu-toggle"
          aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuAbierto}
          aria-controls="sidebar-drawer"
          onClick={() => setMenuAbierto((abierto) => !abierto)}
        >
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </button>
      </div>

      <div id="sidebar-drawer" className={`sidebar-drawer ${menuAbierto ? "is-open" : ""}`}>
        <div className="sidebar-content">
          {renderLinksSección(seccionesNav.inicio)}
          {renderLinksSección(seccionesNav.trabajo)}
          {esAdmin && <details className={`nav-menu ${seccionesNav.planificacion.some((item) => item.href === path) ? "active" : ""}`}>
            <summary className="sidebar-link" aria-label="Abrir opciones de Contenido">
              <span className="sidebar-link-label"><SidebarIcon name="content"/><span>Contenido</span></span>
              <span className="nav-menu-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="nav-menu-panel" aria-label="Opciones de Contenido">
              <div className="nav-menu-heading">¿Qué querés planificar?</div>
              {renderLinksSección(seccionesNav.planificacion)}
            </div>
          </details>}
          {renderLinksSección(seccionesNav.admin)}
          {renderLinksSección(seccionesNav.gestion)}
        </div>

        <details className={`account-menu ${cuentaActiva ? "active" : ""}`}>
          <summary className="account-trigger">
            <div className="user-badge">
              <div className="user-avatar">
                {sesion?.usuario?.foto_perfil ? (
                  <img src={sesion.usuario.foto_perfil} alt="" />
                ) : (
                  inicialesUsuario(sesion?.usuario?.nombre)
                )}
              </div>
              <div className="user-info">
                <div className="user-name">{sesion?.usuario?.nombre}</div>
                <div className="user-role">{ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</div>
              </div>
            </div>
          </summary>
          <div className="account-menu-panel">
            {renderLinksSección(enlacesCuenta)}
            <button
              className="sidebar-link logout-btn"
              onClick={onCerrarSesion}
            >
              Cerrar sesión
            </button>
          </div>
        </details>
      </div>

      <button
        type="button"
        className={`sidebar-backdrop ${menuAbierto ? "is-open" : ""}`}
        aria-label="Cerrar menú"
        tabIndex={menuAbierto ? 0 : -1}
        onClick={() => setMenuAbierto(false)}
      />
    </nav>
  );
}
