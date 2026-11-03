import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_STORAGE_KEY, normalizeThemePreference, readThemePreference, resolveTheme, applyTheme, installTheme, setThemePreference, getThemePreference } from './theme.js';

function fakeWindow({ stored = null, dark = false, storageThrows = false } = {}) {
  const data = new Map(stored === null ? [] : [[THEME_STORAGE_KEY, stored]]);
  const mediaListeners = new Set();
  const media = { matches: dark, addEventListener: (_t, fn) => mediaListeners.add(fn), removeEventListener: (_t, fn) => mediaListeners.delete(fn) };
  const winListeners = new Map();
  return {
    document: { documentElement: { dataset: {}, style: {} } },
    localStorage: {
      getItem: key => { if (storageThrows) throw Error('blocked'); return data.has(key) ? data.get(key) : null; },
      setItem: (key, value) => { if (storageThrows) throw Error('blocked'); data.set(key, value); },
    },
    matchMedia: () => media,
    addEventListener: (type, fn) => winListeners.set(type, fn),
    removeEventListener: type => winListeners.delete(type),
    setSystemDark(value) { media.matches = value; mediaListeners.forEach(fn => fn()); },
    fire(type, event) { winListeners.get(type)?.(event); },
    data,
  };
}

test('preferencias inválidas vuelven a claro, que es el tema actual del sistema', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('neon'), 'light');
  assert.equal(normalizeThemePreference(null), 'light');
  assert.equal(readThemePreference({ getItem: () => { throw Error('blocked'); } }), 'light');
});

test('automático sigue al sistema operativo', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});

test('aplica data-theme y color-scheme en <html>', () => {
  const doc = { documentElement: { dataset: {}, style: {} } };
  applyTheme(doc, 'dark');
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  applyTheme(doc, 'cualquier-cosa');
  assert.equal(doc.documentElement.dataset.theme, 'light');
});

test('sin preferencia guardada arranca en claro aunque la compu esté en oscuro', () => {
  const win = fakeWindow({ dark: true });
  installTheme(win);
  assert.equal(win.document.documentElement.dataset.theme, 'light');
});

test('guarda la elección y reacciona al sistema solo en automático', () => {
  const win = fakeWindow({ dark: false });
  installTheme(win);
  setThemePreference('system', win);
  assert.equal(win.data.get(THEME_STORAGE_KEY), 'system');
  assert.equal(win.document.documentElement.dataset.theme, 'light');
  win.setSystemDark(true);
  assert.equal(win.document.documentElement.dataset.theme, 'dark');
  setThemePreference('light', win);
  win.setSystemDark(true);
  assert.equal(win.document.documentElement.dataset.theme, 'light');
});

test('otra pestaña que cambia el tema se refleja en esta', () => {
  const win = fakeWindow({ stored: 'light' });
  installTheme(win);
  win.fire('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' });
  assert.equal(win.document.documentElement.dataset.theme, 'dark');
  assert.equal(getThemePreference(), 'dark');
});

test('si el almacenamiento está bloqueado, el tema igual se aplica', () => {
  const win = fakeWindow({ storageThrows: true });
  installTheme(win);
  setThemePreference('dark', win);
  assert.equal(win.document.documentElement.dataset.theme, 'dark');
});
