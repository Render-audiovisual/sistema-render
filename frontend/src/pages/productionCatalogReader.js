// Short-lived, screen-owned reference lists. Never caches visits, writes or
// authorization decisions; the server still validates every operation.
export function createProductionCatalogReader({ now = Date.now, maxAge = 15000 } = {}) {
  const entries = new Map();
  return {
    clear() { entries.clear(); },
    async read(request, url, options) {
      const cached = entries.get(url);
      if (cached && now() - cached.at < maxAge) return cached.value;
      const value = await request(url, options);
      if (!options?.signal?.aborted && Array.isArray(value)) entries.set(url, { at: now(), value });
      return value;
    },
  };
}
