import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalListBlockCreation, validatePersonalListBlockCreation, reconcilePersonalListBlockCreation} from './personalListBlockCreation.js';

const key = '10000000-0000-4000-8000-000000000384';
const nextKey = '20000000-0000-4000-8000-000000000384';
const listId = '9007199254740993', blockId = '9007199254740995';
const payload = () => ({tipo: 'texto', contenido: {texto: 'Original'}});
const row = (extra = {}) => ({id: blockId, lista_id: listId, tipo: 'texto', contenido: {texto: 'Current server text'},
  posicion: 2, version: 3, created_at: '2026-10-25T12:00:00.000Z', updated_at: '2026-10-25T12:01:00.000Z',
  creation_request_id: key, ...extra});
const failure = status => Object.assign(new Error('UNTRUSTED transport detail'), {status});
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function fixture(transport) {
  const calls = [], states = [], created = [];
  let live = true, id = key;
  const model = createPersonalListBlockCreation({request: async (...args) => {calls.push(args); return transport(...args);},
    isCurrent: () => live, onState: state => states.push(state), onCreated: value => created.push(value), createRequestId: () => id});
  return {model, calls, states, created, retire() {live = false;}, restore() {live = true;}, next() {id = nextKey;}};
}

test('exact closed body uses captured BIGINT list and synchronous create latch; valid ACK publishes original row once', async () => {
  const waiting = deferred(), f = fixture(() => waiting.promise);
  const input = {...payload(), uiOnly: 'omit', lista_id: '22'};
  const pending = f.model.create(listId, input);
  assert.equal(f.model.snapshot().phase, 'writing'); assert.equal(f.model.snapshot().busy, true);
  assert.equal(f.model.snapshot().unresolved, true); assert.equal(Object.isFrozen(f.model.snapshot()), true);
  assert.equal(await f.model.create('22', payload()), false); assert.equal(await f.model.retry(), false);
  assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], `/api/listas-personales/${listId}/bloques`);
  assert.deepEqual(JSON.parse(f.calls[0][1].body), {request_id: key, ...payload()});
  input.contenido.texto = 'Changed after submit';
  const ack = row(); waiting.resolve(ack); assert.equal(await pending, true);
  assert.strictEqual(f.created[0], ack); assert.equal(f.created.length, 1);
  assert.equal(f.model.snapshot().phase, 'confirmed'); assert.equal(f.model.snapshot().unresolved, false);
  assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
});

test('lost committed ACK cannot create a duplicate; explicit GET adopts current block without another POST', async () => {
  let inserted = 0;
  const current = row({version: 7, contenido: {texto: 'Edited in another view'}});
  const f = fixture(async (_, options) => {if (options.method === 'POST') {inserted++; throw failure(503);} return current;});
  assert.equal(await f.model.create(listId, payload()), false);
  assert.equal(f.model.snapshot().phase, 'uncertain');
  assert.equal(await f.model.create(listId, payload()), false); assert.equal(await f.model.retry(), false);
  assert.equal(await f.model.verify(), true);
  assert.equal(inserted, 1); assert.deepEqual(f.calls[1], [`/api/listas-personales/${listId}/bloques/creaciones/${key}`, {method: 'GET', cache: 'no-store'}]);
  assert.strictEqual(f.created[0], current);
});

test('GET404 retains intent; only explicit retry uses byte-identical original key/body/list after payload mutation', async () => {
  let writes = 0;
  const f = fixture(async (_, options) => {
    if (options.method === 'GET') throw failure(404);
    if (++writes === 1) throw failure(500);
    return row();
  });
  const input = payload(); await f.model.create(listId, input);
  const body = f.calls[0][1].body;
  input.tipo = 'listado'; input.contenido.texto = 'Do not rebase'; f.next();
  await f.model.verify(); assert.equal(f.model.snapshot().phase, 'missing'); assert.equal(f.model.snapshot().canRetry, true);
  assert.equal(await f.model.create('22', input), false); assert.equal(f.model.resetRejected(), false);
  assert.equal(await f.model.retry(), true);
  assert.equal(f.calls[2][0], f.calls[0][0]); assert.equal(f.calls[2][1].body, body);
  assert.equal(f.created.length, 1);
});

test('network/5xx/malformed ACK remain uncertain with sanitized errors and verification never automatically POSTs', async () => {
  for (const outcome of ['network', 500, 503, 'bad-parent', 'bad-key', 'bad-content']) {
    const f = fixture(async () => {
      if (outcome === 'bad-parent') return row({lista_id: '22'});
      if (outcome === 'bad-key') return row({creation_request_id: nextKey});
      if (outcome === 'bad-content') return row({contenido: {texto: {}}});
      throw failure(outcome);
    });
    await f.model.create(listId, payload()); assert.equal(f.model.snapshot().phase, 'uncertain');
    await f.model.verify(); await f.model.verify();
    assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1);
    assert.equal(f.created.length, 0); assert.equal(f.model.resetRejected(), false);
    assert.doesNotMatch(f.model.snapshot().error, /UNTRUSTED/);
  }
});

test('POST rejection and GET tombstone require explicit close; no reset, retry or new UUID happens automatically', async () => {
  for (const status of [400, 404, 409, 410, 413, 422, 428]) {
    const f = fixture(async () => {throw failure(status);});
    await f.model.create(listId, payload()); assert.equal(f.model.snapshot().phase, 'rejected');
    assert.equal(await f.model.create(listId, payload()), false); assert.equal(await f.model.retry(), false);
    assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
    assert.equal(f.model.resetRejected(), true); assert.equal(f.model.snapshot().phase, 'idle');
  }
  for (const status of [409, 410]) {
    const f = fixture(async (_, options) => {throw failure(options.method === 'POST' ? 503 : status);});
    await f.model.create(listId, payload()); await f.model.verify();
    assert.equal(f.model.snapshot().phase, 'rejected'); assert.equal(f.model.snapshot().canRetry, false);
    assert.equal(await f.model.retry(), false); assert.equal(await f.model.verify(), false);
    assert.equal(f.calls.length, 2); assert.equal(f.created.length, 0);
  }
});

test('401/403/obsolete binding retire private attempt permanently, including later same-ID session ABA', async () => {
  for (const reason of [failure(401), failure(403), {code: 'session_binding_obsolete'}]) {
    const f = fixture(async () => {throw reason;}); await f.model.create(listId, payload());
    assert.equal(f.model.snapshot().phase, 'denied'); assert.equal(f.model.snapshot().listId, null);
    f.retire(); f.restore(); f.next();
    assert.equal(await f.model.create(listId, payload()), false); assert.equal(await f.model.verify(), false);
    assert.equal(await f.model.retry(), false); assert.equal(f.model.resetRejected(), false);
    assert.equal(f.calls.length, 1); assert.equal(f.created.length, 0);
  }
});

test('late success/error after observed lifetime withdrawal or dispose never publishes or changes another page', async () => {
  for (const dispose of [false, true]) for (const fail of [false, true]) {
    const waiting = deferred(), f = fixture(() => waiting.promise), pending = f.model.create(listId, payload());
    if (dispose) f.model.dispose(); else {f.retire(); await f.model.verify(); f.restore();}
    const states = f.states.length;
    fail ? waiting.reject(failure(500)) : waiting.resolve(row());
    assert.equal(await pending, false); assert.equal(f.created.length, 0); assert.equal(f.states.length, states);
    assert.equal(f.model.snapshot().phase, 'denied');
  }
});

test('onState may retire lifetime before transport or before onCreated; neither leaks a write/admission', async () => {
  for (const retireAt of ['writing', 'confirmed']) {
    let live = true, calls = 0, created = 0;
    const model = createPersonalListBlockCreation({isCurrent: () => live, createRequestId: () => key,
      request: async () => {calls++; return row();}, onState: state => {if (state.phase === retireAt) live = false;},
      onCreated: () => {created++;}});
    assert.equal(await model.create(listId, payload()), false);
    assert.equal(calls, retireAt === 'writing' ? 0 : 1); assert.equal(created, 0); assert.equal(model.snapshot().phase, 'denied');
  }
});

test('verification has its own synchronous latch and intentional next creation requires a fresh UUID', async () => {
  const waiting = deferred(); let count = 0;
  const f = fixture(async (_, options) => {if (++count === 1) throw failure(503); if (options.method === 'GET') return waiting.promise; return row({creation_request_id: nextKey});});
  await f.model.create(listId, payload()); const check = f.model.verify();
  assert.equal(f.model.snapshot().phase, 'checking'); assert.equal(await f.model.verify(), false);
  assert.equal(await f.model.retry(), false); waiting.resolve(row()); assert.equal(await check, true);
  assert.equal(await f.model.create(listId, payload()), false, 'Cannot silently reuse a confirmed request key');
  assert.equal(f.model.resetRejected(), true); f.next();
  assert.equal(await f.model.create(listId, payload()), true); assert.equal(f.created.length, 2);
});

test('block validation shares all renderable content types and rejects invalid identity/schema without mutation', () => {
  const contents = [
    ['texto', {texto: ''}], ['listado', {titulo: 'List', items: [{id: 'i', texto: ''}]}],
    ['checklist', {titulo: '', items: [{id: 'i', texto: 'Keep', completado: false}]}],
    ['tabla', {titulo: 'Table', columnas: [{id: 'c', titulo: ''}], filas: [{id: 'r', celdas: {c: {texto: '', completado: true}}}]}],
  ];
  for (const [tipo, contenido] of contents) {
    const value = row({tipo, contenido}), before = JSON.stringify(value);
    assert.strictEqual(validatePersonalListBlockCreation(value, listId, key), value); assert.equal(JSON.stringify(value), before);
  }
  for (const patch of [{id: '01'}, {id: '9223372036854775808'}, {id: Number.MAX_SAFE_INTEGER + 1},
    {lista_id: '9007199254740992'}, {version: 0}, {version: 1.2}, {posicion: -1}, {created_at: ''}, {updated_at: 'invalid'},
    {creation_request_id: nextKey}, {tipo: 'unknown'}, {contenido: {texto: null}},
    {tipo: 'listado', contenido: {titulo: '', items: [{id: 'i', texto: ''}, {id: 'i', texto: ''}]}}]) {
    assert.throws(() => validatePersonalListBlockCreation(row(patch), listId, key));
  }
});

test('invalid inputs fail before transport; frozen input is serialized without mutating or retaining references', async () => {
  for (const id of ['01', '1e0', '9223372036854775808', 0, -1, null, {}]) {
    const f = fixture(() => assert.fail('No invalid parent transport'));
    assert.equal(await f.model.create(id, payload()), false); assert.equal(f.calls.length, 0);
  }
  const f = fixture(async () => row());
  const input = Object.freeze({tipo: 'texto', contenido: Object.freeze({texto: 'Frozen'})});
  assert.equal(await f.model.create(listId, input), true); assert.equal(input.contenido.texto, 'Frozen');
});

test('reconciliation preserves existing draft objects, BIGINT identities and list selection without duplicates or new lists', () => {
  const draft = Object.freeze({id: 12, lista_id: 7, contenido: Object.freeze({texto: 'Unsaved draft'}), version: 4});
  const first = Object.freeze({id: '7', bloques: Object.freeze([draft])});
  const other = Object.freeze({id: listId, bloques: Object.freeze([])});
  const lists = Object.freeze([first, other]);
  assert.strictEqual(reconcilePersonalListBlockCreation(lists, row({id: '12', lista_id: 7})), lists);
  assert.strictEqual(lists[0].bloques[0], draft);
  const created = row(), next = reconcilePersonalListBlockCreation(lists, created);
  assert.strictEqual(next[0], first); assert.strictEqual(next[1].bloques[0], created); assert.strictEqual(lists[1], other);
  assert.strictEqual(reconcilePersonalListBlockCreation(next, created), next);
  assert.strictEqual(reconcilePersonalListBlockCreation(lists, row({lista_id: '99'})), lists);
  const adjacent = row({id: '9007199254740996'});
  assert.equal(reconcilePersonalListBlockCreation(next, adjacent)[1].bloques.length, 2);
});
