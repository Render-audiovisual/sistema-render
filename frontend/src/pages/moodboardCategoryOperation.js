import { isSessionFailure } from '../shared/session/captured-request.js';
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = () => new Error('No se pudo verificar la respuesta de categorías de este tablero.');
export function moodboardCategoryDraftDirty(baseline, draft, newName) {
  return newName !== '' || baseline.length !== draft.length || draft.some(row => !baseline.some(original => original.id === row.id && original.nombre === row.nombre));
}
function snapshot(value, boardId, mutation = false) {
  if (!closed(value, mutation ? ['version','board_id','revision','categories','operation'] : ['version','board_id','revision','categories']) || value.version !== 1 || value.board_id !== boardId || !revision(value.revision)
    || !Array.isArray(value.categories) || value.categories.some(row => !closed(row,['id','nombre','orden']) || !positive(row.id) || typeof row.nombre !== 'string' || !row.nombre.trim() || !Number.isSafeInteger(row.orden))
    || new Set(value.categories.map(row => row.id)).size !== value.categories.length) throw fail();
  return Object.freeze({ version: 1, board_id: boardId, revision: value.revision, categories: Object.freeze(value.categories.map(row => Object.freeze({...row}))) });
}
// Each instance belongs to one effect setup and one captured account/board scope.
export function createMoodboardCategoryOperation({ boardId, capture, refresh, uuid = () => crypto.randomUUID() }) {
  if (!positive(boardId)) throw fail();
  const guard = capture(), url = `/api/moodboards/boards/${boardId}`;
  let baseline = null, reviewed = null, phase = 'unprepared', busy = false, intent = null, accepted = false, canceled = false;
  const check = () => { if (canceled) throw fail(); guard.assertCurrent(); };
  const result = value => ({...value, scope: guard});
  async function run(action) {
    if (busy) throw new Error('Hay una operación en curso.');
    check(); busy = true;
    try { return await action(); }
    catch (error) { if (canceled || !guard.current() || isSessionFailure(error) || [401,403].includes(error?.status)) phase = 'blocked'; throw error; }
    finally { busy = false; }
  }
  async function read() { const value = await guard.request(`${url}/category-snapshot`, {cache:'no-store'}); check(); return snapshot(value, boardId); }
  async function complete() {
    phase = 'read_failed';
    await refresh(guard); check(); phase = 'complete'; return result(reviewed);
  }
  async function send() {
    phase = 'writing';
    try {
      const value = await guard.request(`${url}/category-changes`, {method:'POST',headers:{'Content-Type':'application/json'},body:intent.body});
      check(); const observed = snapshot(value, boardId, true), operation = value.operation;
      if (!closed(operation,['request_id','replayed','result_revision']) || operation.request_id !== intent.id || typeof operation.replayed !== 'boolean'
        || !revision(operation.result_revision) || operation.result_revision <= baseline.revision || observed.revision < operation.result_revision
        || !operation.replayed && observed.revision !== operation.result_revision) throw fail();
      accepted = true; reviewed = observed;
    } catch (error) { phase = [400,404,409,413,422,428].includes(error?.status) ? 'conflict' : 'uncertain'; throw error; }
    return complete();
  }
  return Object.freeze({
    get snapshot() { return Object.freeze({phase,busy,reviewed,accepted}); },
    cancel() { canceled = true; },
    prepare() { return run(async () => { if (phase !== 'unprepared') throw fail(); const value = await read(); baseline = value; phase = 'idle'; return result(value); }); },
    save(draft, newName = '') { return run(async () => {
      if (phase !== 'idle' || !baseline) throw fail();
      if (!Array.isArray(draft) || typeof newName !== 'string' || draft.some(row => !positive(row?.id) || !baseline.categories.some(old => old.id === row.id) || typeof row.nombre !== 'string' || !row.nombre.trim()) || new Set(draft.map(row=>row.id)).size !== draft.length) throw fail();
      const changes = baseline.categories.flatMap(old => { const row = draft.find(item=>item.id === old.id); return !row ? [{type:'delete',id:old.id}] : row.nombre.trim() !== old.nombre ? [{type:'rename',id:old.id,name:row.nombre.trim()}] : []; });
      if (newName.trim()) changes.push({type:'create',name:newName.trim()});
      if (!changes.length) throw new Error('No hay cambios para guardar.');
      const id = uuid(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw fail();
      intent = Object.freeze({id,body:JSON.stringify({request_id:id,expected_revision:baseline.revision,changes})});
      return send();
    }); },
    verify() { return run(async () => { if (accepted && phase === 'read_failed') return complete(); if (phase !== 'uncertain' || !intent) throw fail(); return send(); }); },
    refresh() { return run(async () => { if (phase !== 'conflict') throw fail(); reviewed = await read(); return result(reviewed); }); },
    adoptReviewed() { check(); if (busy || phase !== 'conflict' || !reviewed) throw fail(); baseline = reviewed; reviewed = null; intent = null; accepted = false; phase = 'idle'; return result(baseline); },
  });
}
