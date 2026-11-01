// Only fetch the monthly aggregate when the visible view actually uses it.
// Accounts, saved reports and individual publications have their own endpoints.
export function needsInstagramOverview({ tab, selected, error }) {
  return !error && (tab === 'equipo' || (tab === 'clientes' && !selected));
}
