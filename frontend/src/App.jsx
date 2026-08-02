import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { cerrarSesion, getRutaUsuario, getSesion, getSesionDelPath } from "./utils.jsx";
import { ROL_LABELS, USUARIO_A_RUTA } from "./constants.js";
import { AugustoDashboard } from "./pages/dashboards/Augusto.jsx";
import { ClientesAdminPage } from "./pages/Clientes.jsx";
import { EmpleadosPage } from "./pages/Empleados.jsx";
import { GermanDashboard } from "./pages/dashboards/German.jsx";
import { HistoriasPage } from "./pages/Historias.jsx";
import { LiderDashboard } from "./pages/dashboards/Lider.jsx";
import { LoginPage } from "./pages/Login.jsx";
import { LucianoDashboard } from "./pages/dashboards/Luciano.jsx";
import { OrianaDashboard } from "./pages/dashboards/Oriana.jsx";
import { PerfilPage } from "./pages/Perfil.jsx";
import { PublicacionesPage } from "./pages/Publicaciones.jsx";
import { ReportesEquipoPage } from "./pages/Reportes.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { TareasTableroPage } from "./pages/TareasTablero.jsx";

export function App() {
  const path = window.location.pathname;
  let sesion = getSesion();

  if (path === "/agustin" || path === "/franco") {
    window.location.href = "/lider";
    return null;
  }

  // Si estamos en una ruta de usuario específica, usar esa sesión
  if (Object.values(USUARIO_A_RUTA).includes(path)) {
    sesion = getSesionDelPath(path);
  }

  if (path === "/login") {
    if (sesion) {
      window.location.href = getRutaUsuario(sesion.usuario.usuario) || "/";
      return null;
    }
    return <LoginPage />;
  }

  if (!sesion) {
    window.location.href = "/login";
    return null;
  }

  const esAdmin = sesion.usuario.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion.usuario.usuario);

  if (path === "/") {
    window.location.href = rutaPropia || "/login";
    return null;
  }

  const rutasCompartidas = ["/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/perfil", "/piezas"];
  const rutaPermitida =
    esAdmin || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  const dashboard = (() => {
    if (path === "/lider") {
      return <LiderDashboard />;
    }
    if (path === "/oriana") {
      return <OrianaDashboard />;
    }
    if (path === "/german") {
      return <GermanDashboard />;
    }
    if (path === "/luciano") {
      return <LucianoDashboard />;
    }
    if (path === "/augusto") {
      return <AugustoDashboard />;
    }
    if (path === "/equipo") {
      window.location.href = "/reportes-historias";
      return null;
    }
    if (path === "/clientes") {
      return <ClientesAdminPage />;
    }
    if (path === "/calendario") {
      // Alias histórico: el calendario ahora vive como pestaña dentro del
      // módulo unificado de Publicaciones (no se rompen links guardados).
      return <PublicacionesPage tabInicial="calendario" />;
    }
    if (path === "/calendario-estructura") {
      return <HistoriasPage initialTab="estructura" />;
    }
    if (path === "/planificacion-historias") {
      return <HistoriasPage />;
    }
    if (path === "/reportes-historias") {
      return <ReportesEquipoPage />;
    }
    if (path === "/perfil") {
      return <PerfilPage />;
    }
    if (path === "/empleados") {
      return <EmpleadosPage />;
    }
    if (path === "/piezas") {
      return <TareasTableroPage />;
    }
    if (path === "/planificacion-publicaciones") {
      return <PublicacionesPage />;
    }
    window.location.href = rutaPropia || "/login";
    return null;
  })();

  if (!dashboard) {
    return null;
  }

  return (
    <>
      <Sidebar path={path} sesion={sesion} onCerrarSesion={cerrarSesion} ROL_LABELS={ROL_LABELS} />
      {dashboard}
    </>
  );
}
