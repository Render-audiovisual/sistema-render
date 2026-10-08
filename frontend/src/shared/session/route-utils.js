export function normalizeUserKey(usuario) {
  return (usuario || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getDefaultUserRoute({ usuario, rol }, knownRoutes) {
  return "/inicio";
}
