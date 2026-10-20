import { evidenceFromStatus, isConfirmedPublication } from '../shared/editorial/publication-evidence.js';
import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from '../shared/session/session-binding.js';

export function validateEditorialStatus(dto, item, domain = item?.dominio) {
  const evidence = evidenceFromStatus(dto);
  if (!evidence || typeof dto.can_confirm !== 'boolean' || dto.piece.id > 2147483647 || item.id !== dto.piece.id || (domain && domain !== dto.piece.dominio) ||
      (item.cliente_id != null && item.cliente_id !== dto.piece.cliente_id) ||
      (dto.piece.fecha_programada !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(dto.piece.fecha_programada) ||
        new Date(`${dto.piece.fecha_programada}T00:00:00Z`).toISOString().slice(0, 10) !== dto.piece.fecha_programada))) throw new Error('La pieza cambió o la respuesta es inválida. Recargá la lista antes de continuar.');
  return evidence;
}

export function mergeEditorialStatus(item, dto) {
  const evidence = validateEditorialStatus(dto, item);
  return { ...item, estado: dto.piece.estado, fecha_programada: dto.piece.fecha_programada, 'fecha_publicación_real': dto.piece.fecha_publicacion_real, publicacion_evidencia: evidence };
}

export function editorialFields(item, fields, allowState = true) {
  const result = { ...fields };
  if (!allowState || result.estado === 'publicada' || isConfirmedPublication(item)) delete result.estado;
  return result;
}

export function cordobaOccurrence(value, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Ingresá fecha y hora real de Córdoba.');
  const calendar = new Date(`${value}:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 16) !== value) throw new Error('Fecha inválida.');
  const date = new Date(`${value}:00-03:00`);
  if (date.getTime() > now) throw new Error('La publicación no puede estar en el futuro.');
  return date.toISOString();
}

// One immutable attempt survives uncertain transport outcomes. Never rebase it.
export function createEditorialSessionGuard(session, readSession, onInvalidated = () => {}) {
  // Capture primitives, never retain a mutable session object as authority.
  const identity = captureSessionBinding(session);
  let invalid = false, generation = 0;
  const controllers = new Set();
  const cancel = () => { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); };
  const isCurrent = () => {
    if (invalid) return false;
    let current;
    try { current = readSession(); } catch { current = null; }
    if (!Number.isSafeInteger(identity?.id) || identity.id <= 0 || !sessionBindingMatches(identity, current)) {
      invalid = true; cancel(); onInvalidated(); return false;
    }
    return true;
  };
  return { isCurrent, cancel,
    async request(request, url, options = {}) {
      if (!isCurrent()) return undefined;
      const current = generation, controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) controller.abort();
      controllers.add(controller);
      try {
        const dto = await request(url, sessionRequestOptions(identity, { ...options, signal: controller.signal }));
        return isCurrent() && current === generation && !controller.signal.aborted ? dto : undefined;
      } catch (error) {
        if (!isCurrent() || current !== generation || controller.signal.aborted) return undefined;
        throw error;
      } finally { controllers.delete(controller); options.signal?.removeEventListener('abort', abort); }
    },
  };
}

export function createEditorialAttempt(request, uuid = () => crypto.randomUUID(), piece = null, isCurrent = () => true) {
  let attempt = null, busy = false, generation = 0, controller = null;
  const cancel = () => { generation++; controller?.abort(); busy = false; attempt = null; };
  return {
    get pending() { return attempt; },
    cancel,
    async send(domain, id, action, revision, occurredAt) {
      if (!isCurrent()) { cancel(); return undefined; }
      if (busy) return undefined;
      if (!['historia', 'publicacion'].includes(domain) || !Number.isSafeInteger(id) || id <= 0 ||
          !['confirmar', 'retirar'].includes(action) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Intento inválido.');
      const intent = JSON.stringify({ domain, id, action, revision, occurredAt });
      if (attempt && attempt.intent !== intent) throw new Error('Resolvé primero el intento pendiente.');
      attempt ||= { intent, url: `/api/editorial-publicacion/${domain}/${id}/${action}`, body: JSON.stringify({ request_id: uuid(), expected_revision: revision, ...(action === 'confirmar' ? { occurred_at: occurredAt } : {}) }) };
      busy = true;
      const current = generation;
      controller = new AbortController();
      try {
        const dto = await request(attempt.url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: attempt.body });
        if (!isCurrent()) { cancel(); return undefined; }
        if (current !== generation) return undefined;
        if (!evidenceFromStatus(dto) || dto.piece.id !== id || dto.piece.dominio !== domain) throw new Error('Respuesta incierta.');
        if (piece) validateEditorialStatus(dto, piece, domain);
        attempt = null;
        return dto;
      } catch (error) {
        if (!isCurrent()) { cancel(); return undefined; }
        if (current !== generation) return undefined;
        if ([400, 401, 403, 404, 409].includes(error.status)) attempt = null;
        throw error;
      } finally { if (current === generation) busy = false; }
    },
  };
}
