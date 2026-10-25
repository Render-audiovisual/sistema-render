// Same-owner observations only; callers fence session, task and read lifetime.
// The second input contains POSTs confirmed since that read's reset baseline.
export function mergeTaskComments(read, confirmed, taskId) {
  const invalid = () => { throw new Error('No se pudo verificar la lista de comentarios. Conservamos los comentarios confirmados.'); };
  if (!Array.isArray(read) || !Array.isArray(confirmed)) invalid();
  const byId = new Map();
  for (const item of [...read, ...confirmed]) {
    if (!Number.isSafeInteger(item?.id) || item.id <= 0 || item.id > 2147483647
      || item.tarea_id !== taskId || typeof item.autor !== 'string' || typeof item.contenido !== 'string'
      || typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at))) invalid();
    if(item.actor_usuario_id!=null&&(!Number.isSafeInteger(item.actor_usuario_id)||item.actor_usuario_id<=0||item.actor_usuario_id>2147483647))invalid();
    const previous = byId.get(item.id);
    if (previous && ['tarea_id', 'autor', 'contenido', 'created_at'].some(key => previous[key] !== item[key])) invalid();
    if(previous&&(previous.actor_usuario_id??null)!==(item.actor_usuario_id??null))invalid();
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => {
    return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;
  });
}
