const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
// BIGSERIAL travels as text from pg. Compare canonical decimal strings without
// Number conversion so adjacent IDs above MAX_SAFE_INTEGER stay distinct.
const recordId = value => typeof value === 'number' ? Number.isSafeInteger(value) && value > 0
  : typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const identity = session => ({ id: session?.usuario?.id, token: session?.token,
  role: session?.usuario?.rol, active: session?.usuario?.activo });
const validIdentity = value => positive(value.id) && typeof value.token === 'string' && Boolean(value.token.trim())
  && typeof value.role === 'string' && Boolean(value.role.trim()) && value.active !== false;

// Pure transport coordinator: never reads browser storage or fetches replacement data.
export function createPersonalListSaveQueue({ session, readSession = () => session, request,
  onState = () => {}, onSaved = () => {}, onDenied = () => {}, delayMs = 650, timeoutMs = 15000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const captured = identity(session), entries = new Map(), acknowledged = new Map();
  const debounce = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 650;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
  let generation = 0, disposed = false, denied = false;
  const observe = (callback, value) => { try { callback(value); } catch { /* An observer cannot undo an acknowledged write. */ } };
  function snapshot() {
    const rows = [...entries.values()], busy = rows.some(row => row.flight);
    const failed = rows.find(row => row.error);
    return { status: denied || failed ? 'error' : busy ? 'saving' : rows.length ? 'pending' : 'saved',
      dirty: rows.length > 0, busy, error: denied ? 'La sesión cambió. Volvé a iniciar sesión.' : failed?.error || '',
      conflict: rows.some(row => row.kind === 'conflict'), pending: rows.length };
  }
  const emit = () => { if (!disposed) observe(onState, snapshot()); };
  function cancel() {
    generation += 1;
    for (const row of entries.values()) {
      if (row.timer !== null) clearTimer(row.timer);
      row.flight?.controller.abort();
      row.flight?.cancel();
    }
    entries.clear(); acknowledged.clear();
  }
  function deny() {
    if (disposed || denied) return false;
    denied = true; cancel(); emit(); observe(onDenied); return false;
  }
  function current() {
    if (disposed || denied) return false;
    let live;
    try { live = identity(readSession()); } catch { return deny(); }
    return validIdentity(captured) && validIdentity(live)
      && ['id', 'token', 'role', 'active'].every(key => live[key] === captured[key]) ? true : deny();
  }
  function clearDebounce(row) {
    if (row.timer !== null) clearTimer(row.timer);
    row.timer = null;
  }
  function arm(row) {
    clearDebounce(row);
    row.timer = setTimer(() => {
      row.timer = null; row.ready = true;
      if (!row.kind) void send(row);
    }, debounce);
  }
  function schedule({ key, url, version, payload, merge = false, meta } = {}) {
    if (!current()) return false;
    if (typeof key !== 'string' || !key || typeof url !== 'string' || !url.startsWith('/api/listas-personales/')
      || url.startsWith('//') || url.includes('#') || !positive(version) || !object(payload)
      || !object(meta) || !recordId(meta.listId) || !recordId(meta.recordId)
      || (meta.blockId !== undefined && !recordId(meta.blockId))) return false;
    let desired, metadata;
    try { desired = clone(payload); metadata = clone(meta); } catch { return false; }
    const old = entries.get(key), known = old || acknowledged.get(key);
    if (known && (known.url !== url || ['listId', 'blockId', 'recordId'].some(field => known.meta[field] !== metadata[field]))) return false;
    const row = old || { key, url, meta: metadata, version: known?.version ?? version, seq: 0, timer: null, flight: null,
      ready: false, error: '', kind: '', retrySent: null };
    row.payload = merge && old ? { ...row.payload, ...desired } : desired;
    row.seq += 1;
    if (row.kind === 'invalid') { row.kind = ''; row.error = ''; row.retrySent = null; }
    row.ready = false;
    entries.set(key, row);
    if (row.kind === 'conflict') {
      // Keep the latest local draft coherent, but only explicit discard/reload
      // may leave conflict. Typing never authorizes a retry or a CAS rebase.
      clearDebounce(row); emit(); return true;
    }
    arm(row); emit(); return true;
  }
  function send(row, replay = false) {
    if (!current()) return Promise.resolve(false);
    if (row.flight) return row.flight.promise;
    if (entries.get(row.key) !== row || (row.kind && !(replay && row.kind === 'uncertain'))) return Promise.resolve(false);
    clearDebounce(row);
    const sent = replay && row.retrySent ? row.retrySent : { seq: row.seq, version: row.version,
      payload: clone(row.payload), body: JSON.stringify({ ...clone(row.payload), expected_version: row.version }) };
    // Once sent, metadata fields are no longer pending. New metadata edits merge
    // only with other unsent edits, never with an ACK's server row or sent fields.
    if (!replay) row.payload = null;
    const stamp = generation, controller = new AbortController();
    let cancel, timer;
    const cancelled = new Promise(resolve => { cancel = () => resolve({ cancelled: true }); });
    const timed = new Promise(resolve => { timer = setTimer(() => {
      controller.abort(); resolve({ error: new Error('El guardado tardó demasiado. Reintentá el mismo cambio.') });
    }, timeout); });
    row.ready = false; row.error = ''; row.kind = '';
    const flight = { controller, cancel, promise: null };
    row.flight = flight;
    flight.promise = (async () => {
      // Defer transport until the flight object is installed, including synchronous mocks/throws.
      const transport = Promise.resolve().then(() => {
        if (stamp !== generation || disposed || denied || !current()) return { cancelled: true };
        return Promise.resolve(request(row.url, { method: 'PATCH', headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}`,
        }, body: sent.body, signal: controller.signal })).then(value => ({ value }));
      }).catch(error => ({ error }));
      const result = await Promise.race([transport, timed, cancelled]);
      clearTimer(timer);
      if (stamp !== generation || disposed || denied || result.cancelled || entries.get(row.key) !== row) return false;
      if (!current()) return false;
      if (result.error?.status === 401 || result.error?.status === 403) return deny();
      let error = result.error;
      if (!error && (!object(result.value) || result.value.id !== row.meta.recordId
        || !positive(result.value.version) || result.value.version <= sent.version)) {
        error = new Error('La respuesta de guardado no coincide con el registro observado.');
      }
      row.flight = null;
      if (error) {
        if (row.payload === null) row.payload = clone(sent.payload);
        row.error = typeof error.message === 'string' && error.message ? error.message : 'No se pudo guardar. Reintentá.';
        row.kind = error.status === 409 ? 'conflict' : [400, 413, 422].includes(error.status) ? 'invalid' : 'uncertain';
        row.retrySent = row.kind === 'uncertain' ? sent : null;
        emit(); return false;
      }
      row.version = result.value.version; row.retrySent = null;
      acknowledged.set(row.key, { url: row.url, meta: clone(row.meta), version: row.version });
      const hasNewer = row.seq !== sent.seq;
      if (!hasNewer) { clearDebounce(row); entries.delete(row.key); }
      observe(onSaved, { key: row.key, meta: clone(row.meta), row: clone(result.value), hasNewer });
      if (stamp !== generation || disposed || denied || !current()) return false;
      emit();
      if (hasNewer && entries.get(row.key) === row && row.ready && !row.timer && !row.kind) void send(row);
      return true;
    })();
    emit(); return flight.promise;
  }
  async function drain(retryErrors) {
    if (!current()) return false;
    const stamp = generation;
    while (!disposed && !denied && stamp === generation) {
      const rows = [...entries.values()];
      if (!rows.length) return true;
      let blocked = false;
      const work = rows.map(row => {
        clearDebounce(row); row.ready = true;
        if (row.flight) return row.flight.promise;
        if (row.kind && !(retryErrors && row.kind === 'uncertain')) { blocked = true; return Promise.resolve(false); }
        return send(row, retryErrors && row.kind === 'uncertain');
      });
      const results = await Promise.all(work);
      if (blocked || results.some(value => !value)) return false;
    }
    return false;
  }
  return { schedule, flush: () => drain(false), retry: () => drain(true), snapshot,
    discard() { if (!disposed) { cancel(); emit(); } },
    dispose() { if (!disposed) { disposed = true; cancel(); } },
  };
}
