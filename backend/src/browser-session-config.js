import { createBrowserSessionTransport } from './browser-session-transport.js';
import { requireAuthentication, requireCurrentIdentity } from './auth.js';
import { configuredOwnerProfiles } from './owner-profile-authority.js';

export function configuredBrowserSessions(env, pool) {
  // Validate an explicitly supplied mapping even if browser sessions are off;
  // production must never silently retain an unsupported delegation config.
  const ownerProfiles = configuredOwnerProfiles(env, pool);
  if (env.RENDER_BROWSER_SESSIONS === undefined || env.RENDER_BROWSER_SESSIONS === 'false') return null;
  if (env.RENDER_BROWSER_SESSIONS !== 'true'
    || ![undefined, 'false', 'true'].includes(env.RENDER_BROWSER_ALLOW_LOCAL_HTTP)
    || (env.RENDER_BROWSER_ALLOW_LOCAL_HTTP === 'true' && !['development', 'test'].includes(env.NODE_ENV)))
    throw new Error('Invalid browser session configuration');
  return createBrowserSessionTransport({ origin: env.RENDER_BROWSER_ORIGIN, secret: env.JWT_SECRET,
    development: env.RENDER_BROWSER_ALLOW_LOCAL_HTTP === 'true', pool, ownerProfiles });
}

export function createPrincipalAuthentication({ browserTransport, pool }) {
  const identity = requireCurrentIdentity(pool);
  return (req, res, next) => {
    const raw = req.get?.('cookie') ?? req.headers?.cookie;
    // Even malformed or wrong-environment session cookies imply browser intent.
    // Never fall back to bearer when the strict browser parser rejects them.
    const cookieIntent = typeof raw === 'string' && raw.split(';').some(part =>
      ['__Host-render_session', 'render_dev_session'].includes(part.split('=', 1)[0].trim()));
    const contextIntent = ['x-render-session-context', 'x-render-csrf'].some(name =>
      (req.get?.(name) ?? req.headers?.[name]) !== undefined);
    if (browserTransport && (cookieIntent || contextIntent)) return browserTransport.authenticate(req, res, next);
    return requireAuthentication(req, res, error => error ? next(error) : identity(req, res, next));
  };
}
