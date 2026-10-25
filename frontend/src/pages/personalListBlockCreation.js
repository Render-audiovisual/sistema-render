import {personalListId} from './personalListLocation.js';
import {personalListBlockContentValid,personalListBlockRowValid} from './personalListCreation.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

// Share the actual page block schema without inventing a parent or row values.
export function validatePersonalListBlockCreation(value, listId, requestId) {
  const parent = personalListId(listId);
  if (!parent || !object(value) || !uuid(requestId) || value.creation_request_id !== requestId
    || personalListId(value.lista_id) !== parent) throw new Error('No se pudo verificar el bloque creado.');
  if(!personalListBlockRowValid(value,parent)
    || !['created_at','updated_at'].every(key=>typeof value[key]==='string'&&value[key].length>0&&Number.isFinite(Date.parse(value[key]))))
    throw new Error('No se pudo verificar el bloque creado.');
  return value;
}

// A recovered receipt contains CURRENT server data. Never overwrite an existing
// local block (possibly with queued drafts) or create/navigate to another list.
export function reconcilePersonalListBlockCreation(lists, created) {
  const parent = personalListId(created?.lista_id), id = personalListId(created?.id);
  if (!parent || !id) return lists;
  const index = lists.findIndex(list => personalListId(list.id) === parent);
  if (index < 0 || lists[index].bloques?.some(block => personalListId(block.id) === id)) return lists;
  const next = [...lists];
  next[index] = {...lists[index], bloques: [...(lists[index].bloques || []), created]};
  return next;
}

// Page-instance memory only: the owner supplies a captured session/mount
// lifetime, not the selected list. Navigation among lists must not rebind intent.
export function createPersonalListBlockCreation({request, isCurrent, onState = () => {}, onCreated = () => {},
  createRequestId = () => globalThis.crypto.randomUUID()}) {
  let phase = 'idle', error = '', intent = null, disposed = false, generation = 0;
  const usedKeys = new Set();
  const snapshot = () => Object.freeze({phase, error, listId: intent?.listId ?? null,
    busy: phase === 'writing' || phase === 'checking',
    unresolved: ['writing', 'checking', 'uncertain', 'missing'].includes(phase),
    canVerify: phase === 'uncertain' || phase === 'missing', canRetry: phase === 'missing', canReset: phase === 'rejected'});
  const emit = () => {if (!disposed) {try {onState(snapshot());} catch { /* Observer cannot authorize a replay. */ }}};
  const retire = () => {generation++; intent = null; phase = 'denied'; error = 'La sesión cambió. Volvé a abrir tu espacio.'; emit();};
  const current = () => {
    if (disposed || phase === 'denied') return false;
    try {if (isCurrent() === true) return true;} catch { /* Retire private intent. */ }
    retire(); return false;
  };
  function accept(value, held) {
    const row = validatePersonalListBlockCreation(value, held.listId, held.key);
    if (!current() || intent !== held) return false;
    phase = 'confirmed'; error = ''; intent = null;
    const observation = ++generation;
    emit();
    if (!current() || generation !== observation) return false;
    try {onCreated(row);} catch { /* ACK remains confirmed; a subscriber cannot cause another POST. */ }
    return true;
  }
  async function send(method) {
    if (!current() || !intent) return false;
    const held = intent;
    phase = method === 'POST' ? 'writing' : 'checking'; error = ''; emit();
    try {
      if (!current() || intent !== held) return false;
      const base = `/api/listas-personales/${held.listId}/bloques`;
      const value = await request(method === 'POST' ? base : `${base}/creaciones/${held.key}`,
        method === 'POST' ? {method, headers: {'Content-Type': 'application/json'}, body: held.body}
          : {method: 'GET', cache: 'no-store'});
      if (!current() || intent !== held) return false;
      return accept(value, held);
    } catch (reason) {
      if (!current() || intent !== held) return false;
      if ([401, 403].includes(reason?.status) || reason?.code === 'session_binding_obsolete') {retire(); return false;}
      if (method === 'GET' && reason?.status === 404) {
        phase = 'missing'; error = 'No se encontró el intento. Podés verificar otra vez o reenviar exactamente el mismo bloque.';
      } else if ((method === 'POST' && [400, 404, 409, 410, 413, 422, 428].includes(reason?.status))
        || (method === 'GET' && [409, 410].includes(reason?.status))) {
        phase = 'rejected'; error = 'La creación fue rechazada. No se recreará automáticamente. Cerrá este intento antes de agregar otro bloque.';
      } else {
        phase = 'uncertain'; error = 'No sabemos si el bloque se creó. Verificá el intento antes de agregar otro.';
      }
      emit(); return false;
    }
  }
  return Object.freeze({snapshot,
    async create(listId, payload) {
      if (!current() || !['idle', 'confirmed'].includes(phase)) return false;
      try {
        const parent = personalListId(listId), key = createRequestId();
        if (!parent || !uuid(key) || usedKeys.has(key) || !object(payload)) throw new Error();
        const body = JSON.stringify({request_id: key, tipo: payload.tipo, contenido: payload.contenido});
        const frozen = JSON.parse(body);
        if(!personalListBlockContentValid(frozen.tipo,frozen.contenido))throw new Error();
        usedKeys.add(key); generation++;
        intent = Object.freeze({listId: parent, key, body});
      } catch {
        phase = 'rejected'; error = 'No se pudo preparar el bloque. Cerrá el intento y revisá su contenido.'; emit(); return false;
      }
      return send('POST');
    },
    verify() {return current() && snapshot().canVerify ? send('GET') : Promise.resolve(false);},
    retry() {return current() && phase === 'missing' ? send('POST') : Promise.resolve(false);},
    resetRejected() {
      if (!current() || phase !== 'rejected') return false;
      generation++; intent = null; phase = 'idle'; error = ''; emit(); return true;
    },
    dispose() {disposed = true; generation++; intent = null; phase = 'denied'; error = '';},
  });
}
