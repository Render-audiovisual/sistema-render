const SECTORS = ['administracion', 'community', 'desarrollo', 'diseno', 'edicion', 'produccion', 'sin_sector'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw new Error('El avance mensual recibido no es válido.'); };

function parseProduction(value, sectors) {
  const sector = sectors.find(row => row.sector === 'produccion');
  if (!value || !count(value.total) || !count(value.completed) || !count(value.client_count)
    || value.total !== (sector?.total || 0) || value.completed !== (sector?.completed || 0)
    || value.client_count > value.total || !Array.isArray(value.clients)
    || value.clients.length !== Math.min(20, value.client_count)) invalid();
  let total = 0, completed = 0, previous = null;
  const seen = new Set();
  const clients = value.clients.map(row => {
    const client = row?.client;
    if (!row || !(client === null || (client && Number.isSafeInteger(client.id) && client.id > 0
      && typeof client.nombre === 'string')) || !count(row.total) || row.total === 0
      || !count(row.completed) || row.completed > row.total) invalid();
    const key = client?.id ?? null;
    if (seen.has(key) || (previous && (row.total > previous.total
      || (row.total === previous.total && (key === null ? Infinity : key) <= previous.id)))) invalid();
    seen.add(key); previous = { total: row.total, id: key === null ? Infinity : key };
    total += row.total; completed += row.completed;
    if (!count(total) || !count(completed)) invalid();
    return { client: client === null ? null : { id: client.id, nombre: client.nombre }, total: row.total, completed: row.completed };
  });
  const missing = value.client_count - clients.length;
  if (total > value.total || completed > value.completed || value.total - total < missing
    || value.completed - completed > value.total - total
    || (!missing && (total !== value.total || completed !== value.completed))) invalid();
  return { total: value.total, completed: value.completed, client_count: value.client_count, clients };
}

function validToday(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Required-value parser; the caller handles an absent optional home field. */
export function parseHomeMonthlyProgress(value, today) {
  if (!validToday(today) || !value || typeof value.period !== 'string'
    || value.period !== today.slice(0, 7) || !count(value.total) || !count(value.completed)
    || value.completed > value.total || !Array.isArray(value.by_sector) || value.by_sector.length > 7) invalid();
  let total = 0, completed = 0, previous = '';
  const by_sector = value.by_sector.map(row => {
    if (!row || !SECTORS.includes(row.sector) || row.sector <= previous
      || !count(row.total) || row.total === 0 || !count(row.completed) || row.completed > row.total) invalid();
    previous = row.sector;
    total += row.total; completed += row.completed;
    if (!count(total) || !count(completed)) invalid();
    return { sector: row.sector, total: row.total, completed: row.completed };
  });
  if (total !== value.total || completed !== value.completed) invalid();
  return { period: value.period, total: value.total, completed: value.completed, by_sector,
    ...(value.production === undefined ? {} : { production: parseProduction(value.production, by_sector) }) };
}
