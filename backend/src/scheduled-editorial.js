// Preserve the existing editorial rules without starting the web or a timer.
export async function runScheduledEditorial(pool, {now = new Date(), calendar, goals} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Fecha inválida');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({type, value}) => [type, value]));
  const period = `${parts.year}-${parts.month}`;
  const prepareCalendar = calendar ?? (await import('./editorial-calendar.js')).reconcileEditorialCalendar;
  const prepareGoals = goals ?? (await import('./client-goals.js')).reconcileMonthlyGoals;
  await prepareCalendar(pool, period);
  await prepareGoals(pool, period);
  if (Number(parts.day) >= 28) {
    const next = new Date(Date.UTC(Number(parts.year), Number(parts.month), 1));
    await prepareCalendar(pool, `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  }
}
