// Presentation only. Server authorization remains authoritative.
export function getNavigationGroups(role) {
  const admin = role === "admin";
  return [
    { id: "personal", label: "Mi espacio", links: [
      { href: "/inicio", label: "Inicio", icon: "home" },
      { href: "/workspace/tareas", label: "Tareas", icon: "tasks" },
      { href: "/lista", label: "Mi lista", icon: "list" },
      ...(admin ? [{ href: "/calendario", label: "Calendario", icon: "calendar" }] : []),
    ] },
    { id: "operation", label: "Operación", links: [
      { href: "/clientes", label: "Clientes y objetivos", icon: "clients" },
      { href: "/proyectos", label: "Proyectos", icon: "projects" },
      { href: "/producciones", label: "Producciones", icon: "video" },
    ] },
    { id: "content", label: "Contenido", links: [
      { href: "/planificacion-historias", label: "Historias", icon: "content" },
      { href: "/planificacion-publicaciones", label: "Publicaciones", icon: "content" },
      { href: "/feedback", label: "Feedback", icon: "feedback" },
    ] },
    { id: "resources", label: "Recursos y seguimiento", links: [
      { href: "/drive", label: "Archivos y Drive", icon: "drive" },
      { href: "/moodboards", label: "Moodboards", icon: "moodboard" },
      { href: "/reportes-historias", label: "Reportes", icon: "reports" },
      ...(admin ? [{ href: "/sueldos", label: "Finanzas", icon: "salary" }] : []),
    ] },
    { id: "account", label: "Cuenta", links: [
      { href: "/perfil", label: "Perfil", icon: "profile" },
      ...(admin ? [{ href: "/empleados", label: "Usuarios y equipo", icon: "users" }] : []),
    ] },
  ];
}

export function isNavigationActive(href, pathname) {
  const aliases = { "/bloc-notas": "/feedback", "/calendario-estructura": "/planificacion-historias" };
  return href === (aliases[pathname] || pathname);
}
