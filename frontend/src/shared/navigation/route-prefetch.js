// Download code on intent, never operational data or session-scoped responses.
const loaders = {
  '/workspace/tareas': () => import('../../pages/WorkspaceReadOnly.jsx'),
  '/calendario': () => import('../../pages/Calendar.jsx'),
  '/clientes': () => import('../../pages/ClientesObjetivos.jsx'),
  '/clientes?gestion=1': () => import('../../pages/Clientes.jsx'),
  '/producciones': () => import('../../pages/Productions.jsx'),
  '/lista': () => import('../../pages/PersonalLists.jsx'),
  '/feedback': () => import('../../pages/Feedback.jsx'),
};
export function createRoutePrefetch(routeLoaders) {
  const pending = new Map();
  return (href, connection) => {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')
      || connection?.saveData || ['slow-2g','2g'].includes(connection?.effectiveType)) return Promise.resolve(false);
    let url; try { url = new URL(href, 'https://render.invalid'); } catch { return Promise.resolve(false); }
    if (url.origin !== 'https://render.invalid') return Promise.resolve(false);
    const key = url.pathname === '/clientes' && url.searchParams.get('gestion') === '1' ? '/clientes?gestion=1' : url.pathname;
    if (!Object.hasOwn(routeLoaders,key)) return Promise.resolve(false);
    if (!pending.has(key)) {
      const attempt = Promise.resolve().then(routeLoaders[key]).then(()=>true,()=>{pending.delete(key);return false;});
      pending.set(key,attempt);
    }
    return pending.get(key);
  };
}
const prefetch = createRoutePrefetch(loaders);
export function prefetchRoute(href) { return prefetch(href,globalThis.navigator?.connection); }
