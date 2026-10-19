import { createEditorialSessionGuard } from './EditorialPublicationControl.model.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const states = ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada', 'programada'];
export function isEditingDeliveryTask(task) {
  const persisted = task?.propiedades_extra?.workspace ?? task?.workspace;
  return positive(task?.id) && task.id <= 2147483647 && task.tipo_tarea === 'edicion' && persisted === 'render_os' &&
    (task.workspace == null || task.workspace === persisted);
}
export function deliveryUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Ingresá un enlace HTTP o HTTPS sin credenciales.');
  const trimmed = value.trim();
  if (!trimmed || /\s|\\/.test(trimmed) || !/^https?:\/\//i.test(trimmed)) throw new Error('Ingresá un enlace HTTP o HTTPS sin espacios ni barras invertidas.');
  let parsed;
  try { parsed = new URL(trimmed); } catch { throw new Error('Ingresá un enlace HTTP o HTTPS válido.'); }
  if (trimmed.length > 2000 || parsed.href.length > 2000 || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Ingresá un enlace HTTP o HTTPS sin credenciales, de hasta 2000 caracteres.');
  return parsed.href;
}
export function deliveryInput({ url, notes }) {
  if (typeof notes !== 'string' || notes.length > 4000 || notes.includes('\0')) throw new Error('Las notas deben tener hasta 4000 caracteres y no contener NUL.');
  return { url: deliveryUrl(url), notes: notes.trim() };
}
export function decodeEditingDeliveries(dto, taskId, mutation = false) {
  const invalid = () => { throw new Error('No se pudo validar el historial de entregas.'); };
  if (!object(dto) || !object(dto.task) || dto.task.id !== taskId || !positive(dto.task.revision) ||
      !states.includes(dto.task.estado) || typeof dto.can_deliver !== 'boolean' || !Array.isArray(dto.deliveries)) invalid();
  const seen = new Set();
  const deliveries = dto.deliveries.map(row => {
    if (!object(row) || !uuid(row.id) || seen.has(row.id.toLowerCase()) || row.task_id !== taskId || !positive(row.actor_id) ||
        !positive(row.task_revision) || row.task_revision > dto.task.revision || typeof row.recorded_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row.recorded_at) || !Number.isFinite(Date.parse(row.recorded_at)) ||
        new Date(row.recorded_at).toISOString().slice(0, 19) !== row.recorded_at.slice(0, 19)) invalid();
    const fields = deliveryInput(row); seen.add(row.id.toLowerCase());
    return { id: row.id.toLowerCase(), task_id: row.task_id, actor_id: row.actor_id, task_revision: row.task_revision,
      ...fields, recorded_at: row.recorded_at };
  }).sort((a, b) => a.task_revision - b.task_revision || Date.parse(a.recorded_at) - Date.parse(b.recorded_at) || a.id.localeCompare(b.id));
  const result = { task: { id: taskId, revision: dto.task.revision, estado: dto.task.estado }, deliveries, can_deliver: dto.can_deliver };
  if (mutation) {
    if (!uuid(dto.delivery_id) || !seen.has(dto.delivery_id.toLowerCase()) || typeof dto.replayed !== 'boolean') invalid();
    result.delivery_id = dto.delivery_id.toLowerCase(); result.replayed = dto.replayed;
  }
  return result;
}

export function editingReviewContext(state, observedTask) {
  const task = { id: observedTask.id, revision: observedTask.revision, estado: observedTask.estado };
  const blocked = status => ({ status, task, latestDelivery: null, can_deliver: false });
  if (state.loading || state.busy) return blocked('loading');
  if (state.error || state.conflict || state.uncertain || !state.data) return blocked('error');
  try {
    const dto = decodeEditingDeliveries(state.data, task.id);
    const latest = dto.deliveries.at(-1);
    return { status: 'ready', task: dto.task, latestDelivery: latest ? { id: latest.id, task_revision: latest.task_revision, url: latest.url } : null,
      can_deliver: dto.can_deliver };
  } catch { return blocked('error'); }
}

export function createEditingDeliveriesModel({ task, sesion, readSession, request, onChange = () => {}, onReviewContext = () => {}, onSaved = async () => {}, uuid: newUuid = () => crypto.randomUUID() }) {
  if (!isEditingDeliveryTask(task)) throw new Error('Esta tarea no admite entregas de edición.');
  const endpoint = `/api/tareas-edicion/${task.id}/entregas`;
  let disposed = false, generation = 0, controller = null, attempt = null;
  const observedTask = { id: task.id, revision: task.revision, estado: task.estado };
  let lastReviewContext = null;
  let state = { data: null, loading: false, busy: false, conflict: false, uncertain: false, error: '', message: '', accepted: null };
  const emitReview = context => {
    const signature = JSON.stringify(context);
    if (signature !== lastReviewContext) {
      lastReviewContext = signature;
      // A consumer failure must not turn an accepted mutation into an uncertain retry.
      try { onReviewContext(context); } catch { /* Parent owns its rendering lifecycle. */ }
    }
  };
  const publish = fields => { if (!disposed) {
    state = { ...state, ...fields }; onChange({ ...state });
    emitReview(editingReviewContext(state, observedTask));
  } };
  const guard = createEditorialSessionGuard(sesion, readSession, () => {
    generation++; controller?.abort(); attempt = null;
    publish({ data: null, accepted: null, loading: false, busy: false, uncertain: false, error: 'La sesión cambió. Volvé a abrir la tarea desde la sesión actual.', message: '' });
  });
  const current = version => !disposed && version === generation && guard.isCurrent();
  async function send() {
    if (disposed || state.busy || state.loading || !attempt || !guard.isCurrent()) return undefined;
    const version = generation; controller = new AbortController();
    publish({ busy: true, error: '', message: '' });
    try {
      const raw = await guard.request(request, endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.body, signal: controller.signal });
      if (!current(version) || !raw) return undefined;
      const dto = decodeEditingDeliveries(raw, task.id, true);
      attempt = null;
      publish({ data: dto, accepted: dto, uncertain: false, conflict: false, message: 'Entrega registrada. El estado mostrado corresponde a la tarea actual; el historial no implica aprobación.' });
      // A parent refresh failure must never turn an accepted delivery into an uncertain POST.
      try { await onSaved(dto, () => current(version)); }
      catch { if (current(version)) publish({ message: 'Entrega registrada. No se pudo actualizar el detalle de la tarea; volvé a abrirla para consultar su estado actual.' }); }
      return current(version) ? dto : undefined;
    } catch (error) {
      if (!current(version)) return undefined;
      const definitive = [400, 401, 403, 404, 409].includes(error.status);
      if (definitive) attempt = null;
      publish({ uncertain: !definitive, conflict: error.status === 409, error: error.status === 409
        ? 'La tarea cambió. Actualizá el historial, revisá tu entrega y volvé a enviarla de forma explícita.'
        : !definitive ? 'Resultado incierto. Conservamos tu enlace y notas: reintentá exactamente el mismo envío.' : 'No se pudo registrar la entrega. Revisá el acceso y los datos antes de intentar de nuevo.' });
      return undefined;
    } finally { if (current(version)) publish({ busy: false }); }
  }
  return {
    get snapshot() { return { ...state }; },
    async refresh() {
      if (disposed || state.busy || attempt || !guard.isCurrent()) return undefined;
      controller?.abort(); const version = ++generation; controller = new AbortController();
      publish({ loading: true, error: '', message: '' });
      try {
        const raw = await guard.request(request, endpoint, { signal: controller.signal });
        if (!current(version) || !raw) return undefined;
        const data = decodeEditingDeliveries(raw, task.id);
        publish({ data, conflict: false }); return data;
      } catch { if (current(version)) publish({ data: null, error: 'No se pudo consultar el historial. Actualizalo antes de enviar una entrega.' }); }
      finally { if (current(version)) publish({ loading: false }); }
    },
    async submit(input) {
      if (disposed || state.busy || state.loading || state.conflict || attempt || !guard.isCurrent() || !state.data?.can_deliver) return undefined;
      try {
        const fields = deliveryInput(input);
        const requestId = newUuid();
        if (!uuid(requestId)) throw new Error('No se pudo crear una clave segura para la entrega.');
        attempt = { body: JSON.stringify({ request_id: requestId.toLowerCase(), expected_revision: state.data.task.revision, ...fields }) };
      } catch (error) { publish({ error: error.message }); return undefined; }
      return send();
    },
    retry: send,
    dispose() {
      if (disposed) return;
      disposed = true; generation++; controller?.abort(); guard.cancel(); attempt = null;
      emitReview(editingReviewContext({ data: null }, observedTask));
    },
  };
}
