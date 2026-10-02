import React from "react";
import { cerrarSesion, getRutaUsuario, getSesion } from "./utils.jsx";
import { getRolLabel, ROL_LABELS } from "./constants.js";
import { LoginPage } from "./pages/Login.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { QuickHomePage } from "./pages/QuickHome.jsx";

const lazyNamed = (loader, name) => React.lazy(() => loader().then((module) => ({ default: module[name] })));
const AugustoDashboard = lazyNamed(() => import("./pages/dashboards/Augusto.jsx"), "AugustoDashboard");
const FeedbackPage = lazyNamed(() => import("./pages/Feedback.jsx"), "FeedbackPage");
const ClientesAdminPage = lazyNamed(() => import("./pages/Clientes.jsx"), "ClientesAdminPage");
const EmpleadosPage = lazyNamed(() => import("./pages/Empleados.jsx"), "EmpleadosPage");
const GermanDashboard = lazyNamed(() => import("./pages/dashboards/German.jsx"), "GermanDashboard");
const HistoriasPage = lazyNamed(() => import("./pages/Historias.jsx"), "HistoriasPage");
const LiderDashboard = lazyNamed(() => import("./pages/dashboards/Lider.jsx"), "LiderDashboard");
const LucianoDashboard = lazyNamed(() => import("./pages/dashboards/Luciano.jsx"), "LucianoDashboard");
const OrianaDashboard = lazyNamed(() => import("./pages/dashboards/Oriana.jsx"), "OrianaDashboard");
const PerfilPage = lazyNamed(() => import("./pages/Perfil.jsx"), "PerfilPage");
const PublicacionesPage = lazyNamed(() => import("./pages/Publicaciones.jsx"), "PublicacionesPage");
const ReportesEquipoPage = lazyNamed(() => import("./pages/Reportes.jsx"), "ReportesEquipoPage");
const SueldosPage = lazyNamed(() => import("./pages/Sueldos.jsx"), "SueldosPage");
const WorkspaceReadOnlyPage = lazyNamed(() => import("./pages/WorkspaceReadOnly.jsx"), "WorkspaceReadOnlyPage");
const DrivePage = lazyNamed(() => import("./pages/Drive.jsx"), "DrivePage");
const PersonalListsPage = lazyNamed(() => import("./pages/PersonalLists.jsx"), "PersonalListsPage");
const MoodboardPreviewPage = lazyNamed(() => import("./pages/MoodboardPreview.jsx"), "MoodboardPreviewPage");

function RouteLoading() {
  return <main className="route-loading" aria-live="polite"><span aria-hidden="true"/><strong>Abriendo sección…</strong><small>Cargando solamente lo necesario.</small></main>;
}

export function App() {
  const [path, setPath] = React.useState(window.location.pathname);
  let sesion = getSesion();

  React.useEffect(() => {
    const syncPath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const navigate = React.useCallback((href) => {
    const next = new URL(href, window.location.origin);
    if (next.origin !== window.location.origin) return;
    window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
    setPath(next.pathname);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  if (path === "/agustin" || path === "/franco") {
    window.location.href = "/inicio";
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
    ? ["/inicio", "/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/sueldos", "/perfil", "/piezas", "/workspace/tareas", "/lista", "/bloc-notas", "/drive", "/moodboards"]
    : ["/inicio", "/perfil", "/workspace/tareas", "/lista", "/bloc-notas", "/drive", "/moodboards", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias"];
  const rutaPermitida =
    esAdmin || path === "/feedback" || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  if (path === "/piezas" || path === "/wilson-conversaciones") {
    window.location.replace("/workspace/tareas");
    return null;
  }

  const dashboard = (() => {
    if (path === "/inicio") {
      return <QuickHomePage sesion={sesion} onNavigate={navigate} />;
    }
    if (path === "/workspace/tareas") {
      return <WorkspaceReadOnlyPage path={path} sesion={sesion} />;
    }
    if (path === "/lista") {
      return <PersonalListsPage />;
    }
    if (path === "/moodboards") {
      return <MoodboardPreviewPage />;
    }
    if (path === "/bloc-notas" || path === "/feedback") {
      return <FeedbackPage sesion={sesion} />;
    }
    if (path === "/drive") {
      return <DrivePage sesion={sesion} />;
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
      return <PublicacionesPage tabInicial="calendario" sesion={sesion} />;
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
    if (path === "/perfil") {
      return <PerfilPage />;
    }
    if (path === "/empleados") {
      return <EmpleadosPage />;
    }
    if (path === "/planificacion-publicaciones") {
      return <PublicacionesPage sesion={sesion} />;
    }
    window.location.href = rutaPropia || "/login";
    return null;
  })();

  if (!dashboard) {
    return null;
  }

  const loadedDashboard = <React.Suspense fallback={<RouteLoading />}>{dashboard}</React.Suspense>;

  return (
    <>
      <Sidebar path={path} sesion={sesion} onNavigate={navigate} onCerrarSesion={cerrarSesion} ROL_LABELS={ROL_LABELS} getRolLabel={getRolLabel} />
      {loadedDashboard}
    </>
  );
}
