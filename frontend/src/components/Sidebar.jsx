import React from "react";
import { getRutaUsuario, inicialesUsuario } from "../utils.jsx";

export function Sidebar({ path, sesion, onCerrarSesion, ROL_LABELS }) {
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaTablero = getRutaUsuario(sesion?.usuario?.usuario, sesion?.usuario?.rol);

  const seccionesNav = {
    inicio: [
      { href: rutaTablero || "/", label: "Inicio" },
    ],
    trabajo: [
      { href: "/workspace/tareas", label: "Tareas" },
    ],
    planificacion: [
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
    ],
    gestion: [
      { href: "/reportes-historias", label: "Reportes" },
    ],
    admin: esAdmin ? [
      { href: "/clientes", label: "Clientes" },
    ] : [],
    cuenta: [
      { href: "/perfil", label: "Perfil" },
      ...(esAdmin ? [{ href: "/empleados", label: "Usuarios" }] : []),
    ],
  };

  const enlacesCuenta = seccionesNav.cuenta;
  const cuentaActiva = enlacesCuenta.some((enlace) => path === enlace.href);

  const renderLinksSección = (enlaces) =>
    enlaces.map((enlace) => (
      <a
        key={enlace.href}
        href={enlace.href}
        target="_self"
        className={`sidebar-link ${path === enlace.href ? "active" : ""}`}
      >
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
        <div className="brand-mark">RENDER</div>
      </div>

      <div className="sidebar-content">
        {renderLinksSección(seccionesNav.inicio)}
        {renderLinksSección(seccionesNav.trabajo)}
        <details className={`nav-menu ${seccionesNav.planificacion.some((item) => item.href === path) ? "active" : ""}`}>
          <summary className="sidebar-link" aria-label="Abrir opciones de Contenido">
            <span>Contenido</span>
            <span className="nav-menu-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="nav-menu-panel" aria-label="Opciones de Contenido">
            <div className="nav-menu-heading">¿Qué querés planificar?</div>
            {renderLinksSección(seccionesNav.planificacion)}
          </div>
        </details>
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
    </nav>
  );
}
