import { EDITORIAL_BUCKETS, EDITORIAL_LIMIT } from './homeEditorialControl.js';

const defaults = () => ({ bucket: 'today', offset: 0 });
const invalid = () => { throw new Error('La vista editorial no es válida.'); };
const validOffset = offset => Number.isSafeInteger(offset) && offset >= 0
  && offset <= 1000000 && offset % EDITORIAL_LIMIT === 0;

export function normalizeEditorialView(selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || !EDITORIAL_BUCKETS.some(item => item.value === selection.bucket) || !validOffset(selection.offset)) invalid();
  return { bucket: selection.bucket, offset: selection.offset };
}

export function readEditorialLocation(search = '') {
  if (typeof search !== 'string') invalid();
  const params = new URLSearchParams(search);
  const views = params.getAll('editorial_view'), pages = params.getAll('editorial_page');
  if (!views.length && !pages.length) return null;
  if (views.length !== 1 || pages.length > 1) invalid();
  const raw = pages.length ? pages[0] : '0';
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw) || String(Number(raw)) !== raw) invalid();
  return normalizeEditorialView({ bucket: views[0], offset: Number(raw) });
}

export function editorialViewStorageKey(userId) {
  return Number.isSafeInteger(userId) && userId > 0 && userId <= 2147483647
    ? `render2:editorial-view:v1:${userId}` : null;
}

export function loadEditorialView(storage, userId) {
  const key = editorialViewStorageKey(userId);
  if (key === null) return defaults();
  try {
    const value = JSON.parse(storage.getItem(key));
    if (!value || value.version !== 1) return defaults();
    return normalizeEditorialView(value);
  } catch { return defaults(); }
}

export function saveEditorialView(storage, userId, selection) {
  const closed = normalizeEditorialView(selection);
  const key = editorialViewStorageKey(userId);
  if (key === null) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, ...closed }));
    return true;
  } catch { return false; }
}

export function editorialViewUrl(currentUrl, selection) {
  const closed = normalizeEditorialView(selection);
  if (typeof currentUrl !== 'string' || /[\u0000-\u0020\u007f\\]/.test(currentUrl)) invalid();
  const url = new URL(currentUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/inicio') invalid();
  url.searchParams.set('editorial_view', closed.bucket);
  url.searchParams.set('editorial_page', String(closed.offset));
  return url;
}
