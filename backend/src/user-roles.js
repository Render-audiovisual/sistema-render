export const SYSTEM_USER_ROLES = [
  "admin",
  "diseno",
  "edicion",
  "produccion",
  "community",
  "programacion",
];

export function normalizeUserRole(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function isValidUserRole(value) {
  const role = normalizeUserRole(value);
  return role.length >= 2 && /^[a-z][a-z0-9_]*$/.test(role);
}

export function resolveUserRole(value) {
  return isValidUserRole(value) ? normalizeUserRole(value) : null;
}
