// Document-lifetime presentation state only; never persists or authorizes writes.
const int32 = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const periodValid = value => typeof value === 'string' && value.length === 7 && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const textValid = (value, limit) => typeof value === 'string' && value.length <= limit;
const identityValid = draft => draft && int32(draft.pieceId) && int32(draft.taskId)
  && int32(draft.clientId) && periodValid(draft.period);
const sameIdentity = (a, b) => ['pieceId', 'taskId', 'clientId', 'period'].every(key => a[key] === b[key]);
function capture(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const { pieceId, taskId, clientId, period, title, copy, baseline, taskVersion, taskRevision, status = 'editing' } = input;
    const draft = { pieceId, taskId, clientId, period, title, copy, baseline, taskVersion, taskRevision, status };
    if (!identityValid(draft) || !textValid(title, 500) || !textValid(copy, 20000)
      || typeof baseline !== 'string' || typeof taskVersion !== 'string' || !Number.isFinite(Date.parse(taskVersion))
      || !Number.isSafeInteger(taskRevision) || taskRevision < 1 || !['editing', 'saving', 'uncertain'].includes(status)) return null;
    const initial = JSON.parse(baseline);
    if (!initial || Array.isArray(initial) || !textValid(initial.title, 500) || !initial.title.trim()
      || !textValid(initial.copy, 20000)) return null;
    return Object.freeze(draft);
  } catch { return null; }
}

export function createGoalDraftMemory({ isCurrent } = {}) {
  let draft = null, obsolete = false;
  const listeners = new Set();
  const current = () => {
    if (obsolete) return false;
    try { if (typeof isCurrent === 'function' && isCurrent() === true) return true; } catch { /* fail closed */ }
    obsolete = true; draft = null;
    return false;
  };
  const publish = next => {
    draft = next;
    for (const listener of [...listeners]) { try { listener(); } catch { /* observers cannot break state transitions */ } }
    return next;
  };
  const transition = (expected, status, from) => {
    if (!current() || !draft || draft !== expected || (from && draft.status !== from)) return null;
    return publish(Object.freeze({ ...draft, status }));
  };
  return Object.freeze({
    subscribe(listener) {
      if (!current() || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => current() ? draft : null,
    getServerSnapshot: () => null,
    retain(input) {
      if (!current()) return null;
      const next = capture(input);
      if (!next || !current() || (draft && (draft.status === 'saving' || !sameIdentity(draft, next)))) return null;
      return publish(next);
    },
    clear(expected) {
      if (!current() || !draft || draft !== expected) return false;
      publish(null); return true;
    },
    markSaving: expected => transition(expected, 'saving'),
    markUncertain: expected => transition(expected, 'uncertain', 'saving'),
    reset() { if (draft !== null) publish(null); },
  });
}

export function makeGoalDraftHref(draft) {
  try {
    if (!identityValid(draft)) return null;
    return `/clientes?cliente=${draft.clientId}&periodo=${draft.period}&borrador=${draft.pieceId}`;
  } catch { return null; }
}

export function resolveGoalDraftPiece(data, draft, search) {
  try {
    if (!identityValid(draft) || typeof search !== 'string' || !Array.isArray(data?.clientes)) return null;
    const query = new URLSearchParams(search);
    const exact = (key, value) => query.getAll(key).length === 1 && query.get(key) === String(value);
    if (!exact('borrador', draft.pieceId) || !exact('cliente', draft.clientId) || !exact('periodo', draft.period)
      || data.periodo !== draft.period) return null;
    const groups = data.clientes.filter(group => Array.isArray(group.cuentas) && group.cuentas.some(account => account.id === draft.clientId));
    if (groups.length !== 1 || !Array.isArray(groups[0].piezas)) return null;
    const pieces = groups[0].piezas.filter(piece => piece.id === draft.pieceId && piece.tarea_id === draft.taskId && piece.puede_editar_contenido === true);
    return pieces.length === 1 ? pieces[0] : null;
  } catch { return null; }
}
