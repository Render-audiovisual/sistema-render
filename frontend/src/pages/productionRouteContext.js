const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function productionClientId(value) {
  return typeof value === 'string' && value.trim() === value && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? value : null;
}
export function productionLocation(href) {
  const params = new URL(href).searchParams;
  for (const key of ['cliente', 'mes', 'visita', 'tab']) {
    if (params.getAll(key).length > 1 || [...params.keys()].some(name => name.startsWith(`${key}[`))) throw new Error('El contexto de producciones no es válido.');
  }
  const clientId = params.has('cliente') ? productionClientId(params.get('cliente')) : '';
  if (clientId === null) throw new Error('El cliente del enlace no es válido. Elegí un cliente explícitamente.');
  const month = params.get('mes');
  if (month !== null && (month.trim() !== month || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw new Error('El mes del enlace no es válido.');
  const id = params.get('visita');
  if (id !== null && (id.trim() !== id || !uuid.test(id))) throw new Error('El enlace de la visita no es válido.');
  const tab = params.get('tab') ?? 'calendar';
  if (!['calendar', 'pending'].includes(tab)) throw new Error('La vista del enlace no es válida.');
  return {id, month, clientId, tab};
}
export function initialProductionContext(href, today) {
  try { return {...productionLocation(href), error:''}; }
  catch (error) { return {id:null, month:today.slice(0,7), clientId:'', tab:'calendar', error:error.message}; }
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
