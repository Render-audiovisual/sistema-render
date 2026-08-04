export function normalizeUserKey(usuario) {
  return (usuario || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getDefaultUserRoute({ usuario, rol }, knownRoutes) {
  const userKey = normalizeUserKey(usuario);
  if (userKey === "agustin") return "/lider";
  if (knownRoutes[userKey]) return knownRoutes[userKey];
  return rol === "admin" ? "/lider" : "/workspace/tareas";
}
