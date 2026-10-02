import crypto from 'node:crypto';

export const SUPERVISOR_TZ = 'America/Argentina/Buenos_Aires';
export const SUPERVISOR_WORK_WINDOWS = [[480, 780], [1020, 1290]];
const ACTIVE = new Set(['pendiente', 'en_progreso', 'en_revision', 'programada']);
export const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const isSupervisorLeader = (user) => ['admin', 'lider'].includes(user?.rol); // admin es el rol Líder existente en RENDER OS.

export function localClock(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SUPERVISOR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}

export function isSupervisorWorkTime(now = new Date()) {
  const p = localClock(now);
  return p.weekday !== 'Sun' && SUPERVISOR_WORK_WINDOWS.some(([start, end]) => p.minute >= start && p.minute < end);
}

function atLocal(date, minute) {
  return new Date(`${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00-03:00`);
}

export function nextSupervisorWorkTime(now = new Date()) {
  let date = new Date(now);
  for (let day = 0; day < 8; day++) {
    const p = localClock(date);
    if (p.weekday !== 'Sun') {
      for (const [start, end] of SUPERVISOR_WORK_WINDOWS) {
        if (p.minute < end) return date < atLocal(p.date, start) ? atLocal(p.date, start) : date;
      }
    }
    date = atLocal(new Date(Date.parse(`${p.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), 0);
  }
  throw new Error('No se encontró una franja laboral.');
}

export function addSupervisorWorkMinutes(now, minutes = 180) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 100000) throw new Error('Duración laboral inválida.');
  let cursor = nextSupervisorWorkTime(now);
  let left = minutes;
  while (left > 0) {
    const p = localClock(cursor);
    const [, end] = SUPERVISOR_WORK_WINDOWS.find(([start, stop]) => p.minute >= start && p.minute < stop);
    const available = (atLocal(p.date, end) - cursor) / 60000;
    if (left < available) return new Date(cursor.getTime() + left * 60000);
    left -= available;
    cursor = nextSupervisorWorkTime(atLocal(p.date, end));
  }
  return cursor;
}

export function supervisorTaskActive(task) {
  return task?.propiedades_extra?.workspace === 'render_os' && ACTIVE.has(task.estado)
    && task.propiedades_extra.archivada_render_os !== true && task.propiedades_extra.archivada_render_os !== 'true'
    && task.propiedades_extra.papelera_render_os !== true && task.propiedades_extra.papelera_render_os !== 'true';
}

export function taskOwnerNames(task) {
  const extra = Array.isArray(task?.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
  return [...new Set([task?.asignado_a, ...extra].map(normalize).filter(Boolean))];
}

export function userOwnsSupervisorTask(user, task) {
  const aliases = [user?.nombre, user?.usuario].map(normalize).filter(Boolean);
  if (aliases.includes('lider') && isSupervisorLeader(user)) aliases.push('agus', 'agustin', 'franco socio', 'franco altamirano');
  if (aliases.includes('luciano')) aliases.push('milton');
  if (aliases.includes('ana mayerro')) aliases.push('ana', 'ana may', 'ana nay');
  if (aliases.includes('mariano meza')) aliases.push('mariano', 'mariano mesa');
  return taskOwnerNames(task).some((name) => aliases.includes(name));
}

export function estimateTaskMinutes(task) {
  const configured = Number(task.propiedades_extra?.estimacion_horas);
  if (configured > 0 && configured <= 80) return Math.ceil(configured * 60);
  const content = normalize(`${task.titulo} ${task.subtipo} ${task.aclaraciones || ''}`);
  const count = Math.max(1, Math.min(8, Number(task.propiedades_extra?.produccion_videos_previstos) || 1));
  let base = { diseno: 180, edicion: 240, produccion: 300, community: 90, administracion: 120 }[task.tipo_tarea] || 180;
  if (/campana|lanzamiento|sucursal|identidad|animacion/.test(content)) base *= 2;
  if (task.tipo_tarea === 'produccion') base += (count - 1) * 45;
  return Math.min(960, base);
}

export function proposalSnapshot(task) {
  return fingerprint([task.id, task.titulo, task.aclaraciones, task.estado, taskOwnerNames(task), task.tarea_padre_id,
    task.publicacion_fecha_programada, task.fecha_vencimiento, task.prioridad,
    task.tipo_tarea, task.subtipo,
    task.propiedades_extra?.estimacion_horas, task.propiedades_extra?.produccion_videos_previstos]);
}

export function proposeSupervisorDeadline(task, allTasks, users, now = new Date(), ancestors = new Set()) {
  if (ancestors.has(Number(task.id))) return { fecha: null, razon: 'Dependencia circular: necesita revisión de dirección.', code: 'dependency_cycle' };
  const owners = users.filter((user) => userOwnsSupervisorTask(user, task));
  const active = allTasks.filter(supervisorTaskActive);
  const today = localClock(now).date;
  const urgent = task.prioridad === 'alta' || /\b(urgente|hoy|manana|evento)\b/.test(normalize(`${task.titulo} ${task.aclaraciones || ''}`));
  const backlogs = owners.map((user) => active.filter((other) => other.id !== task.id && userOwnsSupervisorTask(user, other)
    && other.estado !== 'programada' && other.estado !== 'en_revision'
    // Later commitments cannot make an earlier deadline look impossible.
    && (!task.fecha_vencimiento || !other.fecha_vencimiento || other.fecha_vencimiento <= task.fecha_vencimiento || other.prioridad === 'alta')
    && (!urgent || other.prioridad === 'alta' || (other.fecha_vencimiento && other.fecha_vencimiento <= today)))
    .reduce((total, other) => total + estimateTaskMinutes(other), 0));
  const workload = backlogs.length ? Math.max(...backlogs) : 0;
  const estimate = estimateTaskMinutes(task);
  let ready = nextSupervisorWorkTime(now);
  let dependency = null;
  if (task.tarea_padre_id) {
    const parent = allTasks.find((item) => Number(item.id) === Number(task.tarea_padre_id));
    if (parent && parent.estado !== 'publicada') {
      dependency = parent;
      const planned = parent.fecha_vencimiento || proposeSupervisorDeadline(parent, allTasks, users, now, new Set([...ancestors, Number(task.id)])).fecha;
      if (!planned) return { fecha: null, razon: 'No puedo estimar la dependencia de esta tarea.', code: 'dependency_cycle' };
      ready = nextSupervisorWorkTime(new Date(Math.max(ready.getTime(), atLocal(planned, 1290).getTime())));
    }
  }
  const computed = addSupervisorWorkMinutes(ready, workload + estimate);
  const feasible = localClock(computed).date;
  const publication = task.publicacion_fecha_programada;
  const conflict = Boolean(publication && feasible > publication);
  return {
    fecha: feasible, horas_estimadas: estimate / 60, horas_carga: workload / 60, responsible_ids: owners.map((u) => Number(u.id)),
    conflicto_publicacion: conflict,
    razon: `Estimación ${estimate / 60} h; carga previa máxima ${workload / 60} h entre ${owners.length || 'los'} responsables. `
      + (dependency ? `Depende de la tarea #${dependency.id}. ` : '')
      + (urgent ? 'Se priorizó por urgencia. ' : '')
      + (publication ? `Publicación prevista ${publication}${conflict ? ': la carga actual no permite llegar; conviene redistribuir o acordar otra entrega' : ''}. ` : '')
      + 'Calculado con lunes a sábado, 08–13 y 17–21:30. Confirmá o proponé una fecha alternativa.',
  };
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

const EMPTY_RESPONSE = /^(ok|okay|dale|si|no|listo|ya veo|despues|en un rato|voy viendo|lo veo|confirmo|gracias|trabajando)$/;
const STATUS_WORDS = {
  pendiente: /\b(pendiente|no empece|sin empezar)\b/,
  en_progreso: /\b(en progreso|en proceso|avance|avanzando|editando|disenando|trabajando|inicie)\b/,
  bloqueada: /\b(bloquead[oa]|falta|esperando|no puedo)\b/,
  lista_para_revision: /\b(termin[ea]|terminad[oa]|list[oa] para revis|revision)\b/,
};

export function validateSupervisorReport(input, task, now = new Date()) {
  const text = typeof input.texto === 'string' ? input.texto.trim() : '';
  const reason = typeof input.motivo === 'string' ? input.motivo.trim() : '';
  const state = input.estado;
  const date = input.nueva_fecha || null;
  const errors = [];
  if (text.length < 12 || text.length > 6000 || EMPTY_RESPONSE.test(normalize(text))) errors.push('Necesito una actualización completa: estado, motivo y nueva fecha si se posterga.');
  if (!STATUS_WORDS[state]?.test(normalize(text))) errors.push('Indicá el estado real dentro del mensaje.');
  if (reason.length < 8 || EMPTY_RESPONSE.test(normalize(reason)) || !normalize(text).includes(normalize(reason))) errors.push('Explicá el motivo de la demora o qué está bloqueando, con información concreta.');
  const postponed = state !== 'lista_para_revision' && (!task.fecha_vencimiento || task.fecha_vencimiento < localClock(now).date);
  if ((postponed || date) && (!validDate(date) || date < localClock(now).date)) errors.push('Necesito una nueva fecha válida, desde hoy en adelante.');
  if (date) {
    const [, month, day] = String(date).split('-');
    const evidence = String(input.fecha_texto || '');
    const literal = evidence === date || evidence === `${day}/${month}/${date.slice(0,4)}` || evidence === `${Number(day)}/${Number(month)}/${date.slice(0,4)}`;
    const relative = normalize(evidence) === 'hoy' ? localClock(now).date === date
      : normalize(evidence) === 'manana' && new Date(Date.parse(`${localClock(now).date}T12:00:00Z`) + 86400000).toISOString().slice(0,10) === date;
    if ((!literal && !relative) || !normalize(text).includes(normalize(evidence)) || !evidence) errors.push('La fecha debe estar expresada en el mensaje original; no la inventes.');
  }
  const blocker = input.bloqueo_usuario_id === undefined || input.bloqueo_usuario_id === null ? null : Number(input.bloqueo_usuario_id);
  if (blocker !== null && (!Number.isInteger(blocker) || blocker <= 0 || state !== 'bloqueada')) errors.push('La persona que puede destrabar el bloqueo no es válida.');
  return { valid: !errors.length, errors, report: { texto: text, estado: state, motivo: reason, nueva_fecha: date, bloqueo_usuario_id: blocker } };
}

export function detectSupervisorSignals(tasks, users, replies = [], now = new Date()) {
  const active = tasks.filter(supervisorTaskActive);
  const today = localClock(now).date;
  const signals = [];
  for (const user of users) {
    const owned = active.filter((task) => userOwnsSupervisorTask(user, task));
    const overdue = owned.filter((task) => task.fecha_vencimiento && task.fecha_vencimiento < today);
    if (overdue.length >= 4) signals.push({ tipo: 'saturacion', task_ids: overdue.map((t) => Number(t.id)),
      problema: `${user.nombre}: ${overdue.length} tareas vencidas.`, causa: 'Posible carga superior a la capacidad; requiere validar bloqueos.', accion: 'Reordenar prioridades y redistribuir trabajo con la persona.', user_id: Number(user.id) });
    const delays = replies.filter((reply) => Number(reply.usuario_id) === Number(user.id) && reply.reporte?.nueva_fecha
      && Date.parse(reply.created_at) >= new Date(now).getTime() - 14 * 86400000);
    if (new Set(delays.map((r) => r.tarea_id)).size >= 3) signals.push({ tipo: 'demoras_repetidas', task_ids: [...new Set(delays.map((r) => Number(r.tarea_id)))],
      problema: `${user.nombre}: reprogramó tres o más tareas en las últimas dos semanas.`, causa: 'Posibles estimaciones poco realistas o dependencia recurrente.', accion: 'Revisar estimaciones y motivos antes de asignar nuevos compromisos.', user_id: Number(user.id) });
  }
  for (const parent of active) {
    const children = active.filter((task) => Number(task.tarea_padre_id) === Number(parent.id));
    if (children.length >= 3) signals.push({ tipo: 'dependencia', task_ids: [Number(parent.id), ...children.map((t) => Number(t.id))],
      problema: `La tarea #${parent.id} condiciona ${children.length} tareas.`, causa: 'Una dependencia concentra el avance del equipo.', accion: 'Priorizar el material de origen y contactar a sus responsables.' });
  }
  for (const task of active.filter((item) => item.fecha_vencimiento && item.fecha_vencimiento >= today)) {
    const plan = proposeSupervisorDeadline(task,tasks,users,now);
    if (plan.fecha && plan.fecha > task.fecha_vencimiento) signals.push({ tipo:'fecha_irreal',task_ids:[Number(task.id)],
      problema:`La carga o dependencia de la tarea #${task.id} supera su plazo ${task.fecha_vencimiento}.`,
      causa:plan.razon,accion:'Validar la estimación con los responsables y redistribuir o acordar un plazo viable.' });
  }
  return signals.map((signal) => ({ ...signal, fingerprint: fingerprint([signal.tipo, signal.user_id || null, [...signal.task_ids].sort((a,b) => a-b)]) }));
}
