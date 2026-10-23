import { ESTADOS_PUBLICACION, TIPOS_PUBLICACION } from '../constants.js';

export function normalizePublicationTrackingContext(value = {}) {
  const client = typeof value.client === 'string' && /^[1-9]\d{0,9}$/.test(value.client) && Number(value.client) <= 2147483647 ? value.client : 'todos';
  const month = typeof value.month === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value.month) ? value.month : 'todos';
  const responsible = typeof value.responsible === 'string' && value.responsible.trim() && value.responsible.length <= 200
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value.responsible) ? value.responsible : 'todos';
  return { client, month, responsible,
    state: ESTADOS_PUBLICACION.some(item => item.id === value.state) ? value.state : 'todos',
    type: TIPOS_PUBLICACION.some(item => item.id === value.type) ? value.type : 'todos' };
}

const keys = { client: 'seg_cliente', month: 'seg_mes', state: 'seg_estado', responsible: 'seg_responsable', type: 'seg_tipo' };
export function readPublicationTrackingContext(search) {
  const params = new URLSearchParams(search || '');
  return normalizePublicationTrackingContext(Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, params.get(key)])));
}
export function publicationTrackingUrlChanges(value) {
  const context = normalizePublicationTrackingContext(value);
  return Object.fromEntries(Object.entries(keys).map(([field, key]) => [key, context[field] === 'todos' ? null : context[field]]));
}
