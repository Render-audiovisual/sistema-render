const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const validPeriod = value => typeof value === 'string' && value.length === 7 && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const invalid = () => { throw new Error('Cliente inválido. Elegí un cliente válido desde el listado.'); };

export function parseGoalClientId(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => key.startsWith('cliente['))) invalid();
  const ids = params.getAll('cliente');
  if (!ids.length) return null;
  if (ids.length !== 1 || !/^[1-9][0-9]*$/.test(ids[0]) || !positiveId(Number(ids[0])) || String(Number(ids[0])) !== ids[0]) invalid();
  return Number(ids[0]);
}

export function goalClientHref(id, period) {
  return positiveId(id) && validPeriod(period) ? `/clientes?cliente=${id}&periodo=${period}` : null;
}

export function goalClientLocationUrl(currentUrl, { clientId, period }) {
  const url = new URL(currentUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/clientes' || url.username || url.password
    || !validPeriod(period) || (clientId != null && !positiveId(clientId))) invalid();
  for (const key of [...url.searchParams.keys()]) {
    if (key === 'cliente' || key === 'periodo' || key.startsWith('cliente[') || key.startsWith('periodo[')) url.searchParams.delete(key);
  }
  if (clientId != null) url.searchParams.set('cliente', String(clientId));
  url.searchParams.set('periodo', period);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveGoalClient(clients, clientId, fallbackKey) {
  const rows = Array.isArray(clients) ? clients : [];
  if (clientId == null) return rows.find(item => item.clave === fallbackKey) || rows[0] || null;
  if (!positiveId(clientId)) return null;
  const matching = rows.filter(item => Array.isArray(item.cuentas) && item.cuentas.some(account => account.id === clientId));
  return matching.find(item => item.clave === fallbackKey) || matching[0] || null;
}
