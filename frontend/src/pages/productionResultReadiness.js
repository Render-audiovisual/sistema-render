// Advisory only: the server remains authoritative and repeats every check.
// Recording a partial visit never means completing work or publishing content.
export function productionResultReadiness({ videos, fotos, previstos }) {
  if (!Array.isArray(videos) || !Array.isArray(fotos)
    || !Number.isSafeInteger(previstos) || previstos < 0) {
    return { ready: false, reason: 'Actualizá la visita antes de registrar el resultado.' };
  }
  if (!videos.length && !fotos.length) return { ready: false, reason: 'Agregá los videos o las fotos de la visita.' };
  if (videos.some(video => !video || !['grabado', 'pendiente', 'repetir'].includes(video.estado))) {
    return { ready: false, reason: 'Indicá qué videos se grabaron, quedaron pendientes o deben repetirse.' };
  }
  if (videos.some(video => video.estado !== 'grabado' && (typeof video.guion !== 'string' || !video.guion.trim()))) {
    return { ready: false, reason: 'Conservá el guion de cada video pendiente o para repetir.' };
  }
  if (videos.length < previstos) return { ready: false, reason: 'Agregá los videos faltantes como pendientes, con sus guiones.' };
  if (fotos.some(photo => !photo || !['realizada', 'pendiente', 'repetir'].includes(photo.estado))) {
    return { ready: false, reason: 'Revisá el estado de las fotos.' };
  }
  return { ready: true, reason: '', parcial: videos.some(video => video.estado !== 'grabado')
    || fotos.some(photo => photo.estado !== 'realizada') };
}
