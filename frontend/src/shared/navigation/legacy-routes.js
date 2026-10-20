const dashboardAliases = new Set([
  // Design/editing homes are replaced by current-ID personal work and monthly
  // progress. Editorial and finance gate closure adds Oriana/Líder aliases to
  // current-identity home; only German's production home remains gated.
  // Reference files stay intact.
  '/agustin', '/franco', '/augusto', '/luciano', '/oriana', '/lider',
]);
const taskAliases = new Set(['/piezas', '/wilson-conversaciones']);

function validTask(value) {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    && Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
}

/** Closed legacy policy. Task context never grants access or selects an identity. */
export function canonicalLegacyRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')
    || /[\\\s\u0000-\u001f\u007f]/.test(route)) return null;

  // Match the literal pathname, without URL normalization or encoded-path guessing.
  const withoutHash = route.split('#', 1)[0];
  const queryStart = withoutHash.indexOf('?');
  const pathname = queryStart < 0 ? withoutHash : withoutHash.slice(0, queryStart);
  if (pathname === '/equipo') return '/reportes-historias';
  if (!dashboardAliases.has(pathname) && !taskAliases.has(pathname)) return null;

  const query = new URLSearchParams(queryStart < 0 ? '' : withoutHash.slice(queryStart + 1));
  const tasks = query.getAll('task');
  if (tasks.length === 1 && validTask(tasks[0])) return `/workspace/tareas?task=${tasks[0]}`;
  return dashboardAliases.has(pathname) ? '/inicio' : '/workspace/tareas';
}

function isCanonicalDestination(destination) {
  if (typeof destination !== 'string') return false;
  if (['/inicio', '/reportes-historias', '/workspace/tareas'].includes(destination)) return true;
  const match = /^\/workspace\/tareas\?task=([1-9][0-9]*)$/.exec(destination);
  return Boolean(match && match[0] === destination && validTask(match[1]));
}

/** Called only after App's session and unsaved-navigation gates have passed. */
export function replaceLegacyRoute(win, destination) {
  if (!isCanonicalDestination(destination)) return false;
  const current = new URL(win.location.href);
  if (!['http:', 'https:'].includes(current.protocol)) return false;
  const next = new URL(destination, current);
  if (next.origin !== current.origin) return false;
  if (next.href === current.href) return false;

  const state = win.history.state;
  win.history.replaceState(state, '', destination);
  win.dispatchEvent(new win.PopStateEvent('popstate', { state }));
  return true;
}
