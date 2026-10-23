// Scheduled agenda only. Publication evidence and monthly goal achievement
// have separate contracts; neither task state nor actual publication date is
// interpreted here. Caller supplies the visible type-filtered cohort.
function day(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
export function publicationCalendarSummary(pieces, { month, today } = {}) {
  const result = { scheduledMonth: [], today: [], tomorrow: [], nextSevenDays: [] };
  const todayTime = day(today);
  const monthValid = typeof month === 'string' && day(`${month}-01`) !== null;
  const seen = new Set();
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    if (!piece || !Number.isSafeInteger(piece.id) || piece.id <= 0 || seen.has(piece.id)) continue;
    const date = piece.fecha_programada, time = day(date);
    if (time === null) continue;
    seen.add(piece.id);
    if (monthValid && date.slice(0, 7) === month) result.scheduledMonth.push(piece);
    if (todayTime === null) continue;
    const distance = (time - todayTime) / 86400000;
    if (distance === 0) result.today.push(piece);
    if (distance === 1) result.tomorrow.push(piece);
    if (distance >= 0 && distance < 7) result.nextSevenDays.push(piece);
  }
  return result;
}
