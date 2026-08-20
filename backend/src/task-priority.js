const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function dayDistance(value, today) {
  const date = dateOnly(value);
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

function ageInDays(value, today) {
  const date = dateOnly(value);
  if (!date) return 0;
  return Math.max(0, -dayDistance(date, today));
}

function priorityLabel(score) {
  if (score >= 100) return { level: "P0", label: "Crítica" };
  if (score >= 70) return { level: "P1", label: "Urgente" };
  if (score >= 40) return { level: "P2", label: "Importante" };
  if (score >= 20) return { level: "P3", label: "Normal" };
  return { level: "P4", label: "Puede esperar" };
}

function dueReason(days) {
  if (days < 0) return `Venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? "día" : "días"}`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} días`;
}

export function scoreTaskPriority(task, { today }) {
  const dueDate = dateOnly(task.publicacion_fecha_programada || task.fecha_vencimiento);
  const dueDays = dayDistance(dueDate, today);
  const createdDays = ageInDays(task.created_at, today);
  const staleDays = ageInDays(task.updated_at, today);
  const reasons = [];
  let score = 0;

  if (dueDays !== null) {
    if (dueDays < 0) score += 100;
    else if (dueDays === 0) score += 80;
    else if (dueDays === 1) score += 60;
    else if (dueDays <= 2) score += 45;
    else if (dueDays <= 7) score += 20;
    if (dueDays <= 7) reasons.push(dueReason(dueDays));
  } else {
    reasons.push("No tiene fecha definida");
  }

  if (task.prioridad === "alta") { score += 20; reasons.push("Prioridad manual alta"); }
  else if (task.prioridad === "media") score += 8;

  if (task.estado === "en_progreso") { score += 12; reasons.push("Ya está en proceso"); }
  else if (task.estado === "pendiente") score += 8;

  if (createdDays >= 2 && task.estado === "pendiente") {
    score += Math.min(20, createdDays * 3);
    reasons.push(`Lleva ${createdDays} días pendiente`);
  }
  if (staleDays >= 3 && task.estado !== "en_revision") {
    score += Math.min(15, staleDays * 2);
    reasons.push(`Sin movimiento hace ${staleDays} días`);
  }

  const waitingReview = task.estado === "en_revision";
  if (waitingReview) {
    score = Math.max(0, score - 30);
    reasons.unshift("Está esperando revisión");
  }

  const blocked = task.propiedades_extra?.bloqueada === true;
  if (blocked) {
    score = Math.max(0, score - 50);
    reasons.unshift(task.propiedades_extra?.motivo_bloqueo
      ? `Bloqueada: ${task.propiedades_extra.motivo_bloqueo}`
      : "Está bloqueada");
  }

  const riskTomorrow = !blocked && !waitingReview && dueDays !== null && dueDays >= 1 && dueDays <= 2
    && task.estado === "pendiente";
  const classification = priorityLabel(score);
  return {
    ...task,
    dynamic_priority: classification.level,
    dynamic_priority_label: classification.label,
    priority_score: score,
    priority_reasons: reasons.slice(0, 3),
    due_days: dueDays,
    risk_tomorrow: riskTomorrow,
    waiting_review: waitingReview,
    blocked,
  };
}

export function rankTaskPriorities(tasks, { today, limit = 8 } = {}) {
  const validToday = dateOnly(today) || new Date().toISOString().slice(0, 10);
  const ranked = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task.estado !== "publicada")
    .filter((task) => task.propiedades_extra?.papelera_render_os !== true)
    .filter((task) => task.propiedades_extra?.archivada_render_os !== true)
    .map((task) => scoreTaskPriority(task, { today: validToday }))
    .sort((left, right) => {
      if (left.blocked !== right.blocked) return left.blocked ? 1 : -1;
      if (left.waiting_review !== right.waiting_review) return left.waiting_review ? 1 : -1;
      const group = (task) => {
        if (task.due_days === 0 && task.prioridad === "alta") return 0;
        if (task.due_days < 0 && task.prioridad === "alta") return 1;
        if (task.due_days < 0) return 2;
        if (task.due_days === 0) return 3;
        if (task.prioridad === "alta") return 4;
        if (task.due_days !== null) return 5;
        return 6;
      };
      const groupDifference = group(left) - group(right);
      if (groupDifference) return groupDifference;
      if (left.due_days < 0 && right.due_days < 0) {
        const leftCreated = Date.parse(left.created_at || 0) || 0;
        const rightCreated = Date.parse(right.created_at || 0) || 0;
        if (leftCreated !== rightCreated) return leftCreated - rightCreated;
      }
      if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
      if (left.due_days !== right.due_days) return (left.due_days ?? Infinity) - (right.due_days ?? Infinity);
      return Number(left.id) - Number(right.id);
    });
  return {
    recommendations: ranked.slice(0, Math.max(1, limit)),
    summary: {
      total: ranked.length,
      critical: ranked.filter((task) => !task.blocked && !task.waiting_review && ["P0", "P1"].includes(task.dynamic_priority)).length,
      overdue: ranked.filter((task) => task.due_days !== null && task.due_days < 0).length,
      today: ranked.filter((task) => task.due_days === 0).length,
      risk_tomorrow: ranked.filter((task) => task.risk_tomorrow).length,
      waiting_review: ranked.filter((task) => task.waiting_review).length,
      blocked: ranked.filter((task) => task.blocked).length,
    },
  };
}
