/** Presentation-only compatibility: old report bookmarks open the report hub. */
export function clientReportDestination(route) {
  if (typeof route !== 'string' || /[\\\s\u0000-\u001f\u007f]/.test(route)) return null;
  const pathname = route.split(/[?#]/, 1)[0];
  return pathname === '/reportes-historias' || pathname === '/equipo' ? '/instagram' : null;
}

/** Call after the existing session/navigation gates, preserving history state. */
export function replaceClientReportRoute(win) {
  const destination = clientReportDestination(win.location.pathname);
  if (!destination) return false;
  const state = win.history.state;
  win.history.replaceState(state, '', destination);
  win.dispatchEvent(new win.PopStateEvent('popstate', { state }));
  return true;
}

/** Preserve independent account/team sections and their chosen month. */
export function clientReportPanelLocation(location) {
  return location;
}
