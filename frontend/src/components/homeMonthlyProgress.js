const SECTORS = ['administracion', 'community', 'desarrollo', 'diseno', 'edicion', 'produccion', 'sin_sector'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw new Error('El avance mensual recibido no es válido.'); };

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
  return { period: value.period, total: value.total, completed: value.completed, by_sector };
}
