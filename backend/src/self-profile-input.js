import { newPasswordError } from '../../shared/password-policy.mjs';

export class SelfProfileInputError extends Error {
  constructor(message = 'Los datos del perfil no son válidos.', code = 'PROFILE_INPUT_INVALID') {
    super(message); this.name = 'SelfProfileInputError'; this.status=400; this.code=code;
  }
}
const invalid = () => new SelfProfileInputError();
function loginLabel(value, {newLogin=false}={}) {
  // The current label is a consistency echo, never the write target. Preserve
  // historical labels exactly; apply today's login rules only to a NEW label.
  if (!newLogin) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value,'utf8') > 16384) throw invalid();
    return value;
  }
  if (typeof value !== 'string' || !value.trim() || /\p{Cc}/u.test(value) || Buffer.byteLength(value.trim(),'utf8') > 320
    || [...value.trim()].length > 128) throw invalid();
  return value.trim();
}
function currentPassword(value) {
  // Match legacy login acceptance, not the new-password policy. Existing short
  // credentials are still usable to rotate them; no automatic reset occurs.
  if (typeof value !== 'string' || !value || Buffer.byteLength(value,'utf8') > 1024) throw invalid();
  return value;
}
export function normalizeSelfProfileInput(body, operation) {
  const fields = {photo:['usuario','foto_perfil'],login:['usuario_actual','password_actual','usuario_nuevo'],password:['usuario','password_actual','password_nueva']}[operation];
  if (!fields) throw new Error('Unknown self profile operation');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length
    || Object.keys(body).some(key=>!fields.includes(key))) throw invalid();
  if (operation === 'photo') {
    if (body.foto_perfil !== null && typeof body.foto_perfil !== 'string') throw invalid();
    const photo = body.foto_perfil?.trim() || null;
    if (photo && (!photo.startsWith('data:image/') || photo.length > 1500000)) throw new SelfProfileInputError('La foto debe ser una imagen válida de tamaño permitido.');
    return {usuario:loginLabel(body.usuario),foto_perfil:photo};
  }
  const password_actual = currentPassword(body.password_actual);
  if (operation === 'login') return {usuario_actual:loginLabel(body.usuario_actual),password_actual,usuario_nuevo:loginLabel(body.usuario_nuevo,{newLogin:true})};
  if (typeof body.password_nueva !== 'string') throw invalid();
  const issue = newPasswordError(body.password_nueva);
  if (issue) throw new SelfProfileInputError(issue,'NEW_PASSWORD_INVALID');
  return {usuario:loginLabel(body.usuario),password_actual,password_nueva:body.password_nueva};
}
