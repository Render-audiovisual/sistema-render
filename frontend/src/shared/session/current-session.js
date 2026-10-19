// These DTO checks are not authentication. Only the server establishes identity.
export function parseServerIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const validId = (Number.isSafeInteger(value.id) && value.id > 0)
    || (typeof value.id === "string" && value.id.trim().length > 0);
  if (!validId || !["usuario", "nombre", "rol"].every(
    (key) => typeof value[key] === "string" && value[key].trim().length > 0,
  )) return null;
  // Preserve exact server fields, including ID type; never infer name or role.
  return { ...value };
}

export function parseCurrentSession(raw) {
  try {
    const value = JSON.parse(raw);
    const usuario = parseServerIdentity(value?.usuario);
    if (!usuario || typeof value.token !== "string" || !value.token.trim()) return null;
    return { token: value.token, usuario };
  } catch { return null; }
}

export const LOGOUT_FAILURE_MESSAGE = "Se cerrará la sesión local, pero no se pudo confirmar la revocación de las sesiones de esta cuenta en el servidor. Si estás sin conexión, volvé a conectarte e iniciá sesión para reintentar el cierre.";

// Injected transport: no storage, network or browser globals at import time.
export async function transportLogout({ token, fetchImpl, timeoutMs = 5000 }) {
  if (typeof token !== "string" || !token.trim()) return { revoked: false, reason: "missing_token" };
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30000) : 5000;
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl("/api/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          redirect: "error",
          cache: "no-store",
        });
        if (!response.ok) return { revoked: false, reason: "http", status: response.status };
        const body = await response.json();
        return body?.ok === true
          ? { revoked: true }
          : { revoked: false, reason: "unconfirmed" };
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ revoked: false, reason: "timeout" });
        }, duration);
      }),
    ]);
  } catch { return { revoked: false, reason: "transport" }; }
  finally { clearTimeout(timer); }
}

// Never reject on expected transport failure: existing event callers need not await.
// Server logout revokes the whole account, not separate real-person accounts.
export async function logoutCurrentSession({ clear, reportFailure, navigate, ...transport }) {
  const result = await transportLogout(transport);
  try {
    if (!result.revoked) reportFailure(LOGOUT_FAILURE_MESSAGE);
  } finally {
    clear();
    navigate();
  }
  return result;
}
