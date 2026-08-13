import { normalizePerson } from "./salary-calculation.js";

export function nextPeriod(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ""))) throw new Error("Período inválido.");
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function employeeKey(value) {
  const normalized = normalizePerson(value);
  if (normalized.includes("german")) return "german";
  if (normalized.includes("luciano") || normalized.includes("milton")) return "luciano";
  return ["oriana", "augusto", "mariano"].find((key) => normalized.includes(key)) || normalized;
}

export function applyCompensations(dashboard, configurations = [], finalPayments = []) {
  const configs = new Map(configurations.map((item) => [item.empleado_clave, item]));
  const payments = new Map(finalPayments.map((item) => [item.empleado_clave, Number(item.importe_final)]));
  const employees = dashboard.employees.map((employee) => {
    const key = employeeKey(employee.name);
    const config = configs.get(key);
    let total = employee.total;
    let earned = employee.earned;
    let configurationPending = employee.configurationPending;
    if (config?.modalidad === "mensual") {
      total = Number(config.sueldo_base || 0);
      earned = Math.round(total * (employee.percentage / 100));
      configurationPending = false;
    } else if (config?.modalidad === "por_pieza") {
      const easy = employee.items.filter((item) => item.complete && item.difficulty === "facil").length;
      const intermediate = employee.items.filter((item) => item.complete && item.difficulty === "intermedio").length;
      const unclassified = employee.completed - easy - intermediate;
      earned = easy * Number(config.tarifa_facil || 0) + intermediate * Number(config.tarifa_intermedia || 0);
      total = earned;
      configurationPending = unclassified > 0;
    }
    const finalPayment = payments.has(key) ? payments.get(key) : null;
    return { ...employee, key, total, earned, remainingAmount: total == null || earned == null ? null : Math.max(total - earned, 0), configurationPending, finalPayment, payable: finalPayment ?? earned };
  });
  const estimatedPayroll = employees.reduce((sum, item) => sum + Number(item.earned || 0), 0);
  const payablePayroll = employees.reduce((sum, item) => sum + Number(item.payable || 0), 0);
  return {
    ...dashboard,
    employees,
    summary: {
      ...dashboard.summary,
      configuredPayroll: employees.reduce((sum, item) => sum + Number(item.total || 0), 0),
      earned: estimatedPayroll,
      remaining: employees.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0),
      pendingConfigurations: employees.filter((item) => item.configurationPending).map((item) => item.name),
      payablePayroll,
    },
  };
}
