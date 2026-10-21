const clone = value => JSON.parse(JSON.stringify(value));
const validVisit = visit => typeof visit?.id === 'string' && visit.id.length > 0
  && Number.isSafeInteger(visit.revision) && visit.revision > 0;
const conflict = () => Object.assign(new Error('La visita cambió. Conservamos tus campos; descartá y cargá la versión guardada antes de guardar.'), { status: 409 });
export function verifiedProductionDraftVisit(value, expectedId) {
  const visit=value?.visita || value;
  const text = (row, keys) => keys.every(key=>typeof row?.[key]==='string');
  const validItems=(rows,kind)=>Array.isArray(rows) && new Set(rows.map(row=>row?.id)).size===rows.length
    && rows.every(row=>typeof row?.id==='string' && row.id.length>0 && (kind!=='videos'||row.visita_id===visit.id)
      && (kind==='videos' ? text(row,['titulo','guion','estado','material_url','observaciones'])
        && ['planificado','grabado','pendiente','repetir'].includes(row.estado)
        : text(row,['tipo','estado','drive_url','observaciones']) && ['realizada','pendiente','repetir'].includes(row.estado)));
  if(!validVisit(visit) || expectedId!==undefined && visit.id!==expectedId
    || !Number.isSafeInteger(visit.cliente_id) || visit.cliente_id<=0
    || !text(visit,['cliente_nombre','fecha','titulo','observaciones','drive_url'])
    || !/^\d{4}-\d{2}-\d{2}$/.test(visit.fecha)
    || !Array.isArray(visit.participante_ids) || visit.participante_ids.some(id=>!Number.isSafeInteger(id)||id<=0)
    || !validItems(visit.videos,'videos') || !validItems(visit.fotos,'fotos'))
    throw new Error('No se pudo verificar el detalle completo de la visita. Conservamos tus campos; cargá la versión guardada.');
  return visit;
}

// No requests or retries. An edit owns its observation, not the newest prop.
export function createProductionDraft(initialVisit, initialDraft) {
  verifiedProductionDraftVisit(initialVisit);
  let visit = clone(initialVisit), draft = clone(initialDraft), baseline = JSON.stringify(initialDraft);
  let pending = false, blocked = false, uncertain = false, saved = false, operation = null;
  const dirty = () => JSON.stringify(draft) !== baseline;
  function accept(nextVisit, nextDraft) {
    verifiedProductionDraftVisit(nextVisit,visit.id);
    if (!validVisit(nextVisit) || nextVisit.id !== visit.id || nextVisit.revision < visit.revision) throw conflict();
    visit = clone(nextVisit); draft = clone(nextDraft); baseline = JSON.stringify(nextDraft);
    pending = false; blocked = false; uncertain = false; saved = false; operation = null;
  }
  return Object.freeze({
    get snapshot() { return { visit: clone(visit), draft: clone(draft), dirty: dirty(), pending, blocked, uncertain, saved }; },
    observe(nextVisit, nextDraft) {
      try{verifiedProductionDraftVisit(nextVisit,visit.id);}catch{blocked=true;return;}
      if (!validVisit(nextVisit) || nextVisit.id !== visit.id) { blocked = true; return; }
      // A verified write/read may arrive before React publishes its new props.
      if (nextVisit.revision < visit.revision || pending || blocked) return;
      const changed = nextVisit.revision !== visit.revision || JSON.stringify(nextDraft) !== baseline;
      if (!changed) return;
      if (dirty()) blocked = true;
      else accept(nextVisit, nextDraft);
    },
    edit(next) { if (!pending) draft = clone(typeof next === 'function' ? next(clone(draft)) : next); },
    begin(latestVisit) {
      if (pending) throw new Error('Hay otra operación en curso.');
      try{verifiedProductionDraftVisit(latestVisit,visit.id);}catch{blocked=true;throw conflict();}
      if (!validVisit(latestVisit) || latestVisit.id !== visit.id || latestVisit.revision !== visit.revision) blocked = true;
      if (blocked) throw conflict();
      pending = true; operation = 'write';
      return { visit: clone(visit), draft: clone(draft) };
    },
    complete(nextVisit, nextDraft) {
      if (operation === 'write' && (!validVisit(nextVisit) || nextVisit.revision <= visit.revision)) throw conflict();
      accept(nextVisit, nextDraft);
    },
    fail(error) {
      pending = false; blocked = true; operation = null;
      saved ||= error?.productionSaved === true;
      uncertain = !saved && ![400, 401, 403, 404, 409].includes(error?.status);
    },
    beginReload(confirmDiscard) {
      if (pending) return false;
      if ((dirty() || uncertain) && confirmDiscard() !== true) return false;
      pending = true; operation = 'reload'; return true;
    },
  });
}

export function productionMediaDraft(item, kind) {
  return kind === 'videos'
    ? { titulo: item?.titulo || '', guion: item?.guion || '', estado: item?.estado || 'planificado', material_url: item?.material_url || '', observaciones: item?.observaciones || '' }
    : { tipo: item?.tipo || '', estado: item?.estado || 'realizada', drive_url: item?.drive_url || '', observaciones: item?.observaciones || '' };
}
export function productionVisitDraft(visit) {
  return { fecha: visit.fecha, titulo: visit.titulo, participante_ids: visit.participante_ids || [], drive_url: visit.drive_url || '', observaciones: visit.observaciones || '' };
}
