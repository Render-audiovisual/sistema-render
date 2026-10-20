import bcrypt from 'bcryptjs';
import { passwordLoginInput, googleLoginInput } from './login-input.js';
import { findPasswordLoginIdentity, resolveGoogleLoginIdentity } from './login-identity.js';

// One verifier per mechanism, regardless of credential delivery. The mode is
// fixed by the server route, never by untrusted request fields.
export function createLoginHandlers({ pool, allowLoginAttempt, googleClient, googleAudience, sendSuccess }) {
  return {
    password(browser = false) {
      if (typeof browser !== 'boolean') throw new Error('Invalid login mode');
      return async (req, res, next) => {
        try {
          const { usuario: identificador, password } = passwordLoginInput(req.body);
          if (!await allowLoginAttempt(req, res, identificador)) return;
          const usuarioDB = await findPasswordLoginIdentity(pool, identificador);
          if (!usuarioDB) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
          const passwordValida = await bcrypt.compare(password, usuarioDB.password_hash);
          if (!passwordValida || usuarioDB.activo !== true)
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
          return sendSuccess(usuarioDB, res, browser);
        } catch (error) {
          if (error.status === 400) return res.status(400).json({ error: 'Datos de acceso inválidos.' });
          return next(error);
        }
      };
    },
    google(browser = false) {
      if (typeof browser !== 'boolean') throw new Error('Invalid login mode');
      return async (req, res, next) => {
        try {
          const { credential } = googleLoginInput(req.body);
          if (!await allowLoginAttempt(req, res)) return;
          if (!googleClient) return res.status(500).json({ error: 'El login con Google no está configurado en el servidor.' });
          let payload;
          try {
            const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleAudience });
            payload = ticket.getPayload();
          } catch { return res.status(401).json({ error: 'Token de Google inválido o vencido.' }); }
          if (payload?.email_verified !== true || typeof payload.sub !== 'string' || !payload.sub
            || typeof payload.email !== 'string' || !payload.email)
            return res.status(401).json({ error: 'Tu cuenta de Google no tiene el email verificado.' });
          const usuarioDB = await resolveGoogleLoginIdentity(pool, payload);
          return sendSuccess(usuarioDB, res, browser);
        } catch (error) {
          if (error.status === 400) return res.status(400).json({ error: 'Datos de acceso inválidos.' });
          const identityErrors = {
            401: 'La identidad de Google no es válida o no está verificada.',
            403: 'Tu cuenta de Google no tiene una vinculación activa y única. Consultá con un líder.',
            409: 'La vinculación cambió. Volvé a iniciar sesión.',
          };
          if (Object.hasOwn(identityErrors, error.status)) return res.status(error.status).json({ error: identityErrors[error.status] });
          return next(error);
        }
      };
    },
  };
}

export function loginUserDto(user) {
  return { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol, foto_perfil: user.foto_perfil };
}
