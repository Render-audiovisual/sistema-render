// Presentation only: the server remains authoritative for reviewed dimensions.
export const hasReviewedProductionContext = visit => visit?.contexto_historico_revisado === true;

export function productionVisitEditInput(visit, draft) {
  const input = {
    titulo: draft.titulo,
    participante_ids: draft.participante_ids,
    drive_url: draft.drive_url,
    observaciones: draft.observaciones,
  };
  if (!hasReviewedProductionContext(visit)) input.fecha = draft.fecha;
  return input;
}
