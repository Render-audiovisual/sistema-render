const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) && value.length === 36;
const id = value => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && text.trim() === text && /^[1-9][0-9]{0,18}$/.test(text) && text.length <= 19
    && (text.length < 19 || text <= '9223372036854775807') ? text : '';
};
const version = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const position = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string';
const date = value => text(value) && value.length > 0 && Number.isFinite(Date.parse(value));
const unique = rows => rows.every(object) && new Set(rows.map(row => String(row.id))).size === rows.length;
const localRows = rows => Array.isArray(rows) && rows.every(row => object(row) && text(row.id) && row.id.length > 0) && unique(rows);
export function personalListBlockContentValid(type, content) {
  if (!object(content)) return false;
  if (type === 'texto') return text(content.texto);
  if (type === 'listado' || type === 'checklist') return text(content.titulo) && localRows(content.items)
    && content.items.every(row => text(row.texto) && (type !== 'checklist' || typeof row.completado === 'boolean'));
  if (type !== 'tabla' || !text(content.titulo) || !localRows(content.columnas) || !content.columnas.length
    || !content.columnas.every(row => text(row.titulo)) || !localRows(content.filas)) return false;
  return content.filas.every(row => object(row.celdas) && content.columnas.every(column => {
    const cell = row.celdas[column.id];
    return object(cell) && text(cell.texto) && typeof cell.completado === 'boolean';
  }));
}

export function personalListBlockRowValid(block, listId) {
  return object(block) && id(block.id) && id(block.lista_id) === id(listId) && version(block.version)
    && position(block.posicion) && personalListBlockContentValid(block.tipo, block.contenido);
}

// A receipt lookup returns CURRENT data, not necessarily the original title or
// blocks. Validate the identity/receipt and renderable schema, never old fields.
export function validatePersonalListCreation(value, requestId) {
  if (!object(value) || !uuid(requestId) || value.creation_request_id !== requestId || !id(value.id)
    || !text(value.titulo) || !value.titulo.trim() || !text(value.emoji) || !version(value.version)
    || !position(value.posicion) || !date(value.created_at) || !date(value.updated_at)
    || !Array.isArray(value.bloques) || !Array.isArray(value.secciones)
    || !unique(value.bloques) || !unique(value.secciones)) throw new Error('No se pudo verificar la página creada.');
  for (const block of value.bloques) {
    if (!personalListBlockRowValid(block, value.id)) throw new Error('No se pudo verificar la página creada.');
  }
  for (const section of value.secciones) {
    if (!object(section) || !id(section.id) || id(section.lista_id) !== id(value.id) || !text(section.titulo)
      || !version(section.version) || !position(section.posicion) || !Array.isArray(section.items) || !unique(section.items)
      || !section.items.every(row => object(row) && id(row.id) && id(row.seccion_id) === id(section.id)
        && text(row.texto) && typeof row.completado === 'boolean' && version(row.version) && position(row.posicion))) {
      throw new Error('No se pudo verificar la página creada.');
    }
  }
  return value;
}

// Keep existing row objects (including unsaved queue drafts); a receipt must not
// overwrite a page already observed/edited locally or append a duplicate BIGINT.
export function reconcilePersonalListCreation(lists, created) {
  return lists.some(row => id(row.id) === id(created.id)) ? lists : [...lists, created];
}

export function createPersonalListCreation({ request, isCurrent, onState = () => {}, onCreated = () => {},
  createRequestId = () => globalThis.crypto.randomUUID() }) {
  let phase = 'idle', intent = null, disposed = false, error = '';
  const snapshot = () => Object.freeze({ phase, error, busy: phase === 'writing' || phase === 'checking',
    unresolved: ['writing', 'checking', 'uncertain', 'missing'].includes(phase),
    canVerify: phase === 'uncertain' || phase === 'missing', canRetry: phase === 'missing',
    canReset: phase === 'rejected' });
  const emit = () => { if (!disposed) { try { onState(snapshot()); } catch { /* Observer cannot resend a write. */ } } };
  const retire = () => { intent = null; phase = 'denied'; error = 'La sesión cambió. Volvé a abrir tu espacio.'; emit(); };
  const current = () => {
    if (disposed || phase === 'denied') return false;
    try { if (isCurrent() === true) return true; } catch { /* Retire private intent. */ }
    retire(); return false;
  };
  const accept = value => {
    const row = validatePersonalListCreation(value, intent.key);
    if (!current()) return false;
    phase = 'confirmed'; error = ''; intent = null;
    // Publish only under the captured lifetime; an onState subscriber may retire it.
    emit(); if (!current()) return false;
    onCreated(row); return true;
  };
  async function send(method) {
    if (!current() || !intent) return false;
    const held = intent;
    phase = method === 'POST' ? 'writing' : 'checking'; error = ''; emit();
    try {
      if (!current() || intent !== held) return false;
      const result = await request(method === 'POST' ? '/api/listas-personales' : `/api/listas-personales/creaciones/${held.key}`,
        method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: held.body } : { method: 'GET', cache: 'no-store' });
      if (!current() || intent !== held) return false;
      return accept(result);
    } catch (reason) {
      if (!current() || intent !== held) return false;
      if (reason?.status === 401 || reason?.status === 403 || reason?.code === 'session_binding_obsolete') { retire(); return false; }
      if (method === 'GET' && reason?.status === 404) {
        phase = 'missing'; error = 'No se encontró el intento. Podés verificar otra vez o reenviar exactamente la misma creación.';
      } else if ((method === 'POST' && [400, 409, 410, 422, 428].includes(reason?.status))
        || (method === 'GET' && [409, 410].includes(reason?.status))) {
        phase = 'rejected'; error = 'La creación fue rechazada. No se recreará automáticamente. Cerrá este intento antes de elegir otra página.';
      } else {
        phase = 'uncertain'; error = 'No sabemos si la página se creó. Verificá la creación antes de iniciar otra.';
      }
      emit(); return false;
    }
  }
  return Object.freeze({ snapshot,
    async start(payload) {
      if (!current() || !['idle', 'confirmed'].includes(phase)) return false;
      try {
        const key = createRequestId(); if (!uuid(key)) throw new Error();
        // Serialize once. Later edits, template changes and retries cannot rebase.
        const body = JSON.stringify({ titulo: payload.titulo, emoji: payload.emoji, bloques: payload.bloques, request_id: key });
        intent = Object.freeze({ key, body });
      } catch { phase = 'rejected'; error = 'No se pudo preparar la creación. Cerrá el intento y revisá la plantilla.'; emit(); return false; }
      return send('POST');
    },
    verify() { return current() && snapshot().canVerify ? send('GET') : Promise.resolve(false); },
    retry() { return current() && phase === 'missing' ? send('POST') : Promise.resolve(false); },
    resetRejected() {
      if (!current() || phase !== 'rejected') return false;
      intent = null; phase = 'idle'; error = ''; emit(); return true;
    },
    dispose() { disposed = true; intent = null; phase = 'denied'; error = ''; },
  });
}
