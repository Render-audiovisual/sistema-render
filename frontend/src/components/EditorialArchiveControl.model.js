import { isSessionFailure } from '../shared/session/captured-request.js';
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const domains = ['historia', 'publicacion'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fail = () => new Error('La respuesta de archivo no es válida. Recargá la lista antes de continuar.');
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function archivePiece(value, domain) {
  if (!closed(value, ['id','dominio','cliente','titulo','tipo','estado','fecha_programada','revision','archived','can_archive','can_restore','publication_classification'])
    || !positive(value.id) || !domains.includes(domain) || value.dominio !== domain || !revision(value.revision)
    || !closed(value.cliente, ['id','nombre','activo']) || !positive(value.cliente.id) || typeof value.cliente.nombre !== 'string' || typeof value.cliente.activo !== 'boolean'
    || !['titulo','tipo','estado'].every(key => typeof value[key] === 'string')
    || !['archived','can_archive','can_restore'].every(key => typeof value[key] === 'boolean')
    || !['no_publicada','historica_sin_confirmacion','confirmada_manualmente'].includes(value.publication_classification)
    || value.fecha_programada !== null && (typeof value.fecha_programada !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.fecha_programada)
      || !Number.isFinite(Date.parse(`${value.fecha_programada}T00:00:00Z`)) || new Date(`${value.fecha_programada}T00:00:00Z`).toISOString().slice(0,10) !== value.fecha_programada)) throw fail();
  return value;
}
export function archivePageUrl(domain, offset = 0, clientId = null, limit = 20) {
  if (!domains.includes(domain) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || clientId !== null && !positive(clientId)) throw fail();
  const params = new URLSearchParams({ dominio: domain, offset: String(offset), limit: String(limit) });
  if (clientId !== null) params.set('cliente_id', String(clientId));
  return `/api/editorial-archivo?${params}`;
}
export function archivePage(value, domain, offset = 0, limit = 20) {
  if (!closed(value, ['version','dominio','offset','limit','total','has_more','items']) || value.version !== 1 || value.dominio !== domain
    || value.offset !== offset || value.limit !== limit || !Number.isSafeInteger(value.total) || value.total < 0
    || typeof value.has_more !== 'boolean' || !Array.isArray(value.items) || value.items.length > limit
    || value.items.length !== Math.min(limit, Math.max(0, value.total - offset))
    || value.has_more !== (offset + value.items.length < value.total)) throw fail();
  for (const item of value.items) if (!archivePiece(item, domain).archived) throw fail();
  if (new Set(value.items.map(item => item.id)).size !== value.items.length) throw fail();
  return value;
}
export function archiveObservation(piece, domain, action) {
  const typed = typeof piece?.archived === 'boolean' && piece?.dominio === domain;
  const version = typed ? piece.revision : piece?.publicacion_evidencia?.revision;
  const clientId = typed ? piece.cliente?.id : piece?.cliente_id;
  if (!domains.includes(domain) || !positive(piece?.id) || !positive(clientId) || !revision(version)
    || piece?.dominio && piece.dominio !== domain || !['archivar','restaurar'].includes(action)) throw fail();
  if (action === 'archivar' && (piece.can_archive === false || piece.estado === 'publicada' || piece['fecha_publicación_real']
    || piece.publicacion_evidencia?.confirmation || typed && piece.publication_classification === 'confirmada_manualmente')) {
    throw new Error('Esta pieza tiene una publicación registrada y no se puede archivar.');
  }
  if (action === 'restaurar' && (!typed || !piece.archived || !piece.can_restore || piece.cliente.activo !== true)) throw new Error('Esta pieza no se puede restaurar desde su estado actual.');
  return { id: piece.id, domain, clientId, revision: version };
}
export function createEditorialArchiveOperation({ capture, isAdmin, randomUUID = () => globalThis.crypto.randomUUID() }) {
  let attempt = null, accepted = null, busy = false, phase = 'idle', disposed = false;
  const authorize = () => { if (disposed || !isAdmin()) throw new Error('Solo administración puede archivar o restaurar piezas.'); };
  async function send() {
    authorize(); if (!attempt || busy || phase === 'blocked') throw new Error('Revisá el intento de archivo pendiente.');
    const own = attempt; own.scope.assertCurrent(); busy = true; phase = 'pending';
    try {
      const dto = await own.scope.request(own.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: own.body });
      own.scope.assertCurrent(); authorize(); if (own !== attempt) throw fail();
      if (!closed(dto, ['version','piece','operation']) || dto.version !== 1 || archivePiece(dto.piece, own.domain).id !== own.id
        || dto.piece.cliente.id !== own.clientId || !closed(dto.operation, ['id','request_id','action','replayed'])
        || typeof dto.operation.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(dto.operation.id)
        || dto.operation.request_id !== own.requestId || dto.operation.action !== own.action || typeof dto.operation.replayed !== 'boolean'
        || !dto.operation.replayed && (dto.piece.revision <= own.revision || dto.piece.archived !== (own.action === 'archivar'))) throw fail();
      accepted = dto; phase = 'confirmed'; return { dto, scope: own.scope };
    } catch (error) {
      if (disposed || !own.scope.current() || isSessionFailure(error) || [401,403,404,409].includes(error?.status)) phase = 'blocked';
      else if ([400,413,422,428].includes(error?.status)) { phase = 'idle'; attempt = null; }
      else phase = 'uncertain';
      throw error;
    } finally { busy = false; }
  }
  return Object.freeze({
    get snapshot() { return Object.freeze({ phase, busy, locked: Boolean(attempt), accepted }); },
    async submit(piece, domain, action, motivo) {
      authorize(); if (attempt || busy) throw new Error('Verificá el intento pendiente antes de otro cambio.');
      const observed = archiveObservation(piece, domain, action), scope = capture(); scope.assertCurrent();
      const requestId = randomUUID(); if (!uuid(requestId)) throw new Error('No se pudo crear una clave segura para esta operación.');
      if (motivo !== undefined && (typeof motivo !== 'string' || motivo.includes('\u0000') || [...motivo].length > 1000)) throw new Error('Revisá el motivo.');
      attempt = Object.freeze({ ...observed, scope, action, requestId,
        url: `/api/editorial-archivo/${domain}/${observed.id}/${action}`,
        body: JSON.stringify({ request_id: requestId, expected_revision: observed.revision, ...(motivo === undefined ? {} : { motivo: motivo.trim() }) }) });
      return send();
    },
    async verify() {
      authorize(); if (!attempt || busy || !['uncertain','confirmed'].includes(phase)) throw new Error('No hay un intento verificable.');
      attempt.scope.assertCurrent(); return phase === 'confirmed' ? { dto: accepted, scope: attempt.scope } : send();
    },
    complete() { authorize(); if (phase !== 'confirmed' || busy) throw fail(); attempt.scope.assertCurrent(); attempt = null; accepted = null; phase = 'idle'; },
    cancel() { disposed = true; phase = 'blocked'; attempt = null; accepted = null; },
  });
}
