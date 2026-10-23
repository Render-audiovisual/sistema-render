import { buildContextUrl } from '../shared/navigation/url-context.js';

export function personalListId(value) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id)
    && (id.length < 19 || id <= '9223372036854775807') ? id : '';
}

// null means no explicit selection; empty string is an invalid explicit link.
export function readPersonalListId(search) {
  const params = new URLSearchParams(search || '');
  if ([...params.keys()].some(key => key.startsWith('lista['))) return '';
  const values = params.getAll('lista');
  return values.length === 0 ? null : values.length === 1 ? personalListId(values[0]) : '';
}

export function personalListUrl(href, id) {
  const selected = id === null ? null : personalListId(id);
  if (selected === '') throw new Error('La página personal no es válida.');
  return buildContextUrl(href, { lista: selected });
}

// Query-only moves keep this mounted page and its ID-keyed save queue alive.
// They must never mean "discard". Reload, logout and leaving /lista do not qualify.
export function keepsPersonalListDrafts(href, context) {
  if (!context?.to || !['link', 'traverse'].includes(context.type)) return false;
  try {
    const from = new URL(href), to = new URL(context.to, from);
    return from.pathname === '/lista' && to.pathname === '/lista' && to.origin === from.origin
      && !to.username && !to.password;
  } catch { return false; }
}
