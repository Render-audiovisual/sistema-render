// Presentation only. Server authorization remains authoritative.
export function canUseSharedCalendarRole(role) {
  return ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion'].includes(role);
}

export function getNavigationGroups(role) {
  const admin = role === "admin";
  return [
    { id: "personal", label: "Mi espacio", links: [
      { href: "/inicio", label: "Inicio", icon: "home" },
      { href: "/workspace/tareas", label: "Tareas", icon: "tasks" },
      { href: "/lista", label: "Mi lista", icon: "list" },
      ...(canUseSharedCalendarRole(role) ? [{ href: "/calendario", label: "Calendario", icon: "calendar" }] : []),
    ] },
    { id: "operation", label: "Operación", links: [
      { href: "/clientes", label: "Clientes", icon: "clients" },
      { href: "/producciones", label: "Producciones", icon: "video" },
    ] },
    { id: "content", label: "Contenido", links: [
      { href: "/feedback", label: "Feedback", icon: "feedback" },
    ] },
    { id: "resources", label: "Recursos y seguimiento", links: [
      { href: "/reportes-historias", label: "Reportes", icon: "reports" },
      ...(admin ? [{ href: "/sueldos", label: "Finanzas", icon: "salary" }] : []),
    ] },
    { id: "account", label: "Cuenta", links: [
      { href: "/perfil", label: "Perfil", icon: "profile" },
      ...(admin ? [{ href: "/clientes?gestion=1", label: "Gestionar clientes", icon: "clients" }] : []),
      ...(admin ? [{ href: "/empleados", label: "Usuarios y equipo", icon: "users" }] : []),
    ] },
  ];
}

export function isNavigationActive(href, pathname, search = "") {
  if (pathname === '/clientes/operacion') return href === '/clientes';
  const aliases = { "/bloc-notas": "/feedback", "/calendario-estructura": "/planificacion-historias" };
  if (pathname === "/clientes" && ["/clientes", "/clientes?gestion=1"].includes(href)) {
    const management = new URLSearchParams(search).get("gestion") === "1";
    return href === (management ? "/clientes?gestion=1" : "/clientes");
  }
  return href === (aliases[pathname] || pathname);
}
