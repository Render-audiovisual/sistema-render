// Static code only: no report fetch, session cache or authorization shortcut.
export function createReportModuleLoader(load) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(load).catch(error => { pending = null; throw error; });
    return pending;
  };
}
export const loadInstagramReportModule = createReportModuleLoader(() => import('./InstagramClientReport.jsx'));
export function warmInstagramReportModule(path, load = loadInstagramReportModule) {
  if (!['/instagram', '/instagram/reporte'].includes(path)) return;
  void load().catch(() => {});
}
