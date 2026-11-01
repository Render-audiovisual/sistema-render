import { canonicalLegacyRoute } from './legacy-routes.js';
import { canUseSharedCalendarRole } from '../../components/navigation.js';

// Navigation context only: this never authenticates a person or grants API
// access. Keep API/static/dev-preview/login paths outside the return contract.
const paths = new Set([
  '/inicio', '/workspace/tareas', '/calendario', '/calendario-estructura',
  '/producciones', '/clientes', '/clientes/operacion', '/proyectos', '/planificacion-historias',
  '/planificacion-publicaciones', '/lista', '/feedback', '/bloc-notas',
  '/reportes-historias', '/drive', '/moodboards', '/instagram', '/sueldos', '/empleados', '/perfil',
]);
const pathname = value => value.split(/[?#]/, 1)[0];
export function normalizeLoginDestination(value) {
  if (typeof value !== 'string' || !value || value.length > 4096
    || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  const candidate = canonicalLegacyRoute(value) || value;
  // Check the literal path before URL parsing can normalize dot segments,
  // encoded separators or authority-like input into an apparently safe URL.
  if (!paths.has(pathname(candidate))) return null;
  try {
    const parsed = new URL(candidate, 'https://render.local');
    if (parsed.origin !== 'https://render.local' || parsed.username || parsed.password) return null;
    return candidate;
  } catch { return null; }
}
export function loginHrefForDestination(value) {
  const next = normalizeLoginDestination(value);
  return next ? `/login?${new URLSearchParams({ next })}` : '/login';
}
export function readLoginDestination(search) {
  if (typeof search !== 'string' || search.length > 16384) return null;
  const values = new URLSearchParams(search).getAll('next');
  return values.length === 1 ? normalizeLoginDestination(values[0]) : null;
}
export function resolveLoginDestination(value, user) {
  const next = normalizeLoginDestination(value);
  if (!next || !Number.isSafeInteger(user?.id) || user.id <= 0 || user.activo === false
    || !canUseSharedCalendarRole(user.rol)) return '/inicio';
  const path = pathname(next);
  if (['/instagram', '/sueldos', '/empleados'].includes(path) && user.rol !== 'admin') return '/inicio';
  if (path === '/clientes' && user.rol !== 'admin'
    && new URL(next, 'https://render.local').searchParams.getAll('gestion').includes('1')) return '/clientes';
  return next;
}
