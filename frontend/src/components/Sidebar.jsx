import React from "react";
import { getRutaUsuario, inicialesUsuario } from "../utils.jsx";

export function Sidebar({ path, sesion, onCerrarSesion, ROL_LABELS }) {
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaTablero = getRutaUsuario(sesion?.usuario?.usuario, sesion?.usuario?.rol);

  const seccionesNav = {
    inicio: [
      { href: rutaTablero || "/", label: "Inicio" },
    ],
    planificacion: [
      { href: "/planificacion-historias", label: "Historias" },
      { href: "/planificacion-publicaciones", label: "Publicaciones" },
    ],
    gestion: [
      { href: "/workspace/tareas", label: "Tareas" },
      { href: "/reportes-historias", label: "Reporte" },
    ],
    admin: esAdmin ? [
      { href: "/clientes", label: "Clientes" },
    ] : [],
    cuenta: [
      { href: "/perfil", label: "Perfil" },
      ...(esAdmin ? [{ href: "/empleados", label: "Usuarios" }] : []),
    ],
  };

  const enlacesPrincipales = [
    ...seccionesNav.inicio,
    ...seccionesNav.planificacion,
    ...seccionesNav.gestion,
    ...seccionesNav.admin,
  ];
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
        {enlace.label}
      </a>
    ));

  return (
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="sidebar-header">
        <div className="brand-mark">RENDER</div>
      </div>

      <div className="sidebar-content">
        {renderLinksSección(enlacesPrincipales)}
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
