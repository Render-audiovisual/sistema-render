export function normalizeUserKey(usuario) {
  return (usuario || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getDefaultUserRoute({ usuario, rol }, knownRoutes) {
  // Landing destination is shared; its data and permissions are server-owned.
  return "/inicio";
}
