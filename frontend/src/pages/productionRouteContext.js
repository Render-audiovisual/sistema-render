const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function productionClientId(value) {
  return typeof value === 'string' && value.trim() === value && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? value : null;
}
export function validProductionDay(day) {
  if (typeof day !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)) return false;
  // setUTCFullYear avoids Date.UTC's special interpretation of years 0–99.
  const date = new Date(0);
  date.setUTCFullYear(Number(day.slice(0,4)), Number(day.slice(5,7)) - 1, Number(day.slice(8,10)));
  return date.toISOString().slice(0,10) === day;
}
export function productionCalendarDay({month, day}, today) {
  const effectiveMonth = month || today.slice(0,7);
  if (validProductionDay(day) && day.slice(0,7) === effectiveMonth) return day;
  return today.slice(0,7) === effectiveMonth ? today : `${effectiveMonth}-01`;
}
export function productionLocation(href) {
  const params = new URL(href).searchParams;
  for (const key of ['cliente', 'mes', 'visita', 'tab', 'dia']) {
    if (params.getAll(key).length > 1 || [...params.keys()].some(name => name.startsWith(`${key}[`))) throw new Error('El contexto de producciones no es válido.');
  }
  const clientId = params.has('cliente') ? productionClientId(params.get('cliente')) : '';
  if (clientId === null) throw new Error('El cliente del enlace no es válido. Elegí un cliente explícitamente.');
  let month = params.get('mes');
  if (month !== null && (month.trim() !== month || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw new Error('El mes del enlace no es válido.');
  const day = params.get('dia');
  if (day !== null) {
    if (!validProductionDay(day)) throw new Error('El día del enlace no es válido.');
    if (month !== null && day.slice(0,7) !== month) throw new Error('El día del enlace no pertenece al mes indicado.');
    if (month === null) month = day.slice(0,7);
  }
  const id = params.get('visita');
  if (id !== null && (id.trim() !== id || !uuid.test(id))) throw new Error('El enlace de la visita no es válido.');
  const tab = params.get('tab') ?? 'calendar';
  if (!['calendar', 'pending'].includes(tab)) throw new Error('La vista del enlace no es válida.');
  return {id, month, day, clientId, tab};
}
export function initialProductionContext(href, today) {
  try { return {...productionLocation(href), error:''}; }
  catch (error) { return {id:null, month:today.slice(0,7), day:null, clientId:'', tab:'calendar', error:error.message}; }
}
export function assertProductionClient(visit, clientId) {
  if (clientId && visit.cliente_id !== Number(clientId)) throw new Error('La visita no pertenece al cliente del enlace. Elegí otra visita o cambiá el filtro explícitamente.');
  return visit;
}
export function productionReadUrl({month, clientId, tab}) {
  if (clientId && !productionClientId(clientId)) throw new Error('Cliente inválido.');
  const params = new URLSearchParams(tab === 'pending' ? {} : {mes:month});
  if (clientId) params.set('cliente_id', clientId);
  return `/api/producciones${tab === 'pending' ? '/pendientes' : ''}${params.size ? `?${params}` : ''}`;
}
