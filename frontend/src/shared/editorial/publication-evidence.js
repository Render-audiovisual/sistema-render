const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

// Explicit timezone required; Date.parse alone normalizes impossible days.
function instant(value, utcOnly = false) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || (utcOnly && match[8] !== 'Z')) return null;
  const [, year, month, day, hour, minute, second, , zone, offsetHour, offsetMinute] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const parsed = Date.parse(value);
  if (+year < 1 || !Number.isFinite(parsed) || !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || +hour > 23 || +minute > 59 || +second > 59 ||
    (zone !== 'Z' && (+offsetHour > 23 || +offsetMinute > 59))) return null;
  return parsed;
}
const cordoba = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' });
function calendarDate(time) {
  const parts = Object.fromEntries(cordoba.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function confirmation(item) {
  if (!object(item) || !own(item, 'id') || !positive(item.id) || !own(item, 'cliente_id') || !positive(item.cliente_id) ||
    !own(item, 'estado') || item.estado !== 'publicada' || !own(item, 'fecha_publicación_real') || !own(item, 'publicacion_evidencia')) return null;
  if (own(item, 'dominio') && !['historia', 'publicacion'].includes(item.dominio)) return null;
  const evidence = item.publicacion_evidencia;
  if (!object(evidence) || !['classification', 'revision', 'confirmation'].every(key => own(evidence, key)) ||
    evidence.classification !== 'confirmada_manualmente' || !positive(evidence.revision)) return null;
  const event = evidence.confirmation;
  if (!object(event) || !['id', 'actor_id', 'source', 'occurred_at', 'recorded_at'].every(key => own(event, key)) ||
    !uuid(event.id) || !positive(event.actor_id) || event.source !== 'manual') return null;
  const occurred = instant(event.occurred_at, true), recorded = instant(event.recorded_at, true), actual = instant(item['fecha_publicación_real']);
  return occurred !== null && recorded !== null && actual === occurred ? event : null;
}
export const isConfirmedPublication = item => confirmation(item) !== null;
export function isHistoricalPublication(item) {
  return object(item) && own(item, 'id') && positive(item.id) && !isConfirmedPublication(item) &&
    ((own(item, 'estado') && item.estado === 'publicada') ||
      (own(item, 'fecha_publicación_real') && typeof item['fecha_publicación_real'] === 'string' && item['fecha_publicación_real'].trim() !== ''));
}
export function confirmationDate(item) {
  const event = confirmation(item);
  return event ? calendarDate(instant(event.occurred_at, true)) : null;
}

// Historical timestamps remain coverage only. Never interpret timezone-less
// legacy SQL casts as instants; a literal calendar date is explicitly dated.
export function historicalPublicationDate(item) {
  if (!isHistoricalPublication(item)) return null;
  const value = item['fecha_publicación_real'], time = instant(value);
  if (time !== null) return calendarDate(time);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

// Adapter for the singular status API; returns only the shared read field.
// It never forwards arbitrary status/event properties or metadata.
export function evidenceFromStatus(dto) {
  if (!object(dto) || !['piece', 'classification', 'current_confirmation'].every(key => own(dto, key)) || !object(dto.piece)) return null;
  const piece = dto.piece;
  if (!['id', 'cliente_id', 'dominio', 'revision', 'estado', 'fecha_publicacion_real'].every(key => own(piece, key)) ||
    !positive(piece.id) || !positive(piece.cliente_id) || !['historia', 'publicacion'].includes(piece.dominio) ||
    !Number.isSafeInteger(piece.revision) || piece.revision < 0) return null;
  const evidence = { classification: dto.classification, revision: piece.revision, confirmation: dto.current_confirmation };
  const item = { id: piece.id, cliente_id: piece.cliente_id, dominio: piece.dominio, estado: piece.estado,
    'fecha_publicación_real': piece.fecha_publicacion_real, publicacion_evidencia: evidence };
  if (isConfirmedPublication(item)) {
    const event = evidence.confirmation;
    return { classification: 'confirmada_manualmente', revision: piece.revision,
      confirmation: { id: event.id, actor_id: event.actor_id, occurred_at: event.occurred_at, recorded_at: event.recorded_at, source: 'manual' } };
  }
  if (!['historica_sin_confirmacion', 'no_publicada'].includes(dto.classification) || dto.current_confirmation !== null) return null;
  return { classification: isHistoricalPublication(item) ? 'historica_sin_confirmacion' : 'no_publicada', revision: piece.revision, confirmation: null };
}
