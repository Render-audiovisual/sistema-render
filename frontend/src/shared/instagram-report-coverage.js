// A report without any observed client cannot establish publication results.
// Zero publications remains valid when the report actually covers clients.
export function hasWeeklyReportCoverage(report) {
  return Array.isArray(report?.hechos?.clientes) && report.hechos.clientes.length > 0;
}
