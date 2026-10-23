// In-memory data-loss guard, not persistence or authorization. It retains only
// field generations/intent identities, never story text or credentials.
export function createStoryCellDraft() {
  const edits = new Map(), pending = new Map(), blocked = new Set();
  let observation = Object.freeze({});
  const changed = () => { observation = Object.freeze({}); };
  const keysFor = (id, fields) => {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !fields || typeof fields !== 'object' || Array.isArray(fields)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(fields)) || !Object.keys(fields).length) throw new Error('Edición de historia inválida.');
    return Object.keys(fields).flatMap(key => {
      // Sheet metadata PATCHes are partial (hora/tipo), not replacements of
      // the entire bag. Confirm only the submitted subkeys; do not read values.
      const metadata = key === 'metadata' ? Object.getOwnPropertyDescriptor(fields, key)?.value : null;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        && [Object.prototype, null].includes(Object.getPrototypeOf(metadata)) && Object.keys(metadata).length) {
        return Object.keys(metadata).map(field => JSON.stringify([key, field]));
      }
      return [JSON.stringify([key])];
    });
  };
  const has = id => blocked.has(id) || edits.has(id) || [...pending.values()].some(intent => intent.id === id);
  return {
    get observation() { return observation; },
    get snapshot() { return Object.freeze({ dirty: edits.size > 0 || blocked.size > 0, busy: pending.size > 0, blocked: blocked.size > 0 }); },
    has,
    isEdited(id, fields) { return keysFor(id, fields).some(key => edits.get(id)?.has(key)); },
    edit(id, fields) {
      const keys = keysFor(id, fields), current = edits.get(id) || new Map();
      for (const key of keys) current.set(key, Object.freeze({}));
      edits.set(id, current); changed();
    },
    begin(id, fields) {
      const keys = keysFor(id, fields);
      if (blocked.has(id)) throw new Error('No se confirmó el guardado anterior. Conservamos el texto local; recargá para verificar antes de guardar de nuevo.');
      const current = edits.get(id) || new Map();
      for (const key of keys) if (!current.has(key)) current.set(key, Object.freeze({}));
      edits.set(id, current);
      const token = Object.freeze({});
      pending.set(token, { id, versions: new Map(keys.map(key => [key, current.get(key)])) });
      changed(); return token;
    },
    canDispatch(token) { const intent = pending.get(token); return Boolean(intent && !blocked.has(intent.id)); },
    // Caller may associate a duplicate blur only after verifying the exact
    // immutable request body and scope match. Never acknowledge a new value.
    follow(token, fields) {
      const intent = pending.get(token);
      if (!intent || blocked.has(intent.id)) return false;
      const keys = keysFor(intent.id, fields);
      if (keys.length !== intent.versions.size || keys.some(key => !intent.versions.has(key))) return false;
      const current = edits.get(intent.id);
      for (const key of keys) if (current?.has(key)) intent.versions.set(key, current.get(key));
      changed(); return true;
    },
    succeed(token) {
      const intent = pending.get(token); if (!intent) return false;
      const current = edits.get(intent.id);
      for (const [key, version] of intent.versions) if (current?.get(key) === version) current.delete(key);
      if (current?.size === 0) edits.delete(intent.id);
      pending.delete(token); changed(); return true;
    },
    fail(token) {
      const intent = pending.get(token); if (!intent) return false;
      blocked.add(intent.id); pending.delete(token); changed(); return true;
    },
    preserve(rows, currentRows) {
      const current = new Map(currentRows.map(row => [row.id, row])), seen = new Set();
      const result = rows.map(row => { seen.add(row.id); return has(row.id) && current.has(row.id) ? current.get(row.id) : row; });
      for (const row of currentRows) if (!seen.has(row.id) && has(row.id)) result.push(row);
      return result;
    },
  };
}
