import { isSessionFailure } from '../session/captured-request.js';

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export function verifiedEditorialCreation(value, requestId, domain) {
  const receipt = value?.creation;
  if (!positive(value?.id) || !receipt || receipt.request_id !== requestId || receipt.dominio !== domain
    || receipt.pieza_id !== value.id || !positive(receipt.tarea_id) || typeof receipt.replayed !== 'boolean'
    || !Number.isSafeInteger(value?.publicacion_evidencia?.revision) || value.publicacion_evidencia.revision < 0) {
    throw new Error('No se pudo confirmar qué pieza se creó. Conservamos el intento para verificarlo.');
  }
  return value;
}

// Memory-only, scoped to the original account/context. Verification is an
// explicit user action, never an automatic POST or a new key after ambiguity.
export function createEditorialCreateIntent({ capture, randomUUID = () => globalThis.crypto.randomUUID() }) {
  let intent = null, saved = null, busy = false, phase = 'idle';
  async function send() {
    if (busy || !intent || phase === 'blocked') throw new Error('Revisá la creación pendiente antes de crear otra pieza.');
    const own = intent; own.scope.assertCurrent(); busy = true; phase = 'pending';
    try {
      const response = await own.scope.request('/api/editorial-creaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: own.body });
      own.scope.assertCurrent();
      saved = verifiedEditorialCreation(response, own.requestId, own.domain);
      phase = 'confirmed'; return saved;
    } catch (error) {
      if (!own.scope.current() || isSessionFailure(error) || [401, 403, 409].includes(error?.status)) phase = 'blocked';
      else if ([400, 413, 422, 428].includes(error?.status)) { intent = null; phase = 'idle'; }
      else phase = 'uncertain';
      throw error;
    } finally { busy = false; }
  }
  return Object.freeze({
    get snapshot() { return Object.freeze({ busy, phase, locked: Boolean(intent), savedId: saved?.id ?? null }); },
    async submit(data, scope = capture()) {
      scope.assertCurrent();
      if (intent || busy) throw new Error('Hay una creación pendiente. Verificá ese intento antes de crear otra pieza.');
      if (!positive(data?.responsable_id)) throw new Error('Elegí un responsable válido del catálogo.');
      const requestId = randomUUID();
      if (!uuid(requestId)) throw new Error('No se pudo generar un identificador seguro para crear la pieza.');
      intent = Object.freeze({ scope, requestId, domain: data.tipo === 'historia' ? 'historia' : 'publicacion',
        body: JSON.stringify({ ...data, request_id: requestId }) });
      return send();
    },
    async verify() {
      if (!intent || busy || !['uncertain', 'confirmed'].includes(phase)) throw new Error('No hay una creación verificable en este contexto.');
      intent.scope.assertCurrent();
      // A follow-up read/metadata error must never repeat an accepted POST.
      return phase === 'confirmed' ? saved : send();
    },
    complete() {
      if (!intent || busy || phase !== 'confirmed') throw new Error('La creación todavía no está confirmada.');
      intent.scope.assertCurrent(); intent = null; saved = null; phase = 'idle';
    },
  });
}
