import { setTimeout as delay } from "node:timers/promises";

export function isDatabaseConnectionError(error) {
  return new Set([
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
    "EPIPE", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08006",
  ]).has(error?.code) || /connection (terminated|ended)|connection timeout|timeout exceeded when trying to connect/i.test(error?.message || "");
}

// Solo reintenta la preparación idempotente del servicio. Nunca reenvía
// escrituras HTTP: esas conservan su confirmación y clave de idempotencia.
export async function initializeWithRetry({ initialize, onReady, onError, sleep = delay }) {
  let attempts = 0;
  for (;;) {
    try {
      await initialize();
    } catch (error) {
      const delayMs = Math.min(5000 * 2 ** Math.min(attempts++, 4), 60000);
      onError(error, delayMs);
      await sleep(delayMs);
      continue;
    }
    await onReady();
    return;
  }
}
