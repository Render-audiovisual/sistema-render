import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from '../shared/session/session-binding.js';
export const INVENTORY_LIMIT = 20;
export const INVENTORY_VIEWS = ['all', 'awaiting_review', 'with_corrections'];
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const count = n => Number.isSafeInteger(n) && n >= 0;
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const timestamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const invalid = () => { throw new Error('El inventario de edición no es válido.'); };
export function normalizeInventorySelection({ view = 'all', offset = 0, q = '', cliente_id = null } = {}) {
  if (!INVENTORY_VIEWS.includes(view) || !count(offset) || offset > 1000000 || offset % 20 !== 0
    || typeof q !== 'string' || q.length > 200 || /\p{Cc}/u.test(q) || !(cliente_id === null || positive(cliente_id))) invalid();
  return { view, offset, q, cliente_id };
}
export function readInventoryLocation(search) {
  const params = new URLSearchParams(search);
  for (const key of ['inv_view', 'inv_page', 'inv_q', 'inv_cliente']) if (params.getAll(key).length > 1) invalid();
  const decimal = value => { if (!/^(0|[1-9][0-9]*)$/.test(value)) invalid(); return Number(value); };
  return normalizeInventorySelection({ view: params.get('inv_view') ?? 'all', offset: decimal(params.get('inv_page') ?? '0'),
    q: params.get('inv_q') ?? '', cliente_id: params.has('inv_cliente') ? decimal(params.get('inv_cliente')) : null });
}
export function inventoryLocationUrl(currentUrl, selection) {
  const s = normalizeInventorySelection(selection), url = new URL(currentUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['/feedback', '/bloc-notas'].includes(url.pathname) || url.username || url.password) invalid();
  url.pathname = '/feedback';
  url.searchParams.set('inv_view', s.view); url.searchParams.set('inv_page', String(s.offset));
  if (s.q) url.searchParams.set('inv_q', s.q); else url.searchParams.delete('inv_q');
  if (s.cliente_id !== null) url.searchParams.set('inv_cliente', String(s.cliente_id)); else url.searchParams.delete('inv_cliente');
  return `${url.pathname}${url.search}${url.hash}`;
}
export function inventoryRequestUrl(selection) {
  const s = normalizeInventorySelection(selection);
  const params = new URLSearchParams({ limit: '20', offset: String(s.offset), view: s.view });
  if (s.q) params.set('q', s.q);
  if (s.cliente_id !== null) params.set('cliente_id', String(s.cliente_id));
  return `/api/tareas-edicion/inventario-feedback?${params}`;
}
export function parseFeedbackTaskInventory(value, selection = {}) {
  const s = normalizeInventorySelection(selection);
  if (value?.version !== 1 || value.limit !== 20 || value.offset !== s.offset || !count(value.total)
    || typeof value.has_more !== 'boolean' || value.has_more !== (s.offset + 20 < value.total)
    || !Array.isArray(value.items) || value.items.length !== Math.min(20, Math.max(0, value.total - s.offset))) invalid();
  const ids = new Set();
  let previousId = Infinity;
  const items = value.items.map(item => {
    if (!positive(item?.task_id) || !positive(item.revision) || ids.has(item.task_id) || typeof item.titulo !== 'string'
      || !['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada', 'programada'].includes(item.estado)
      || typeof item.has_corrections !== 'boolean' || item.href !== `/workspace/tareas?task=${item.task_id}`) invalid();
    if (item.task_id >= previousId) invalid();
    previousId = item.task_id; ids.add(item.task_id);
    const cliente = item.cliente;
    if (!(cliente === null || (positive(cliente?.id) && typeof cliente.nombre === 'string')) || (s.cliente_id !== null && cliente?.id !== s.cliente_id)) invalid();
    const delivery = item.latest_delivery, decision = item.latest_decision;
    if (!(delivery === null || (uuid(delivery?.id) && positive(delivery.task_revision) && delivery.task_revision <= item.revision && timestamp(delivery.recorded_at)))) invalid();
    if (!(decision === null || (uuid(decision?.id) && uuid(decision.delivery_id) && ['aprobada', 'correcciones'].includes(decision.action)
      && positive(decision.task_revision) && decision.task_revision <= item.revision && timestamp(decision.recorded_at)))) invalid();
    if ((decision?.action === 'correcciones' && !item.has_corrections) || (s.view === 'with_corrections' && !item.has_corrections)
      || (s.view === 'awaiting_review' && (item.estado !== 'en_revision' || !delivery))
      || (!decision && !(item.estado === 'en_revision' && delivery))) invalid();
    return { task_id: item.task_id, revision: item.revision, titulo: item.titulo, estado: item.estado,
      cliente: cliente === null ? null : { id: cliente.id, nombre: cliente.nombre },
      latest_delivery: delivery === null ? null : { id: delivery.id, task_revision: delivery.task_revision, recorded_at: delivery.recorded_at },
      latest_decision: decision === null ? null : { id: decision.id, delivery_id: decision.delivery_id, action: decision.action, task_revision: decision.task_revision, recorded_at: decision.recorded_at },
      has_corrections: item.has_corrections, href: `/workspace/tareas?task=${item.task_id}` };
  });
  return { version: 1, limit: 20, offset: s.offset, total: value.total, has_more: value.has_more, items };
}
export function createFeedbackInventoryLoader({ sesion, readSession, request, onChange }) {
  const captured = captureSessionBinding(sesion);
  let disposed = false, generation = 0, controller;
  const current = () => {
    try { const live = readSession(); return Boolean(captured) && positive(captured.id) && ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion'].includes(captured.role)
      && captured.active !== false && sessionBindingMatches(captured, live); } catch { return false; }
  };
  return { async load(selection) {
    const observed = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
    const emit = state => { if (!disposed && observed === generation) onChange(state); };
    if (disposed) return;
    if (!current()) { emit({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' }); return; }
    try {
      const normalized = normalizeInventorySelection(selection);
      emit({ status: 'loading', data: null, error: '' });
      const value = await request(inventoryRequestUrl(normalized), sessionRequestOptions(captured, { method: 'GET', signal, cache: 'no-store' }));
      if (disposed || signal.aborted || observed !== generation) return;
      if (!current()) { emit({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' }); return; }
      emit({ status: 'ready', data: parseFeedbackTaskInventory(value, normalized), error: '' });
    } catch (error) {
      if (disposed || signal.aborted || observed !== generation) return;
      emit({ status: 'error', data: null, error: current() ? 'No pudimos cargar la revisión de edición. Volvé a intentar.' : 'La sesión cambió. Volvé a iniciar sesión.' });
    }
  }, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
