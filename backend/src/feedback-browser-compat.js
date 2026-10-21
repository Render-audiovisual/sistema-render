const invalid = () => Object.assign(new Error('La operación de nota no es válida.'), {status:400});

// Legacy URLs are adapters only: no defaults for identity, UUID or observation,
// and no separate business DML. A dedicated route protects new clients from old
// servers which would otherwise ignore the new transport fields.
export function feedbackBrowserAliasInput(action, req) {
  const body = req.body === undefined ? {} : req.body;
  const query = req.query ?? {};
  if (!['create','edit','trash','restore'].includes(action) || !body || typeof body !== 'object' || Array.isArray(body)
    || !query || typeof query !== 'object' || Array.isArray(query)) throw invalid();
  if (action === 'trash') {
    if (Object.keys(query).some(key => key !== 'permanente')
      || query.permanente !== undefined && !['true','false'].includes(query.permanente)) throw invalid();
    if (query.permanente === 'true') action = 'purge';
  } else if (Object.keys(query).length) throw invalid();
  const writable = ['titulo','contenido','categoria','feedback'];
  const allowed = ['request_id', ...(action === 'create' ? [] : ['expected_updated_at']),
    ...(['create','edit'].includes(action) ? writable : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid();
  const input = {action};
  for (const key of ['request_id','expected_updated_at']) if (Object.hasOwn(body,key)) input[key] = body[key];
  if (action !== 'create') {
    const id = req.params?.id;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))
      || Number(id) > 2147483647 || String(Number(id)) !== id) throw invalid();
    input.note_id = Number(id);
  }
  if (['create','edit'].includes(action)) input.fields = Object.fromEntries(writable.filter(key => Object.hasOwn(body,key)).map(key => [key,body[key]]));
  return input;
}

export function feedbackBrowserAliasBody(result) {
  const {operation,note} = result.body;
  if (['trash','purge'].includes(operation.action)) return {ok:true,operation,note};
  return note ? {...note,operation} : {id:operation.note_id,unavailable:true,operation};
}
