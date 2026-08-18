export function previousPeriod(period) {
  const [year, month] = String(period).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodBounds(period) {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

function dateOnly(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

export function calculateBillingForWorkPeriod(contracts = [], workPeriod) {
  const { start, end, days } = periodBounds(workPeriod);
  const items = contracts.flatMap((contract) => {
    const begins = dateOnly(contract.inicia_el);
    const finishes = contract.finaliza_el ? dateOnly(contract.finaliza_el) : end;
    const activeStart = begins > start ? begins : start;
    const activeEnd = finishes < end ? finishes : end;
    if (activeStart > activeEnd) return [];
    const activeDays = Math.floor((activeEnd - activeStart) / 86400000) + 1;
    const monthly = Number(contract.importe_mensual || 0);
    return [{
      nombre: contract.nombre,
      importeMensual: monthly,
      diasActivos: activeDays,
      diasDelMes: days,
      importe: Math.round((monthly * activeDays) / days),
      prorrateado: activeDays < days,
    }];
  });
  return { items, total: items.reduce((sum, item) => sum + item.importe, 0) };
}

export function calculateFixedExpenses(expenses = [], paymentPeriod) {
  const { start, end } = periodBounds(paymentPeriod);
  const items = expenses.filter((expense) => {
    const begins = dateOnly(expense.inicia_el);
    const finishes = expense.finaliza_el ? dateOnly(expense.finaliza_el) : end;
    return begins <= end && finishes >= start;
  }).map((expense) => ({
    nombre: expense.nombre,
    categoria: expense.categoria,
    moneda: expense.moneda,
    importe: Number(expense.importe || 0),
    diaPago: Number(expense.dia_pago || 1),
  }));
  const sum = (category, currency) => items
    .filter((item) => item.categoria === category && item.moneda === currency)
    .reduce((total, item) => total + item.importe, 0);
  return {
    items,
    sueldosARS: sum("sueldos", "ARS"),
    impuestosARS: sum("impuestos", "ARS"),
    herramientasARS: sum("herramientas", "ARS"),
    herramientasUSD: sum("herramientas", "USD"),
  };
}

export function buildAutomaticFinanceSummary({ period, contracts, expenses, payrollARS = 0 }) {
  const workPeriod = previousPeriod(period);
  const billing = calculateBillingForWorkPeriod(contracts, workPeriod);
  const fixed = calculateFixedExpenses(expenses, period);
  const salaries = Number(payrollARS || 0) + fixed.sueldosARS;
  return {
    period,
    workPeriod,
    facturacion: billing.total,
    sueldos: salaries,
    impuestos: fixed.impuestosARS,
    herramientasARS: fixed.herramientasARS,
    herramientasUSD: fixed.herramientasUSD,
    resultadoARS: billing.total - salaries - fixed.impuestosARS - fixed.herramientasARS,
    ingresos: billing.items,
    gastos: fixed.items,
  };
}
