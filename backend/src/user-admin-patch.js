import { resolveUserRole } from './user-roles.js';

export class UserAdministrationInputError extends Error {
  constructor(message, status = 400, code = 'USER_ADMIN_INPUT_INVALID') {
    super(message); this.name = 'UserAdministrationInputError'; this.status = status; this.code = code;
  }
}
const invalid = message => new UserAdministrationInputError(message);
export const USER_ADMIN_REVISION_SQL = "concat('ua1:',id,':',user_admin_version)";
export function userAdministrationId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || String(Number(value)) !== value || Number(value) > 2147483647) throw invalid('Usuario inválido.');
  return Number(value);
}
export function expectedUserAdministrationVersion(value, id) {
  if (value === undefined) throw new UserAdministrationInputError('Abrí la cuenta guardada antes de modificarla.',428,'USER_ADMIN_REVISION_REQUIRED');
  const match = typeof value === 'string' && /^ua1:([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (!match || match[0] !== value || match.slice(1).some(part => Number(part) > 2147483647)) {
    throw new UserAdministrationInputError('La versión de la cuenta no es válida.',400,'USER_ADMIN_REVISION_INVALID');
  }
  if (Number(match[1]) !== id) throw userAdministrationConflict();
  return Number(match[2]);
}
export function userAdministrationConflict() {
  return new UserAdministrationInputError('La cuenta cambió. Conservá tus cambios y revisá la versión guardada antes de volver a editar.',409,'USER_ADMIN_REVISION_CONFLICT');
}
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
function label(value, limit, field) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > limit || controls.test(value)) throw invalid(`${field} no es válido.`);
  return value.trim();
}
function contact(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || controls.test(value)) throw invalid(`${field} no es válido.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function normalizeUserAdministrationPatch(body, operation, id) {
  const fields = { access:['activo'], identity:['nombre','usuario','rol'], notices:['email_notificaciones'], google:['google_email'], whatsapp:['whatsapp'] }[operation];
  if (!fields) throw new Error('Unknown account administration operation');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => ![...fields,'expected_revision'].includes(key))) throw invalid('Los campos de la cuenta no son válidos.');
  const expected_version = expectedUserAdministrationVersion(body.expected_revision,id);
  if (fields.some(field => !Object.hasOwn(body,field))) throw invalid('Faltan campos explícitos para actualizar la cuenta.');
  const result = { expected_version, expected_revision:body.expected_revision };
  if (operation === 'access') {
    if (typeof body.activo !== 'boolean') throw invalid('Indicá el estado activo de la cuenta.');
    result.activo = body.activo;
  } else if (operation === 'identity') {
    result.nombre = label(body.nombre,200,'El nombre'); result.usuario = label(body.usuario,128,'El usuario de acceso');
    if (Buffer.byteLength(result.usuario,'utf8') > 320) throw invalid('El usuario de acceso no es válido.');
    result.rol = resolveUserRole(label(body.rol,100,'El rol'));
    if (!result.rol) throw invalid('La categoría laboral no es válida.');
  } else if (operation === 'whatsapp') {
    const value = contact(body.whatsapp,'El número de WhatsApp');
    if (value !== null && (value.length > 100 || !/^[+()0-9 .-]+$/.test(value) || !/^\d{10,15}$/.test(value.replace(/\D/g,'')))) throw invalid('El número de WhatsApp no es válido.');
    result.whatsapp = value === null ? null : value.replace(/\D/g,'');
  } else {
    const key = fields[0], value = contact(body[key],'El correo');
    if (value !== null && (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw invalid('El correo no es válido.');
    result[key] = value?.toLowerCase() || null;
  }
  return result;
}
