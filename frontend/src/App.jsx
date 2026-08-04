import React from "react";
import { cerrarSesion, getRutaUsuario, getSesion } from "./utils.jsx";
import { ROL_LABELS } from "./constants.js";
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
import { SueldosPage } from "./pages/Sueldos.jsx";
import { CargaAgostoPage } from "./pages/CargaAgosto.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { WorkspaceReadOnlyPage } from "./pages/WorkspaceReadOnly.jsx";

export function App() {
  const path = window.location.pathname;
  let sesion = getSesion();

  if (path === "/agustin" || path === "/franco") {
    window.location.href = "/lider";
    return null;
  }

  if (path === "/login") {
    if (sesion) {
      window.location.href = getRutaUsuario(sesion.usuario.usuario, sesion.usuario.rol);
      return null;
    }
    return <LoginPage />;
  }

  if (!sesion) {
    window.location.href = "/login";
    return null;
  }

  const esAdmin = sesion.usuario.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion.usuario.usuario, sesion.usuario.rol);

  if (path === "/") {
    window.location.href = rutaPropia || "/login";
    return null;
  }

  const rutasCompartidas = esAdmin
    ? ["/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/sueldos", "/carga-agosto-2026", "/perfil", "/piezas", "/workspace/tareas"]
    : ["/perfil", "/workspace/tareas"];
  const rutaPermitida =
    esAdmin || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  if (path === "/piezas") {
    window.location.replace("/workspace/tareas");
    return null;
  }

  const dashboard = (() => {
    if (path === "/workspace/tareas") {
      return <WorkspaceReadOnlyPage path={path} sesion={sesion} />;
    }
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
    if (path === "/sueldos") {
      return <SueldosPage />;
    }
    if (path === "/carga-agosto-2026") {
      return <CargaAgostoPage />;
    }
    if (path === "/perfil") {
      return <PerfilPage />;
    }
    if (path === "/empleados") {
      return <EmpleadosPage />;
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
