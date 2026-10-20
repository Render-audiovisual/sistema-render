import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { issueUserToken, requireCurrentIdentity } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const failure = (res, status, code) => res.status(status).json({ code, error: 'Volvé a verificar tu sesión.' });
const header = (req, name) => req.get?.(name) ?? req.headers?.[name.toLowerCase()];
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && /^[A-Za-z0-9_-]{43}$/.test(a) && /^[A-Za-z0-9_-]{43}$/.test(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// No environment, DB, sockets, cookie parser or principal route activation at import.
// This factory is the one browser boundary; external bearer/Wilson stay separate.
export function createBrowserSessionTransport({ origin, secret, development = false, pool }) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Invalid browser session configuration'); }
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (typeof origin !== 'string' || origin !== url.origin || url.username || url.password
    || !['https:', 'http:'].includes(url.protocol)
    || (url.protocol !== 'https:' && !(development === true && local))
    || typeof development !== 'boolean' || typeof secret !== 'string' || secret.length < 32
    || !pool || typeof pool.query !== 'function') throw new Error('Invalid browser session configuration');
  const secure = url.protocol === 'https:';
  const sessionName = secure ? '__Host-render_session' : 'render_dev_session';
  const challengeName = secure ? '__Host-render_login' : 'render_dev_login';
  const currentIdentity = requireCurrentIdentity(pool);
  const bind = (purpose, value) => createHmac('sha256', secret)
    .update(`render-browser-v1:${purpose}\0`).update(origin).update('\0').update(value).digest('base64url');
  const contextFor = token => Object.freeze({
    session_context: bind('context', token), csrf_token: bind('csrf', token),
  });
  const cookie = (name, token, maxAge, sameSite = 'Lax') =>
    `${name}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  function readCookie(req, name) {
    const raw = header(req, 'cookie');
    if (typeof raw !== 'string' || raw.length > 16384 || /[\r\n\0]/.test(raw)) return null;
    const parts = raw.split(';').map(part => part.trim());
    if (parts.some(part => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[^\r\n\0;]*$/.test(part))) return null;
    const values = parts.filter(part => part.split('=', 1)[0] === name);
    if (values.length !== 1) return null;
    const value = values[0].slice(name.length + 1);
    return value.length <= 4096 && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
  }
  function allowedOrigin(req, required = true) {
    const supplied = header(req, 'origin');
    const site = header(req, 'sec-fetch-site');
    return (!site || site === 'same-origin' || site === 'none')
      && (required ? supplied === origin : supplied === undefined || supplied === origin);
  }
  const unambiguous = req => header(req, 'authorization') === undefined;
  const noStore = res => { res.set('Cache-Control', 'no-store'); };

  function issueLoginChallenge(req, res) {
    noStore(res);
    // Same-origin fetch may omit Origin for GET; Fetch Metadata still rejects
    // cross-site/sibling origins. The subsequent POST always requires Origin.
    if (!unambiguous(req) || !allowedOrigin(req, false)) return failure(res, 403, 'browser_origin_invalid');
    const token = jwt.sign({ purpose: 'browser_login' }, secret, {
      algorithm: 'HS256', issuer: 'render', audience: 'render-browser-login', expiresIn: '10m', jwtid: randomUUID(),
    });
    res.set('Set-Cookie', cookie(challengeName, token, 600, 'Strict'));
    return res.json({ csrf_token: bind('login-csrf', token) });
  }

  function requireLoginChallenge(req, res, next) {
    noStore(res);
    if (!unambiguous(req) || !allowedOrigin(req)) return failure(res, 403, 'browser_origin_invalid');
    const token = readCookie(req, challengeName);
    try {
      const claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'render', audience: 'render-browser-login' });
      if (claims.purpose !== 'browser_login' || !UUID.test(claims.jti)
        || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
        || claims.exp - claims.iat !== 600
        || !same(header(req, 'x-render-csrf'), bind('login-csrf', token))) throw new Error('Invalid challenge');
    } catch { return failure(res, 403, 'browser_login_challenge_invalid'); }
    return next();
  }

  // Call only after existing password/Google verification, rate limiting and
  // active account lookup. This is a serializer, not an authentication endpoint.
  function establishSession(user, res) {
    const token = issueUserToken(user, secret);
    noStore(res);
    res.set('Set-Cookie', cookie(sessionName, token, 8 * 60 * 60));
    return contextFor(token); // JWT never enters the browser-readable JSON DTO.
  }

  async function authenticate(req, res, next) {
    noStore(res);
    if (!unambiguous(req)) return failure(res, 400, 'browser_credentials_ambiguous');
    if (!allowedOrigin(req, false)) return failure(res, 403, 'browser_origin_invalid');
    const token = readCookie(req, sessionName);
    let context;
    try {
      req.auth = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'render', audience: 'render-api' });
      // Browser contexts require unique login issuance; legacy bearer stays valid
      // only through the separate existing external/bearer boundary.
      if (!UUID.test(req.auth.jti)) throw new Error('Missing browser login identifier');
      context = contextFor(token);
    } catch { return failure(res, 401, 'browser_session_invalid'); }
    if (!SAFE_METHODS.has(req.method)) {
      if (!allowedOrigin(req)) return failure(res, 403, 'browser_origin_invalid');
      if (!same(header(req, 'x-render-session-context'), context.session_context))
        return failure(res, 409, 'browser_session_changed');
      if (!same(header(req, 'x-render-csrf'), context.csrf_token))
        return failure(res, 403, 'browser_csrf_invalid');
    }
    return currentIdentity(req, res, error => {
      if (error) return next(error);
      req.browserSession = context;
      // A different tab may replace the cookie before a GET is dispatched.
      // The caller must verify which context actually produced this response.
      res.set('X-Render-Session-Context', context.session_context);
      return next();
    });
  }

  // Intentionally no cookie clearing/refresh here. Browsers apply Set-Cookie
  // before JavaScript race guards: old logout/401 must not erase a new login.
  return Object.freeze({ sessionName, challengeName, issueLoginChallenge, requireLoginChallenge, establishSession, authenticate });
}
