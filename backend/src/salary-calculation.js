const FINAL_STATES = new Set(["publicada", "publicado", "terminada", "terminado", "completada", "completado"]);

export const SALARY_RULES = Object.freeze({
  oriana: { name: "Oriana", role: "Community", model: "fixed", baseSalary: 350000, targetMode: "assigned" },
  augusto: { name: "Augusto", role: "Diseño", model: "fixed", baseSalary: 500000, targetMode: "fixed", target: 10 },
  mariano: { name: "Mariano Mesa", role: "Diseño", model: "fixed", baseSalary: 600000, targetMode: "assigned" },
  luciano: { name: "Luciano", role: "Edición", model: "per_unit", unitRate: null, targetMode: "assigned" },
  german: { name: "Germán", role: "Producción", model: "fixed", baseSalary: 650000, targetMode: "assigned" },
});

export function normalizePerson(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function isValidSalaryPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function belongsTo(value, aliases) {
  const normalized = normalizePerson(value);
  return aliases.some((alias) => normalized.includes(alias));
}

function inPeriod(value, period) {
  return typeof value === "string" && value.slice(0, 7) === period;
}

function isComplete(item) {
  return FINAL_STATES.has(normalizePerson(item.estado));
}

function taskDate(task) {
  return task.fecha_vencimiento || task.propiedades_extra?.reporte_periodo || task.updated_at || task.created_at || null;
}

function taskMatchesPeriod(task, period) {
  return task.propiedades_extra?.reporte_periodo === period || inPeriod(task.fecha_vencimiento, period) || inPeriod(taskDate(task), period);
}

function taskText(task) {
  return normalizePerson([task.tipo_tarea, task.subtipo, task.titulo, task.propiedades_extra?.resumen].filter(Boolean).join(" "));
}

function taskItem(task) {
  return {
    key: `tarea-${task.id}`,
    id: task.id,
    source: "Tareas",
    title: task.titulo || "Tarea sin título",
    client: task.cliente_nombre || "Sin cliente",
    date: taskDate(task),
    state: task.estado,
    complete: isComplete(task),
    difficulty: normalizePerson(task.propiedades_extra?.dificultad || ""),
  };
}

function pieceItem(piece, source) {
  return {
    key: `${source.toLowerCase()}-${piece.id}`,
    id: piece.id,
    source,
    title: piece.idea || piece.copy || `${source.slice(0, -1)} #${piece.id}`,
    client: piece.cliente_nombre || "Sin cliente",
    date: piece.fecha_programada,
    completedAt: piece.fecha_publicación_real || piece.updated_at || null,
    state: piece.estado,
    complete: isComplete(piece),
  };
}

function preferImportedReportTasks(tasks, period) {
  const imported = tasks.filter((task) => task.propiedades_extra?.reporte_fuente === "clickup" && task.propiedades_extra?.reporte_periodo === period);
  return imported.length ? imported : tasks.filter((task) => taskMatchesPeriod(task, period));
}

function uniqueItems(items) {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

function buildProgress(items, period) {
  const [, month] = period.split("-").map(Number);
  const year = Number(period.slice(0, 4));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let cumulative = 0;
  const completedByDay = new Map();
  for (const item of items.filter((entry) => entry.complete)) {
    const value = item.completedAt || item.date;
    if (!inPeriod(value, period)) continue;
    const day = Number(value.slice(8, 10));
    completedByDay.set(day, (completedByDay.get(day) || 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    cumulative += completedByDay.get(index + 1) || 0;
    return { day: index + 1, completed: cumulative };
  });
}

function summarize(rule, items, period) {
  const completed = items.filter((item) => item.complete).length;
  const target = rule.targetMode === "fixed" ? rule.target : items.length;
  const ratio = target > 0 ? Math.min(completed / target, 1) : 0;
  const percentage = Math.round(ratio * 100);
  const earned = rule.model === "fixed" ? Math.round(rule.baseSalary * ratio) : rule.unitRate == null ? null : completed * rule.unitRate;
  const total = rule.model === "fixed" ? rule.baseSalary : rule.unitRate == null ? null : completed * rule.unitRate;
  return {
    ...rule,
    target,
    completed,
    remainingUnits: Math.max(target - completed, 0),
    percentage,
    earned,
    total,
    remainingAmount: total == null || earned == null ? null : Math.max(total - earned, 0),
    configurationPending: rule.model === "per_unit" && rule.unitRate == null,
    items,
    dailyProgress: buildProgress(items, period),
  };
}

export function calculateSalaryDashboard({ period, tasks = [], histories = [], publications = [] }) {
  if (!isValidSalaryPeriod(period)) throw new Error("Período salarial inválido.");
  const monthlyTasks = preferImportedReportTasks(tasks, period);
  const taskItemsFor = (aliases, predicate) => uniqueItems(monthlyTasks
    .filter((task) => belongsTo(task.asignado_a, aliases) && predicate(taskText(task), task))
    .map(taskItem));

  const orianaItems = uniqueItems([
    ...histories.filter((item) => inPeriod(item.fecha_programada, period)).map((item) => pieceItem(item, "Historias")),
    ...publications.filter((item) => inPeriod(item.fecha_programada, period)).map((item) => pieceItem(item, "Publicaciones")),
  ]);
  const augustoItems = taskItemsFor(["augusto"], (text) => text.includes("carrusel"));
  const marianoItems = taskItemsFor(["mariano", "mariano meza"], (text, task) => task.tipo_tarea === "diseno" || /disen|flyer|carrusel/.test(text));
  const lucianoItems = taskItemsFor(["luciano"], (text, task) => task.tipo_tarea === "edicion" || /edit|video|reel/.test(text));
  const germanItems = taskItemsFor(["german"], (text, task) => task.tipo_tarea === "produccion" || /film|graba|video|reel/.test(text));

  const employees = [
    summarize(SALARY_RULES.oriana, orianaItems, period),
    summarize(SALARY_RULES.augusto, augustoItems, period),
    summarize(SALARY_RULES.mariano, marianoItems, period),
    summarize(SALARY_RULES.luciano, lucianoItems, period),
    summarize(SALARY_RULES.german, germanItems, period),
  ];
  const calculable = employees.filter((employee) => employee.earned != null);
  return {
    period,
    generatedAt: new Date().toISOString(),
    employees,
    summary: {
      configuredPayroll: calculable.reduce((sum, employee) => sum + (employee.total || 0), 0),
      earned: calculable.reduce((sum, employee) => sum + employee.earned, 0),
      remaining: calculable.reduce((sum, employee) => sum + (employee.remainingAmount || 0), 0),
      averageProgress: calculable.length ? Math.round(calculable.reduce((sum, employee) => sum + employee.percentage, 0) / calculable.length) : 0,
      pendingConfigurations: employees.filter((employee) => employee.configurationPending).map((employee) => employee.name),
    },
    notes: [
      "Los importes son una referencia operativa, no una liquidación contable.",
      "El avance diario usa la mejor fecha disponible; tareas antiguas sin fecha de cierre pueden verse en el día de vencimiento.",
    ],
  };
}
