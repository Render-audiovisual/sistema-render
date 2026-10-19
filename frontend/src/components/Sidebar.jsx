import React, { useEffect, useRef, useState } from "react";
import { inicialesUsuario } from "../utils.jsx";
import { getNavigationGroups, isNavigationActive } from "./navigation.js";
import "./Sidebar.css";

function SidebarIcon({ name }) {
  if (name === "drive") return <svg className="sidebar-icon sidebar-drive-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0F9D58" d="m8.1 3-5.8 10 3.2 5.5 5.8-10z"/><path fill="#4285F4" d="M5.5 18.5h11.6l3.2-5.5H8.7z"/><path fill="#F4B400" d="M8.1 3h6.4l5.8 10h-6.4z"/></svg>;
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2"/></>,
    projects: <><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V3h8v3M3 12h18M10 12v3h4v-3"/></>,
    video: <><rect x="3" y="6" width="12" height="13" rx="2"/><path d="m15 10 6-4v13l-6-4"/></>,
    feedback: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h10M7 14h6"/></>,
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 8 1.5 1.5L12 7"/><path d="M14 8h3"/><path d="m8 14 1.5 1.5L12 13"/><path d="M14 14h3"/></>,
    list: <><path d="m5 7 1.5 1.5L9 6"/><path d="M11 7h8"/><path d="m5 13 1.5 1.5L9 12"/><path d="M11 13h8"/><path d="m5 19 1.5 1.5L9 18"/><path d="M11 19h8"/></>,
    moodboard: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m5 18 4.5-4.5 3 3 2.5-2.5 4 4"/></>,
    content: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/></>,
    clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    salary: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h3"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    users: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5"/></>,
  };
  return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.content}</svg>;
}

export function Sidebar({ path, search = "", sesion, onNavigate, onCerrarSesion, ROL_LABELS, getRolLabel }) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const menuToggle = useRef(null);
  const menuRoot = useRef(null);
  const rutaPrincipal = "/inicio";
  const primerNombre = sesion?.usuario?.nombre?.trim().split(/\s+/)[0] || "equipo";

  const groups = getNavigationGroups(sesion?.usuario?.rol);
  const enlacesCuenta = groups.find((group) => group.id === "account").links;
  const cuentaActiva = enlacesCuenta.some((enlace) => isNavigationActive(enlace.href, path, search));
  const navigate = (event, href) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMenuAbierto(false);
    onNavigate(href);
  };

  useEffect(() => {
    setMenuAbierto(false);
  }, [path]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => { setMobile(media.matches); setMenuAbierto(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const cerrarConEscape = (event) => {
      if (!mobile || !menuAbierto) return;
      if (event.key === "Escape") {
        setMenuAbierto(false);
        menuToggle.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = [...menuRoot.current.querySelectorAll("a[href],button,summary")]
          .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [mobile, menuAbierto]);

  const renderLinksSección = (enlaces) =>
    enlaces.map((enlace) => (
      <a
        key={enlace.href}
        href={enlace.href}
        target="_self"
        aria-label={enlace.label}
        title={enlace.label}
        onClick={(event) => navigate(event, enlace.href)}
        className={`sidebar-link ${isNavigationActive(enlace.href, path, search) ? "active" : ""}`}
        aria-current={isNavigationActive(enlace.href, path, search) ? "page" : undefined}
      >
        {enlace.icon && <SidebarIcon name={enlace.icon}/>}
        {enlace.description ? (
          <span className="sidebar-link-copy">
            <strong>{enlace.label}</strong>
            <small>{enlace.description}</small>
          </span>
        ) : <span className="sidebar-link-text">{enlace.label}</span>}
      </a>
    ));

  return (
    <nav ref={menuRoot} className="sidebar" data-collapsed={collapsed && !mobile ? "true" : "false"} aria-label="Navegación principal">
      <div className="sidebar-header">
        <a className="brand-mark" href={rutaPrincipal} aria-label="Ir al Inicio" onClick={(event) => navigate(event, rutaPrincipal)}>
          <span className="brand-initial">R</span>
          <span className="brand-greeting">
            <strong>Hola, {primerNombre}</strong>
            <small>¡Vamos por un gran mes!</small>
          </span>
        </a>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          title={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-expanded={!collapsed}
          aria-controls="sidebar-drawer"
          onClick={() => setCollapsed((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"}/></svg>
        </button>
        <button
          type="button"
          ref={menuToggle}
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

      <div id="sidebar-drawer" inert={mobile && !menuAbierto ? true : undefined} aria-hidden={mobile && !menuAbierto ? true : undefined} className={`sidebar-drawer ${menuAbierto ? "is-open" : ""}`}>
        <div className="sidebar-content">
          {groups.filter((group) => group.id !== "account").map((group) => (
            <section className="sidebar-group" key={group.id} aria-labelledby={`nav-group-${group.id}`}>
              <h2 id={`nav-group-${group.id}`} className="sidebar-group-label">{group.label}</h2>
              {renderLinksSección(group.links)}
            </section>
          ))}
        </div>

        <details className={`account-menu ${cuentaActiva ? "active" : ""}`}>
          <summary className="account-trigger" aria-label={`Cuenta de ${sesion?.usuario?.nombre || "usuario"}`} title={`Cuenta de ${sesion?.usuario?.nombre || "usuario"}`}>
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
                <div className="user-role">{getRolLabel?.(sesion?.usuario?.rol) || ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</div>
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
