// Ephemeral render reconciliation only: never merges business fields or
// changes the revision used by a form's independent CAS/draft model.
export function newestProductionVisit(current, incoming) {
  return current?.id === incoming?.id && current?.cliente_id === incoming?.cliente_id
    && Number.isSafeInteger(current?.revision) && current.revision > 0
    && Number.isSafeInteger(incoming?.revision) && incoming.revision > 0
    && current.revision > incoming.revision ? current : incoming;
}

export function createProductionVisitObserver(readContext) {
  let context=readContext(),known=new Map(),token=Symbol('production-visit-observation');
  const synchronize=()=>{
    const nextContext=readContext();
    if(nextContext!==context){context=nextContext;known=new Map();token=Symbol('production-visit-observation');}
  };
  return Object.freeze({get token(){synchronize();return token;},observe(incoming) {
    synchronize();
    const previous=known.get(incoming.id),latest=newestProductionVisit(previous,incoming);
    if(JSON.stringify(previous)!==JSON.stringify(latest))token=Symbol('production-visit-observation');
    known.set(incoming.id,latest);
    return latest;
  }});
}

export function reconcileProductionVisitList(current, incoming, {month, clientId}) {
  const previous = new Map(current.map(visit => [visit.id, visit]));
  // The incoming snapshot owns membership and order. Retaining a newer row
  // must not reinsert absent rows or keep a rescheduled visit in an old month.
  return incoming.map(visit => {
    const known=previous.get(visit.id);
    if(known?.cliente_id!==visit.cliente_id && Number.isSafeInteger(known?.revision)
      && Number.isSafeInteger(visit.revision) && visit.revision>0 && known.revision>visit.revision)return null;
    return newestProductionVisit(known,visit);
  })
    .filter(visit => visit && visit.fecha?.slice(0, 7) === month
      && (!clientId || visit.cliente_id === Number(clientId)));
}
