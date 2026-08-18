const CARD_DOLLAR_URL = "https://dolarapi.com/v1/dolares/tarjeta";
const CACHE_MS = 60 * 60 * 1000;
let cached = null;

export function roundExchangeRateUp(value, step = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("Cotización inválida.");
  return Math.ceil(numeric / step) * step;
}

export async function getCardDollarRate(fetchImpl = globalThis.fetch) {
  if (cached && Date.now() - cached.cachedAt < CACHE_MS) return cached.value;
  try {
    const response = await fetchImpl(CARD_DOLLAR_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Cotización no disponible (${response.status}).`);
    const payload = await response.json();
    const original = Number(payload.venta);
    const value = {
      original,
      rounded: roundExchangeRateUp(original),
      updatedAt: payload.fechaActualizacion || new Date().toISOString(),
      source: "DolarApi · dólar tarjeta vendedor",
      fallback: false,
    };
    cached = { cachedAt: Date.now(), value };
    return value;
  } catch {
    const original = Number(process.env.USD_ARS_FALLBACK_RATE || 2000);
    return {
      original,
      rounded: roundExchangeRateUp(original),
      updatedAt: null,
      source: "Cotización de respaldo",
      fallback: true,
    };
  }
}
