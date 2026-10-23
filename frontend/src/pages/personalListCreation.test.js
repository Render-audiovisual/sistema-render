import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalListCreation, validatePersonalListCreation, reconcilePersonalListCreation } from './personalListCreation.js';

const key = '10000000-0000-4000-8000-000000000164';
const otherKey = '20000000-0000-4000-8000-000000000164';
const payload = () => ({ titulo: 'Nueva', emoji: '📝', bloques: [{ tipo: 'texto', contenido: { texto: 'Original' } }] });
const row = (requestId = key, id = '9007199254740993') => ({ id, titulo: 'Nueva', emoji: '📝', posicion: 0, version: 1,
  created_at: '2026-10-23T12:00:00.000Z', updated_at: '2026-10-23T12:00:00.000Z', creation_request_id: requestId,
  secciones: [{ id: '11', lista_id: id, titulo: 'Pendientes', posicion: 0, version: 1, items: [] }],
  bloques: [{ id: '12', lista_id: id, tipo: 'texto', posicion: 0, version: 1, contenido: { texto: 'Original' } }] });
const failure = status => Object.assign(new Error('UNTRUSTED raw transport detail'), { status });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(request) {
  const calls = [], states = [], created = []; let current = true, nextKey = key;
  const model = createPersonalListCreation({ request: async (...args) => { calls.push(args); return request(...args); },
    isCurrent: () => current, onState: state => states.push(state), onCreated: value => created.push(value), createRequestId: () => nextKey });
  return { model, calls, states, created, retire() { current = false; }, next() { nextKey = otherKey; } };
}

test('fresh create sends one exact body, accepts valid current schema and intentional next create uses a new UUID', async () => {
  const f = fixture(async (_, options) => row(JSON.parse(options.body).request_id));
  assert.equal(await f.model.start(payload()), true); assert.equal(f.created.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { ...payload(), request_id: key });
  assert.equal(f.model.snapshot().phase, 'confirmed'); assert.equal(f.model.snapshot().unresolved, false);
  f.next(); assert.equal(await f.model.start(payload()), true);
  assert.equal(JSON.parse(f.calls[1][1].body).request_id, otherKey);
});

test('lost ACK blocks new creation; GET recovers CURRENT edited row without a second POST', async () => {
  const fresh = row(); fresh.titulo = 'Editada por otra pestaña'; fresh.version = 3;
  const f = fixture(async (_, options) => { if (options.method === 'POST') throw failure(503); return fresh; });
  assert.equal(await f.model.start(payload()), false);
  assert.equal(f.model.snapshot().phase, 'uncertain'); assert.equal(f.model.snapshot().unresolved, true);
  assert.equal(await f.model.start(payload()), false); assert.equal(await f.model.retry(), false); assert.equal(f.calls.length, 1);
  assert.equal(await f.model.verify(), true);
  assert.deepEqual(f.calls[1], [`/api/listas-personales/creaciones/${key}`, { method: 'GET', cache: 'no-store' }]);
  assert.equal(f.created[0], fresh); assert.equal(f.calls.filter(([, o]) => o.method === 'POST').length, 1);
});

test('404 permits only explicit same-POST retry with original frozen key/body even after template mutation', async () => {
  let writes = 0;
  const f = fixture(async (_, options) => { if (options.method === 'GET') throw failure(404); if (++writes === 1) throw new Error('network'); return row(); });
  const original = payload(); await f.model.start(original); const body = f.calls[0][1].body;
  original.titulo = 'Changed'; original.bloques[0].contenido.texto = 'Changed'; f.next();
  await f.model.verify(); assert.equal(f.model.snapshot().phase, 'missing'); assert.equal(f.calls.length, 2);
  assert.equal(await f.model.start(original), false);
  assert.equal(await f.model.retry(), true); assert.equal(f.calls[2][1].body, body);
  assert.equal(f.created.length, 1);
});

test('malformed ACK, 5xx and network errors keep uncertain intent; repeated verification never silently POSTs', async () => {
  for (const issue of ['malformed', 'network', 500, 502, 503]) {
    const f = fixture(async () => { if (issue === 'malformed') return { ...row(), creation_request_id: otherKey }; throw failure(issue); });
    await f.model.start(payload()); assert.equal(f.model.snapshot().phase, 'uncertain', String(issue));
    await f.model.verify(); await f.model.verify();
    assert.equal(f.calls.length, 3); assert.equal(f.calls.filter(([, o]) => o.method === 'POST').length, 1);
    assert.equal(f.created.length, 0); assert.equal(f.model.resetRejected(), false);
    assert.doesNotMatch(f.model.snapshot().error, /UNTRUSTED/);
  }
});

test('definitive input rejection requires explicit close, then a deliberate new create can correct the fields', async () => {
  for (const status of [400, 409, 410, 422, 428]) {
    let reject = true;
    const f = fixture(async (_, options) => { if (reject) throw failure(status); return row(JSON.parse(options.body).request_id); });
    await f.model.start(payload()); assert.equal(f.model.snapshot().phase, 'rejected');
    assert.equal(await f.model.start(payload()), false); assert.equal(await f.model.retry(), false); assert.equal(await f.model.verify(), false);
    assert.equal(f.model.resetRejected(), true); reject = false; f.next();
    assert.equal(await f.model.start(payload()), true); assert.equal(f.created.length, 1);
  }
});

test('receipt tombstone GET409/410 resolves explicitly and NEVER recreates deleted original', async () => {
  for (const status of [409, 410]) {
    const f = fixture(async (_, options) => { throw failure(options.method === 'POST' ? 503 : status); });
    await f.model.start(payload()); await f.model.verify();
    assert.equal(f.model.snapshot().phase, 'rejected'); assert.equal(f.model.snapshot().canReset, true);
    assert.equal(f.model.snapshot().canRetry, false); assert.equal(f.model.snapshot().canVerify, false);
    await f.model.retry(); await f.model.verify(); assert.equal(f.calls.length, 2);
    assert.equal(f.model.resetRejected(), true); assert.equal(f.calls.length, 2);
  }
});

test('sync busy admission prevents double create/verify and publishes navigation state before transport', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const first = f.model.start(payload());
  assert.equal(f.model.snapshot().busy, true); assert.equal(f.model.snapshot().unresolved, true);
  assert.equal(await f.model.start(payload()), false); assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
  pending.resolve(row()); assert.equal(await first, true);
});

test('revocation and obsolete response retire private body, never publish/retry or clear a newer session', async () => {
  for (const status of [401, 403]) {
    const f = fixture(async () => { throw failure(status); }); await f.model.start(payload());
    assert.equal(f.model.snapshot().phase, 'denied'); assert.equal(f.model.snapshot().unresolved, false);
    assert.equal(await f.model.verify(), false); assert.equal(f.model.resetRejected(), false); assert.equal(f.calls.length, 1);
  }
  for (const reject of [false, true]) {
    const pending = deferred(), f = fixture(() => pending.promise), work = f.model.start(payload());
    f.retire(); if (reject) pending.reject(failure(503)); else pending.resolve(row()); await work;
    assert.equal(f.created.length, 0); assert.equal(f.model.snapshot().phase, 'denied');
    assert.equal(await f.model.retry(), false); assert.equal(f.calls.length, 1);
  }
});

test('disposed model cannot publish, send or resume under a later StrictMode setup', async () => {
  const pending = deferred(), first = fixture(() => pending.promise), work = first.model.start(payload());
  first.model.dispose(); const second = fixture(async () => row()); await second.model.start(payload());
  const states = first.states.length; pending.resolve(row()); await work;
  assert.equal(first.created.length, 0); assert.equal(first.states.length, states);
  assert.equal(await first.model.start(payload()), false); assert.equal(first.calls.length, 1);
  assert.equal(second.created.length, 1);
});

test('bad UUID/payload fails before transport and a subscriber retiring during publication prevents callbacks', async () => {
  let sends = 0;
  const model = createPersonalListCreation({ request: () => { sends++; }, isCurrent: () => true, createRequestId: () => 'bad' });
  await model.start(payload()); assert.equal(sends, 0); assert.equal(model.snapshot().phase, 'rejected');
  const created = []; let current = true;
  const live = createPersonalListCreation({ request: async () => row(), createRequestId: () => key, isCurrent: () => current,
    onCreated: value => created.push(value), onState: state => { if (state.phase === 'confirmed') current = false; } });
  await live.start(payload()); assert.deepEqual(created, []);
});

test('schema guard rejects wrong receipt/resource/versions and malformed nested editors, retaining BIGINT exactness', () => {
  assert.equal(validatePersonalListCreation(row(), key).id, '9007199254740993');
  assert.throws(()=>validatePersonalListCreation({...row(),id:'1\n',bloques:[],secciones:[]},key),'Canonical ID cannot accept final-newline aliases even without nested rows');
  for (const change of [r => r.id = 9007199254740992, r => r.id = '1\n', r => r.version = 0,
    r => r.creation_request_id = otherKey, r => r.created_at = 'bad', r => r.bloques = null,
    r => r.bloques[0].lista_id = '2', r => r.bloques[0].contenido.texto = 1,
    r => r.bloques.push(r.bloques[0]), r => r.secciones[0].items = {}, r => r.secciones[0].lista_id = '5']) {
    const invalid = row(); change(invalid); assert.throws(() => validatePersonalListCreation(invalid, key));
  }
});

test('ACK schema supports every block editor without trusting array/object substitutions', () => {
  const value=row(), base=value.bloques[0];
  value.bloques=[base,
    {...base,id:'13',tipo:'checklist',contenido:{titulo:'Pendientes',items:[{id:'item-1',texto:'Nota',completado:false}]}},
    {...base,id:'14',tipo:'listado',contenido:{titulo:'Lista',items:[{id:'item-2',texto:'Nota'}]}},
    {...base,id:'15',tipo:'tabla',contenido:{titulo:'Semana',columnas:[{id:'col-1',titulo:'Lunes'}],filas:[{id:'row-1',celdas:{'col-1':{texto:'Nota',completado:false}}}]}}];
  assert.equal(validatePersonalListCreation(value,key),value);
  value.bloques[3].contenido.filas[0].celdas['col-1'].completado='false';
  assert.throws(()=>validatePersonalListCreation(value,key));
});

test('idempotent reconciliation never duplicates numeric/string IDs nor overwrites queued local draft objects', () => {
  const local = { ...row(key, '7'), titulo: 'Draft not yet saved' }, lists = [local];
  assert.equal(reconcilePersonalListCreation(lists, row(key, 7)), lists); assert.equal(lists[0], local);
  const other = row(); const next = reconcilePersonalListCreation(lists, other);
  assert.equal(next.length, 2); assert.equal(next[0], local); assert.equal(next[1], other);
  assert.equal(reconcilePersonalListCreation(next, other), next);
});
