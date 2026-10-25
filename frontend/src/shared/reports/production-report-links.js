import { validProductionDay } from '../../pages/productionRouteContext.js';

// Report input never supplies a destination URL. Rebuild only the canonical
// same-origin visit context; this link grants no read or edit authority.
export function productionReportVisitHref(visit) {
  if (typeof visit?.id !== 'string' || visit.id.length !== 36
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(visit.id)
    || !validProductionDay(visit.fecha)) return null;
  const query = new URLSearchParams({visita:visit.id, mes:visit.fecha.slice(0,7), dia:visit.fecha});
  return `/producciones?${query}`;
}
