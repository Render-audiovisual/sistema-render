const invalid = () => Object.assign(new Error('Datos de acceso inválidos.'), { status: 400 });
function closedBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))) throw invalid();
}
const bounded = (value, max) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 0 && Buffer.byteLength(value, 'utf8') <= max;

export function passwordLoginInput(body) {
  closedBody(body, ['usuario', 'password']);
  if (typeof body.usuario !== 'string') throw invalid();
  const usuario = body.usuario.trim();
  if (!bounded(usuario, 320) || /\p{Cc}/u.test(usuario) || !bounded(body.password, 1024)) throw invalid();
  // Do not trim or truncate passwords: that would alter existing credentials.
  return { usuario, password: body.password };
}

export function googleLoginInput(body) {
  closedBody(body, ['credential']);
  if (!bounded(body.credential, 16384)) throw invalid();
  return { credential: body.credential };
}
