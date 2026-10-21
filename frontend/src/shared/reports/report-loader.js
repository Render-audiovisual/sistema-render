import { createCapturedRequest } from '../session/captured-request.js';

// One observed report, one session and period. Aborting saves work; the captured
// binding and generation, not a successful abort, decide who may consume it.
export function createReportLoader({ session, readSession, request, isActive = () => true }) {
  let generation = 0, controller = null;
  const scope = createCapturedRequest({ session, readSession, request, isActive });
  const cancel = () => { generation++; controller?.abort(); controller = null; };
  return Object.freeze({ cancel, current: scope.current,
    async load(query) {
      cancel();
      if (!scope.current()) return null;
      const params = new URLSearchParams(query);
      const observed = generation, own = new AbortController(); controller = own;
      const current = () => generation === observed && !own.signal.aborted && scope.current();
      try {
        const data = await scope.request('/api/reportes/datos?' + params.toString(), { cache: 'no-store', signal: own.signal });
        if (!current()) return null;
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || ['tareas','tareasRenderOs','historias','publicaciones','clientes','usuarios','entregasEdicion'].some(key => !Array.isArray(data[key]))) {
          throw new Error('No se pudo verificar el reporte. Volvé a actualizar.');
        }
        return data;
      } catch (error) { if (!current()) return null; throw error; }
      finally { if (controller === own) controller = null; }
    },
  });
}
