export function normalizeUserKey(usuario) {
  return (usuario || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getDefaultUserRoute({ usuario, rol }, knownRoutes) {
  const userKey = normalizeUserKey(usuario);
  if (rol === "admin" || userKey === "agustin") return "/lider";
  return "/workspace/tareas";
}
