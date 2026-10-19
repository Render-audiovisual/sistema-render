import { createEditorialSessionGuard } from './EditorialPublicationControl.model.js';
import { decodeEditingDeliveries, isEditingDeliveryTask } from './EditingDeliveries.model.js';

const positive = n => Number.isSafeInteger(n) && n > 0;
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
export function correctionNotes(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 4000 || !value.trim()) throw new Error('Escribí las correcciones, hasta 4000 caracteres.');
  return value.trim();
}
export function decodeEditingReviews(dto, taskId, mutation = false) {
  const invalid = () => { throw new Error('No se pudo validar el historial de revisiones.'); };
  if (!dto || typeof dto !== 'object' || Array.isArray(dto) || !(dto.latest_delivery === null || dto.latest_delivery && typeof dto.latest_delivery === 'object') ||
      typeof dto.can_request_corrections !== 'boolean' || !Array.isArray(dto.decisions) || !Number.isSafeInteger(dto.total) || dto.total < 0 ||
      dto.decisions.length !== Math.min(dto.total, 200) || typeof dto.truncated !== 'boolean' || dto.truncated !== (dto.total > dto.decisions.length)) invalid();
  const delivery = decodeEditingDeliveries({ task: dto.task, deliveries: dto.latest_delivery === null ? [] : [dto.latest_delivery], can_deliver: false }, taskId);
  if (dto.total > 0 && !dto.latest_delivery) invalid();
  if (dto.can_request_corrections && (!dto.latest_delivery || dto.task.estado !== 'en_revision')) invalid();
  const ids = new Set(), revisions = new Set();
  const decisions = dto.decisions.map(row => {
    if (!row || !uuid(row.id) || ids.has(row.id.toLowerCase()) || row.task_id !== taskId || !uuid(row.delivery_id) || !positive(row.actor_id) ||
        !['aprobada', 'correcciones'].includes(row.action) || !positive(row.task_revision) || row.task_revision > dto.task.revision || revisions.has(row.task_revision) ||
        typeof row.notes !== 'string' || row.notes.length > 4000 || row.notes.includes('\0') ||
        (row.action === 'aprobada' ? row.notes !== '' : !row.notes.trim() || row.notes !== row.notes.trim()) || !timestamp(row.recorded_at)) invalid();
    ids.add(row.id.toLowerCase()); revisions.add(row.task_revision);
    return { id: row.id.toLowerCase(), task_id: row.task_id, delivery_id: row.delivery_id.toLowerCase(), actor_id: row.actor_id,
      action: row.action, task_revision: row.task_revision, notes: row.notes, recorded_at: row.recorded_at };
  }).sort((a, b) => a.task_revision - b.task_revision || a.id.localeCompare(b.id));
  const result = { task: delivery.task, latest_delivery: delivery.deliveries[0] || null, decisions, total: dto.total,
    truncated: dto.truncated, can_request_corrections: dto.can_request_corrections };
  if (mutation) {
    if (!uuid(dto.decision_id) || typeof dto.replayed !== 'boolean') invalid();
    const recorded = decisions.find(row => row.id === dto.decision_id.toLowerCase());
    if ((!dto.replayed && !recorded) || (recorded && recorded.action !== 'correcciones')) invalid();
    result.decision_id = dto.decision_id.toLowerCase(); result.replayed = dto.replayed;
  }
  return result;
}

export function createEditingReviewsModel({ task, sesion, readSession, request, onChange = () => {}, onSaved = async () => {}, disabled = false, uuid: newUuid = () => crypto.randomUUID(), timers = globalThis }) {
  if (!isEditingDeliveryTask(task)) throw new Error('Esta tarea no admite revisiones de edición.');
  const id = task.id, admin = sesion?.usuario?.rol === 'admin';
  let observed = { id, revision: task.revision, estado: task.estado }, blocked = Boolean(disabled), disposed = false, generation = 0;
  let controller = null, attempt = null, activeTimer = null;
  let state = { data: null, notes: '', acknowledged: false, loading: false, busy: false, uncertain: false, conflict: false, error: '', message: '', accepted: null, disabled: blocked };
  const emit = changes => { if (!disposed) { state = { ...state, ...changes }; onChange({ ...state }); } };
  const consistent = data => data && data.task.revision === observed.revision && data.task.estado === observed.estado;
  const abortActive = () => { if (activeTimer !== null) timers.clearTimeout(activeTimer); activeTimer = null; controller?.abort(); };
  const guard = createEditorialSessionGuard(sesion, readSession, () => {
    generation++; abortActive(); attempt = null;
    emit({ data: null, acknowledged: false, busy: false, loading: false, uncertain: false, accepted: null, error: 'La sesión cambió. Volvé a abrir la tarea desde la sesión actual.', message: '' });
  });
  const current = version => !disposed && version === generation && guard.isCurrent();
  async function timedRequest(url, options) {
    const activeController = controller;
    let deadline;
    const timeout = new Promise((resolve, reject) => {
      deadline = timers.setTimeout(() => { reject(new Error('Tiempo de espera agotado.')); activeController.abort(); }, 15000);
      activeTimer = deadline;
    });
    try { return await Promise.race([guard.request(request, url, options), timeout]); }
    finally { timers.clearTimeout(deadline); if (activeTimer === deadline) activeTimer = null; }
  }
  async function send() {
    if (disposed || blocked || state.busy || state.loading || !attempt || !guard.isCurrent()) return undefined;
    const version = generation; controller = new AbortController();
    emit({ busy: true, acknowledged: false, error: '', message: '' });
    try {
      const raw = await timedRequest(`/api/tareas-edicion/${id}/correcciones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.body, signal: controller.signal });
      if (!current(version) || !raw) return undefined;
      const dto = decodeEditingReviews(raw, id, true);
      const decision = dto.decisions.find(row => row.id === dto.decision_id);
      if (decision && (decision.delivery_id !== attempt.deliveryId || decision.notes !== attempt.notes)) throw new Error('Respuesta incierta.');
      attempt = null;
      emit({ data: dto, notes: '', acknowledged: false, accepted: dto, uncertain: false, conflict: false, message: 'Pedido de correcciones registrado. El historial conserva las decisiones anteriores; no acredita aprobación vigente.' });
      try { await onSaved(dto, () => current(version)); }
      catch { if (current(version)) emit({ message: 'Pedido registrado. No se pudo actualizar el detalle de la tarea; volvé a abrirla para consultar su estado actual.' }); }
      return current(version) ? dto : undefined;
    } catch (error) {
      if (!current(version)) return undefined;
      const definitive = [400, 401, 403, 404, 409].includes(error.status);
      if (definitive) attempt = null;
      emit({ acknowledged: false, uncertain: !definitive, conflict: error.status === 409, error: error.status === 409
        ? 'La tarea o la entrega cambió. Actualizá el historial y revisá explícitamente la versión antes de volver a pedir correcciones.'
        : !definitive ? 'Resultado incierto. Conservamos tus notas y el intento original; reintentá el mismo envío.' : 'No se pudo registrar el pedido. Revisá los datos y el acceso antes de volver a intentar.' });
      return undefined;
    } finally { if (current(version)) emit({ busy: false }); }
  }
  return {
    get snapshot() { return { ...state }; },
    updateContext(nextTask, nextDisabled = blocked) {
      if (disposed) return;
      blocked = Boolean(nextDisabled);
      if (!isEditingDeliveryTask(nextTask) || nextTask.id !== id) {
        generation++; abortActive(); attempt = null; blocked = true;
        emit({ disabled: true, data: null, acknowledged: false, busy: false, loading: false, uncertain: false, error: 'El contexto de la tarea cambió. Volvé a abrirla.' }); return;
      }
      const changed = nextTask.revision !== observed.revision || nextTask.estado !== observed.estado;
      observed = { id, revision: nextTask.revision, estado: nextTask.estado };
      if (changed && state.loading && !state.busy) { generation++; abortActive(); }
      emit({ disabled: blocked, ...(changed ? { acknowledged: false, loading: false } : {}) });
    },
    setNotes(value) { if (!disposed && !blocked && !state.busy && !attempt && typeof value === 'string') emit({ notes: value, message: '' }); },
    acknowledge(value) {
      if (!disposed && !blocked && !state.busy && !state.loading && !state.conflict && !attempt && admin && consistent(state.data) && state.data.can_request_corrections)
        emit({ acknowledged: value === true });
    },
    async refresh() {
      if (disposed || state.busy || attempt || !guard.isCurrent()) return undefined;
      abortActive(); const version = ++generation; controller = new AbortController();
      emit({ loading: true, acknowledged: false, error: '', message: '' });
      try {
        const raw = await timedRequest(`/api/tareas-edicion/${id}/revisiones`, { signal: controller.signal });
        if (!current(version) || !raw) return undefined;
        const data = decodeEditingReviews(raw, id);
        emit({ data, conflict: false, acknowledged: false }); return data;
      } catch { if (current(version)) emit({ data: null, error: 'No se pudo consultar el historial. Actualizalo antes de pedir correcciones.' }); }
      finally { if (current(version)) emit({ loading: false }); }
    },
    async submit() {
      if (disposed || blocked || state.loading || state.busy || state.conflict || attempt || !admin || !guard.isCurrent() || !state.acknowledged || !consistent(state.data) || !state.data?.can_request_corrections || !state.data.latest_delivery) return undefined;
      try {
        const notes = correctionNotes(state.notes), requestId = newUuid();
        if (!uuid(requestId)) throw new Error('No se pudo crear una clave segura para el pedido.');
        attempt = { deliveryId: state.data.latest_delivery.id, notes, body: JSON.stringify({ request_id: requestId.toLowerCase(), expected_revision: state.data.task.revision, expected_entrega_id: state.data.latest_delivery.id, notes }) };
      } catch (error) { emit({ error: error.message }); return undefined; }
      return send();
    },
    retry: send,
    dispose() { disposed = true; generation++; abortActive(); guard.cancel(); attempt = null; },
  };
}
