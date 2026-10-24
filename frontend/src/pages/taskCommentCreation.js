import { mergeTaskComments } from './taskCommentCollection.js';

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const uuid = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const invalid = () => new Error('No se pudo verificar el envío. Conservá el texto y verificá el intento antes de comentar otra vez.');
const text = value => {
  if (typeof value !== 'string' || value.includes('\u0000')) throw invalid();
  return value.trim();
};

// One component/task owner, document-memory only. No timers, storage, background
// reads or automatic POST replay. Discard retires UI ownership, not server work.
export function createTaskCommentCreation({ capture, randomUUID = () => globalThis.crypto.randomUUID(), onState = () => {} }) {
  let phase = 'idle', busy = false, attempt = null, accepted = null, error = '', epoch = 0, disposed = false;
  function live(held) {
    if (disposed || !held || attempt !== held || held.epoch !== epoch) return false;
    try { return held.current() === true; } catch { return false; }
  }
  function retire() {
    epoch++; attempt = null; accepted = null; busy = false; phase = 'blocked'; error = '';
  }
  function snapshot() {
    if (attempt && !live(attempt)) retire();
    const locked = Boolean(attempt && phase !== 'confirmed');
    return Object.freeze({ phase, busy, locked, canVerify: locked && !busy && phase === 'uncertain', error,
      attempt: attempt?.input ?? null, comment: accepted });
  }
  function publish() {
    if (disposed || attempt && !live(attempt)) return;
    try { onState(snapshot()); } catch { /* Observers cannot retry or undo a write. */ }
  }
  function validate(value, held) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.creation_request_id !== held.input.requestId || value.tarea_id !== held.input.taskId
      || value.contenido !== held.input.contenido
      || held.input.validateAuthor && value.autor !== held.input.autor) throw invalid();
    const comment = Object.freeze(Object.fromEntries(
      ['id', 'tarea_id', 'autor', 'contenido', 'created_at', 'creation_request_id'].map(key => [key, value[key]])));
    mergeTaskComments([], [comment], held.input.taskId);
    return comment;
  }
  async function send(held, method) {
    if (!live(held)) return false;
    let confirmed = null;
    busy = true; phase = method === 'POST' ? 'writing' : 'checking'; error = ''; publish();
    try {
      if (!live(held)) return false;
      const value = await held.request(method === 'POST' ? held.postUrl : held.readUrl,
        method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: held.body }
          : { method: 'GET', cache: 'no-store' });
      if (!live(held)) return false;
      const comment = validate(value, held);
      if (!live(held)) return false;
      confirmed = comment; accepted = comment; phase = 'confirmed'; error = '';
    } catch (reason) {
      if (live(held)) {
        const unavailable = [401, 403, 409].includes(reason?.status);
        phase = unavailable ? 'unavailable' : 'uncertain';
        error = unavailable
          ? 'El intento no está disponible o no tenés acceso para verificarlo. Conservá el texto y revisá los comentarios antes de descartar este intento. No se reenviará automáticamente.'
          : invalid().message;
      }
      return false;
    } finally {
      // An old response/finally may not unlock or publish a newer operation.
      if (live(held)) { busy = false; publish(); }
    }
    // Publication is reentrant: the observer may discard, replace the session,
    // or start another intent. Never report the old confirmation afterward.
    return confirmed !== null && live(held) && phase === 'confirmed' && accepted === confirmed;
  }
  return Object.freeze({
    get snapshot() { return snapshot(); },
    start(input) {
      snapshot();
      if (disposed || busy || attempt && phase !== 'confirmed') return Promise.resolve(false);
      let held;
      try {
        const { taskId, autor, contenido, generation, validateAuthor = false } = input ?? {};
        if (!positive(taskId) || !Number.isSafeInteger(generation) || generation < 0 || typeof validateAuthor !== 'boolean') throw invalid();
        const content = text(contenido), author = autor === undefined && !validateAuthor ? '' : text(autor);
        if (!content || validateAuthor && !author) throw invalid();
        const guard = capture();
        if (!guard || typeof guard.current !== 'function' || typeof guard.request !== 'function') throw invalid();
        const current = guard.current.bind(guard), request = guard.request.bind(guard);
        if (current() !== true) { retire(); return Promise.resolve(false); }
        const key = randomUUID(); if (!uuid(key)) throw invalid();
        const requestId = key.toLowerCase();
        const observed = Object.freeze({ taskId, autor: author, contenido: content, generation, validateAuthor, requestId });
        const postUrl = `/api/tareas/${taskId}/comentarios?workspace=render_os`;
        held = Object.freeze({ epoch: ++epoch, input: observed, current, request, postUrl,
          readUrl: `/api/tareas/${taskId}/comentarios/solicitudes/${requestId}?workspace=render_os`,
          body: JSON.stringify({ autor: author, contenido: content, request_id: requestId }) });
        attempt = held; accepted = null;
      } catch {
        // No dispatch took place: no fabricated UUID or recoverable receipt.
        attempt = null; accepted = null; busy = false; phase = 'idle'; error = invalid().message; publish();
        return Promise.resolve(false);
      }
      return send(held, 'POST');
    },
    verify() {
      const state = snapshot();
      return state.canVerify ? send(attempt, 'GET') : Promise.resolve(false);
    },
    discard() {
      epoch++; attempt = null; accepted = null; busy = false; phase = 'idle'; error = ''; publish();
    },
    dispose() { disposed = true; retire(); },
  });
}
