// Shared editorial inputs only: task completion is never publication evidence.
export function createClientOverviewLoader(request) {
  let generation = 0;
  let controller = null;
  function cancel() {
    generation += 1;
    controller?.abort();
    controller = null;
  }
  async function load(period) {
    cancel();
    if (typeof period !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new Error("Elegí un mes válido para consultar clientes.");
    }
    const current = generation;
    const active = new AbortController();
    controller = active;
    try {
      const results = await Promise.all([
        `/api/clientes?periodo=${period}`, "/api/historias", "/api/publicaciones",
      ].map(async url => {
        const response = await request(url, { signal: active.signal });
        if (!response.ok) throw new Error("No se pudo cargar el tablero de clientes.");
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("El servidor devolvió información inválida.");
        return data;
      }));
      if (current !== generation || active.signal.aborted) return undefined;
      return { clientes: results[0], historias: results[1], publicaciones: results[2] };
    } catch {
      if (current !== generation || active.signal.aborted) return undefined;
      active.abort();
      throw new Error("No se pudo cargar el tablero de clientes. Intentá nuevamente.");
    } finally {
      if (controller === active) controller = null;
    }
  }
  return { load, cancel };
}
