const PAGE_SIZE = 500;
const MAX_TOTAL = 100000;
const MAX_TASK_ID = 2147483647;

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('La carga de tareas fue cancelada.', 'AbortError');
}

function taskUrl(value) {
  // Literal local endpoint only: no origin, normalized/encoded path guessing,
  // fragment or browser-tolerated control/backslash normalization.
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\#]/.test(value)
    || value.split('?', 1)[0] !== '/api/tareas') {
    throw new Error('La URL de tareas debe ser local y usar exactamente /api/tareas.');
  }
  const parsed = new URL(value, 'https://render.invalid');
  parsed.searchParams.set('limit', String(PAGE_SIZE));
  parsed.searchParams.set('offset', '0');
  return parsed;
}

function totalCount(response) {
  const raw = response.headers?.get('X-Total-Count');
  if (typeof raw !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error('Falta un total de tareas válido en X-Total-Count.');
  }
  const total = Number(raw);
  if (!Number.isSafeInteger(total) || String(total) !== raw) throw new Error('El total de tareas no es válido.');
  if (total > MAX_TOTAL) throw new Error('La consulta supera las 100000 tareas; acotá los filtros antes de cargarla.');
  return total;
}

/** Legacy array adapter: publishes only a complete, validated set of task pages. */
export async function fetchAllTaskPages(url, { signal, request = fetch } = {}) {
  const parsed = taskUrl(url);
  const collected = [], ids = new Set();
  let expectedTotal;
  for (let offset = 0; offset < MAX_TOTAL; offset += PAGE_SIZE) {
    checkAbort(signal);
    parsed.searchParams.set('offset', String(offset));
    const response = await request(`${parsed.pathname}${parsed.search}`, { method: 'GET', signal });
    checkAbort(signal);
    if (!response?.ok) throw new Error('No se pudieron cargar todas las tareas.');
    const total = totalCount(response);
    if (expectedTotal === undefined) expectedTotal = total;
    else if (total !== expectedTotal) throw new Error('El total de tareas cambió durante la carga. Reintentá.');
    const page = await response.json();
    checkAbort(signal);
    if (!Array.isArray(page) || page.length !== Math.min(PAGE_SIZE, expectedTotal - offset)) {
      throw new Error('La página de tareas está incompleta o no es válida.');
    }
    for (const task of page) {
      if (!task || typeof task !== 'object' || Array.isArray(task)
        || !Number.isSafeInteger(task.id) || task.id <= 0 || task.id > MAX_TASK_ID || ids.has(task.id)) {
        throw new Error('La carga contiene identificadores de tarea inválidos o duplicados.');
      }
      ids.add(task.id);
      collected.push(task);
    }
    if (collected.length === expectedTotal) {
      checkAbort(signal);
      return collected;
    }
  }
  throw new Error('No se pudo completar la carga de tareas dentro del límite permitido.');
}
