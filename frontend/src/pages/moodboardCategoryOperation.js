import { isSessionFailure } from '../shared/session/captured-request.js';
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const fail = message => new Error(message);
export function moodboardCategoryDraftDirty(baseline, draft, newName) {
  return newName !== '' || baseline.length !== draft.length
    || draft.some(row => !baseline.some(original => original.id === row.id && original.nombre === row.nombre));
}
function categoryList(value, boardId) {
  if (!Array.isArray(value) || value.some(row => !positive(row?.id) || typeof row.nombre !== 'string' || !row.nombre.trim()
    || !Number.isSafeInteger(row.orden) || Object.hasOwn(row, 'board_id') && row.board_id !== boardId) || new Set(value.map(row => row.id)).size !== value.length) {
    throw fail('No se pudo verificar la lista de categorías de este tablero.');
  }
  return value.map(({ id, nombre, orden }) => Object.freeze({ id, nombre, orden }));
}
function categoryAck(value, boardId, step) {
  if (!positive(value?.id) || value.board_id !== boardId || value.nombre !== step.name || !Number.isSafeInteger(value.orden)
    || step.kind === 'rename' && value.id !== step.id) throw fail('No se pudo confirmar la categoría guardada en este tablero.');
  return { id: value.id, nombre: value.nombre, orden: value.orden };
}

// These APIs have neither a batch transaction nor mutation receipts/CAS.
// Stop at the first failure. Recovery reads current data, NEVER resumes writes.
export function createMoodboardCategoryOperation({ boardId, categories, capture, refresh }) {
  if (!positive(boardId)) throw fail('Tablero inválido.');
  let baseline = categoryList(categories, boardId), guard = null, plan = [], completed = [], failed = null;
  let phase = 'idle', busy = false, kind = null, reviewed = null;
  const current = () => Boolean(guard?.current());
  function start(steps, operationKind) {
    if (busy || phase !== 'idle') throw fail('Este guardado requiere revisión. No repetiremos sus pasos.');
    guard = capture(); guard.assertCurrent(); plan = steps; completed = []; failed = null; reviewed = null; kind = operationKind;
  }
  async function read() {
    guard.assertCurrent();
    const value = await refresh(guard); guard.assertCurrent();
    const rows = categoryList(value?.categories, boardId);
    reviewed = rows; phase = 'reviewed'; return { categories: rows, scope: guard };
  }
  async function send() {
    busy = true; phase = 'writing';
    try {
      for (const step of plan) {
        guard.assertCurrent();
        try {
          const value = await guard.request(step.url, { method: step.method,
            ...(step.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: step.body }) });
          guard.assertCurrent();
          let id = step.id;
          if (step.kind === 'delete') {
            if (value !== null) throw fail('No se pudo confirmar la eliminación de la categoría.');
          } else {
            const saved = categoryAck(value, boardId, step); id = saved.id;
            if (step.kind === 'create' && baseline.some(row => row.id === id)) throw fail('La respuesta no confirma una categoría nueva.');
          }
          completed.push(Object.freeze({ kind: step.kind, id, name: step.name ?? null }));
        } catch (error) {
          failed = Object.freeze({ kind: step.kind, id: step.id ?? null, name: step.name ?? null });
          phase = !current() || isSessionFailure(error) || error?.status === 401 ? 'blocked'
            : [400,403,404,409,413,422].includes(error?.status) ? 'failed' : 'uncertain';
          throw error;
        }
      }
      try { const result = await read(); phase = 'complete'; return result; }
      catch (error) { phase = !current() || isSessionFailure(error) ? 'blocked' : 'read_failed'; throw error; }
    } finally { busy = false; }
  }
  return Object.freeze({
    get snapshot() { return Object.freeze({ phase, busy, kind, completed: [...completed], failed, reviewed: reviewed && [...reviewed] }); },
    async save(draft, newName = '') {
      if (busy || phase !== 'idle') throw fail('Verificá el guardado parcial antes de otro cambio.');
      if (!Array.isArray(draft) || typeof newName !== 'string' || draft.some(row => !positive(row?.id)
        || !baseline.some(existing => existing.id === row.id) || typeof row.nombre !== 'string' || !row.nombre.trim())
        || new Set(draft.map(row => row.id)).size !== draft.length) throw fail('Revisá los nombres y las categorías del tablero antes de guardar.');
      const steps = draft.filter(row => row.changed && row.nombre.trim() !== baseline.find(item => item.id === row.id).nombre)
        .map(row => Object.freeze({ kind: 'rename', id: row.id, name: row.nombre.trim(), method: 'PATCH',
          url: `/api/moodboards/categories/${row.id}`, body: JSON.stringify({ name: row.nombre.trim() }) }));
      if (newName.trim()) steps.push(Object.freeze({ kind: 'create', name: newName.trim(), method: 'POST',
        url: `/api/moodboards/boards/${boardId}/categories`, body: JSON.stringify({ name: newName.trim() }) }));
      start(steps, 'save'); return send();
    },
    async remove(id) {
      if (!positive(id) || !baseline.some(row => row.id === id)) throw fail('La categoría no pertenece a la lista observada de este tablero.');
      start([Object.freeze({ kind: 'delete', id, method: 'DELETE', url: `/api/moodboards/categories/${id}` })], 'delete'); return send();
    },
    async refresh() {
      if (busy || !guard || phase === 'idle' || phase === 'blocked') throw fail('No hay un guardado que se pueda revisar desde este contexto.');
      busy = true;
      try { return await read(); }
      catch (error) { phase = !current() || isSessionFailure(error) ? 'blocked' : 'read_failed'; throw error; }
      finally { busy = false; }
    },
    finish() {
      if (busy || !reviewed || !guard || !['reviewed','complete'].includes(phase)) throw fail('Actualizá y revisá las categorías antes de finalizar.');
      guard.assertCurrent(); phase = 'complete'; return { categories: [...reviewed], scope: guard };
    },
    acceptRemoval() {
      if (kind !== 'delete' || phase !== 'complete' || completed.length !== 1 || failed || !reviewed || busy) throw fail('La eliminación todavía requiere revisión.');
      guard.assertCurrent(); baseline = [...reviewed]; const result = { categories: [...reviewed], removedId: completed[0].id };
      phase = 'idle'; kind = null; guard = null; plan = []; completed = []; reviewed = null; return result;
    },
  });
}
