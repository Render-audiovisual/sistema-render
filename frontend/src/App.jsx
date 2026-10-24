import React from "react";
import { cerrarSesion, getRutaUsuario } from "./utils.jsx";
import { useApplicationSession } from './shared/session/use-application-session.js';
import { getApplicationSessionSnapshot } from './shared/session/application-session-access.js';
import { useNavigationConfirmation } from './components/NavigationDiscardHost.jsx';
import { sessionViewKey } from './shared/session/session-view.js';
import { getRolLabel, ROL_LABELS } from "./constants.js";
import { LoginPage } from "./pages/Login.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { QuickHomePage } from "./pages/QuickHome.jsx";
import { navigateWithinApp, navigateWithConfirmation, readRouteKey } from "./shared/navigation/location.js";
import { canonicalLegacyRoute, replaceLegacyRoute } from "./shared/navigation/legacy-routes.js";
import { loginHrefForDestination, readLoginDestination, resolveLoginDestination } from "./shared/navigation/login-destination.js";
import { canUseSharedCalendarRole } from "./components/navigation.js";
import { useSectionContentFocus } from './components/SectionContentFocus.jsx';
import { sectionFocusKey } from './shared/navigation/section-focus.js';
import { GoalDraftMemoryProvider } from './components/GoalDraftMemoryProvider.jsx';

const lazyNamed = (loader, name) => React.lazy(() => loader().then((module) => ({ default: module[name] })));
const FeedbackPage = lazyNamed(() => import("./pages/Feedback.jsx"), "FeedbackPage");
const ProjectsPage = lazyNamed(() => import("./pages/Projects.jsx"), "ProjectsPage");
const ClientesAdminPage = lazyNamed(() => import("./pages/Clientes.jsx"), "ClientesAdminPage");
const ClientesObjetivosPage = lazyNamed(() => import("./pages/ClientesObjetivos.jsx"), "ClientesObjetivosPage");
const ClientOperationPage = lazyNamed(() => import("./pages/ClientOperationPage.jsx"), "ClientOperationPage");
const EmpleadosPage = lazyNamed(() => import("./pages/Empleados.jsx"), "EmpleadosPage");
const HistoriasPage = lazyNamed(() => import("./pages/Historias.jsx"), "HistoriasPage");
const PerfilPage = lazyNamed(() => import("./pages/Perfil.jsx"), "PerfilPage");
const PublicacionesPage = lazyNamed(() => import("./pages/Publicaciones.jsx"), "PublicacionesPage");
const ReportesEquipoPage = lazyNamed(() => import("./pages/Reportes.jsx"), "ReportesEquipoPage");
const SueldosPage = lazyNamed(() => import("./pages/Sueldos.jsx"), "SueldosPage");
const WorkspaceReadOnlyPage = lazyNamed(() => import("./pages/WorkspaceReadOnly.jsx"), "WorkspaceReadOnlyPage");
const DrivePage = lazyNamed(() => import("./pages/Drive.jsx"), "DrivePage");
const PersonalListsPage = lazyNamed(() => import("./pages/PersonalLists.jsx"), "PersonalListsPage");
const MoodboardPreviewPage = lazyNamed(() => import("./pages/MoodboardPreview.jsx"), "MoodboardPreviewPage");
const ProductionsPage = lazyNamed(() => import("./pages/Productions.jsx"), "ProductionsPage");
const CalendarPage = lazyNamed(() => import("./pages/Calendar.jsx"), "CalendarPage");

function RouteLoading() {
  return <main className="route-loading" aria-live="polite"><span aria-hidden="true"/><strong>Abriendo sección…</strong><small>Cargando solamente lo necesario.</small></main>;
}

export function App() {
  const [route, setRoute] = React.useState(() => readRouteKey(window));
  const [navigationTick, setNavigationTick] = React.useState(0);
  const navigationEpoch = React.useRef(0);
  const path = route.split(/[?#]/, 1)[0];
  const sessionSnapshot = useApplicationSession();
  const sesion = sessionSnapshot.session;
  const legacyDestination = canonicalLegacyRoute(route);
  const sessionKey = sessionViewKey(sesion);
  // Session comparison may contain credentials in the legacy bearer adapter.
  // Never hand that value to React keys (which can appear in diagnostics).
  const renderIdentity = React.useRef({ observed: sessionKey, epoch: 0 });
  if (renderIdentity.current.observed !== sessionKey) {
    renderIdentity.current = { observed: sessionKey, epoch: renderIdentity.current.epoch + 1 };
  }
  const sessionRenderEpoch = renderIdentity.current.epoch;
  // Opaque presentation lifetime: never put session keys/credentials in props.
  const navigationOwner = React.useRef(null);
  if (!navigationOwner.current || navigationOwner.current.snapshot !== sessionSnapshot
    || navigationOwner.current.route !== route || navigationOwner.current.tick !== navigationTick) {
    navigationOwner.current = { snapshot: sessionSnapshot, route, tick: navigationTick, token: Object.freeze({}) };
  }
  const navigationLifetime = navigationOwner.current.token;
  const navigationConfirmation = useNavigationConfirmation({ lifetime: navigationLifetime });
  // Presentation only: keep focus ownership separate from the full route/query
  // lifetime used to protect unsaved changes. Filters must not refocus the page.
  const contentFocus = useSectionContentFocus({
    sectionKey: sectionFocusKey(path, route.slice(path.length).split('#', 1)[0]),
    owner: sessionRenderEpoch,
    enabled: sessionSnapshot.status === 'authenticated' && Boolean(sesion)
      && path !== '/login' && path !== '/' && !legacyDestination,
  });

  React.useEffect(() => {
    const syncPath = () => {
      navigationEpoch.current++;
      setNavigationTick(value => value + 1);
      setRoute(readRouteKey(window));
    };
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  // Subscribe first: direct authenticated alias loads emit popstate immediately.
  React.useEffect(() => {
    if (sessionKey && legacyDestination) replaceLegacyRoute(window, legacyDestination);
  }, [sessionKey, legacyDestination]);

  const navigate = React.useCallback((href) => {
    navigateWithinApp(window, href);
  }, []);
  const navigateSidebar = React.useCallback((href) => {
    try {
      const observed = getApplicationSessionSnapshot();
      const epoch = navigationEpoch.current, from = readRouteKey(window);
      if (observed !== sessionSnapshot || observed.status !== 'authenticated' || !observed.session
        || navigationOwner.current.token !== navigationLifetime || from.split(/[?#]/, 1)[0] !== path) return Promise.resolve(false);
      return navigateWithConfirmation(window, href, { present: navigationConfirmation.request,
        isCurrent: () => navigationEpoch.current === epoch && readRouteKey(window) === from
          && navigationOwner.current.token === navigationLifetime && getApplicationSessionSnapshot() === observed });
    } catch { return Promise.resolve(false); }
  }, [path, sessionSnapshot, navigationLifetime, navigationConfirmation.request]);

  // Login owns its attempt lifetime. Keep the same form mounted while its
  // controller publishes loading/error, otherwise cleanup would cancel login.
  if (sessionSnapshot.status === 'unknown' || (sessionSnapshot.status === 'loading' && path !== '/login')) return <RouteLoading />;
  if (sessionSnapshot.status === 'error' && path !== '/login') return <main className="route-loading" role="alert">
    <strong>No pudimos verificar tu sesión.</strong><p>Volvé a cargar para verificar el acceso con el servidor.</p>
    <button type="button" onClick={() => window.location.reload()}>Volver a verificar</button>
  </main>;

  if (path === "/login") {
    if (sesion) {
      window.location.replace(resolveLoginDestination(readLoginDestination(window.location.search), sesion.usuario));
      return null;
    }
    return <LoginPage key={route} sessionPending={sessionSnapshot.status === 'loading'} />;
  }

  if (!sesion) {
    // Editors can update their query with replaceState without a popstate.
    // Return to the actual current URL, still constrained by the login policy.
    window.location.replace(loginHrefForDestination(readRouteKey(window)));
    return null;
  }

  const esAdmin = sesion.usuario.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion.usuario.usuario, sesion.usuario.rol);

  if (path === "/") {
    window.location.href = rutaPropia || "/login";
    return null;
  }

  // Alias replacement is a same-document route transition, not an identity
  // boundary. Keep the exact provider type/key at the root during this render
  // so React does not destroy an unsaved draft before the canonical popstate.
  // Unknown/loading/error/login gates above deliberately do not retain it.
  if (legacyDestination) return (
    <GoalDraftMemoryProvider key={`draft-memory:${sessionRenderEpoch}`} session={sesion}>
      <RouteLoading />
    </GoalDraftMemoryProvider>
  );

  const rutasCompartidas = esAdmin
    ? ["/inicio", "/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/sueldos", "/perfil", "/piezas", "/workspace/tareas", "/lista", "/bloc-notas", "/drive", "/moodboards"]
    : ["/inicio", "/perfil", "/workspace/tareas", "/lista", "/bloc-notas", "/drive", "/moodboards", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/clientes", ...(canUseSharedCalendarRole(sesion.usuario.rol) ? ["/calendario", "/calendario-estructura"] : [])];
  const rutaPermitida =
    esAdmin || (path === "/clientes/operacion" && canUseSharedCalendarRole(sesion.usuario.rol)) || path === "/proyectos" || path === "/feedback" || path === "/producciones" || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  const dashboard = (() => {
    if (path === "/proyectos") {
      return <ProjectsPage sesion={sesion} />;
    }
    if (path === "/producciones") {
      return <ProductionsPage sesion={sesion} />;
    }
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
    if (path === "/clientes/operacion") {
      return <ClientOperationPage sesion={sesion} />;
    }
    if (path === "/clientes") {
      return esAdmin && new URLSearchParams(window.location.search).get("gestion") === "1"
        ? <ClientesAdminPage /> : <ClientesObjetivosPage sesion={sesion} />;
    }
    if (path === "/calendario") {
      return <CalendarPage sesion={sesion} onNavigate={navigate} />;
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

  const loadedDashboard = <React.Suspense key={`dashboard:${sessionRenderEpoch}`} fallback={<RouteLoading />}>{dashboard}</React.Suspense>;

  return (
    <GoalDraftMemoryProvider key={`draft-memory:${sessionRenderEpoch}`} session={sesion}>
      {contentFocus.skipLink}
      <Sidebar key={`sidebar:${sessionRenderEpoch}`} path={path} search={window.location.search} sesion={sesion} onNavigate={navigateSidebar} onCerrarSesion={cerrarSesion} ROL_LABELS={ROL_LABELS} getRolLabel={getRolLabel} />
      {contentFocus.marker}
      {loadedDashboard}
      {navigationConfirmation.dialog}
    </GoalDraftMemoryProvider>
  );
}
