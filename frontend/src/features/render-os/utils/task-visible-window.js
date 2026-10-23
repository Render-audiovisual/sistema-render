const positive = value => Number.isSafeInteger(value) && value > 0;

// Presentation window over already loaded rows, never API pagination or a
// statement about the global column end. Preserve order and row identity.
export function taskVisibleWindow(items, requestedLimit = 250, step = 250) {
  const loaded = Array.isArray(items) ? items : [];
  const increment = positive(step) ? step : 250;
  const requested = positive(requestedLimit) ? requestedLimit : increment;
  const limit = Math.min(loaded.length, requested);
  const hasMore = limit < loaded.length;
  return {
    items: loaded.slice(0, limit),
    limit,
    hasMore,
    // Subtract first so even MAX_SAFE_INTEGER input cannot overflow addition.
    nextLimit: limit + Math.min(increment, loaded.length - limit),
  };
}
