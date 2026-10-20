import { resolveUserRole } from './user-roles.js';
import { newPasswordError } from '../../shared/password-policy.mjs';

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Applies only to new accounts. Existing credentials are not rewritten or
// invalidated, and passwords are never trimmed or silently truncated by bcrypt.
export function normalizeUserCreateInput(body) {
  const fields = new Set(['usuario', 'nombre', 'rol', 'password', 'email_notificaciones']);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !fields.has(key))) throw invalid('Los datos del empleado no son válidos.');
  const text = (value, max, label) => {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw invalid(`${label} no es válido.`);
    return value.trim();
  };
  const usuario = text(body.usuario, 128, 'El usuario de acceso');
  if (Buffer.byteLength(usuario,'utf8') > 320) throw invalid('El usuario de acceso no es válido.');
  const nombre = text(body.nombre, 200, 'El nombre');
  const roleInput = text(body.rol, 100, 'El rol');
  const rol = resolveUserRole(roleInput);
  if (!rol) throw invalid('La categoría laboral no es válida.');
  const passwordIssue = newPasswordError(body.password);
  if (passwordIssue) throw invalid(passwordIssue);
  let email = null;
  if (body.email_notificaciones !== undefined && body.email_notificaciones !== null) {
    if (typeof body.email_notificaciones !== 'string') throw invalid('El correo para notificaciones no es válido.');
    email = body.email_notificaciones.trim().toLowerCase() || null;
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || /[\u0000-\u001f\u007f-\u009f]/u.test(email))) throw invalid('El correo para notificaciones no es válido.');
  }
  return { usuario, nombre, rol, password: body.password, email_notificaciones: email };
}
