// Tema visual por persona y por navegador. Solo guarda una preferencia de
// interfaz ("light" | "dark" | "system"); nunca datos de sesión.
export const THEME_STORAGE_KEY = 'render-theme';
export const THEME_PREFERENCES = Object.freeze(['light', 'dark', 'system']);
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : 'light';
}

export function readThemePreference(storage) {
  try { return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY)); }
  catch { return 'light'; }
}

export function resolveTheme(preference, prefersDark = false) {
  const value = normalizeThemePreference(preference);
  if (value === 'system') return prefersDark ? 'dark' : 'light';
  return value;
}

export function applyTheme(documentRef, theme) {
  const root = documentRef?.documentElement;
  if (!root) return;
  const value = theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = value;
  root.style.colorScheme = value;
}

function systemPrefersDark(win) {
  try { return Boolean(win?.matchMedia?.(DARK_QUERY).matches); }
  catch { return false; }
}

const listeners = new Set();
let current = 'light';

export function getThemePreference() { return current; }

export function setThemePreference(preference, win = globalThis.window) {
  current = normalizeThemePreference(preference);
  try { win?.localStorage?.setItem(THEME_STORAGE_KEY, current); } catch { /* el tema igual se aplica en esta pestaña */ }
  applyTheme(win?.document, resolveTheme(current, systemPrefersDark(win)));
  listeners.forEach(listener => listener(current));
}

export function subscribeThemePreference(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Aplica la preferencia guardada antes del primer render y sigue los cambios
// del sistema operativo cuando la persona eligió "Automático".
export function installTheme(win = globalThis.window) {
  if (!win?.document) return () => {};
  current = readThemePreference(win.localStorage);
  applyTheme(win.document, resolveTheme(current, systemPrefersDark(win)));
  let media;
  try { media = win.matchMedia?.(DARK_QUERY); } catch { media = undefined; }
  const onSystemChange = () => { if (current === 'system') applyTheme(win.document, resolveTheme('system', systemPrefersDark(win))); };
  media?.addEventListener?.('change', onSystemChange);
  const onStorage = event => {
    if (event.key !== THEME_STORAGE_KEY) return;
    current = normalizeThemePreference(event.newValue);
    applyTheme(win.document, resolveTheme(current, systemPrefersDark(win)));
    listeners.forEach(listener => listener(current));
  };
  win.addEventListener?.('storage', onStorage);
  return () => { media?.removeEventListener?.('change', onSystemChange); win.removeEventListener?.('storage', onStorage); };
}
