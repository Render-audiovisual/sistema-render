import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPersonalListsRouter, normalizePersonalListCreateInput } from '../src/personal-lists.js';
import { createPersonalListWithReceipt, findPersonalListCreation, personalListCreationHash,
  personalListCreationRequestId } from '../src/personal-list-create-receipts.js';

const key = '10000000-0000-4000-8000-000000000001';
const otherKey = '10000000-0000-4000-8000-000000000002';
const auth = () => ({ id: 7, rol: 'edicion', session_version: 3 });
const input = (extra = {}) => normalizePersonalListCreateInput({ request_id: key, titulo: 'Mi página', ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// A deterministic transaction/row-lock double, not physical PostgreSQL proof.
// It models direct actor UPDATE serialization, owner predicates and rollback.
function fixture({ initialCount = 0, leaseGate, commitGate, failurePrefix, rollbackFailure = false, actor = { ...auth(), activo: true } } = {}) {
  let state = { lists: [], sections: [], items: [], blocks: [], receipts: new Map(), next: 9007199254740993n };
  for (let index = 0; index < initialCount; index++) state.lists.push({ id: String(index + 1), usuario_id: 7, titulo: 'Existing', posicion: index });
  const calls = [], releases = [], synthetic = new Error('synthetic failure'); let tail = Promise.resolve(), leases = 0;
  const pool = { async connect() {
    leases++; if (leaseGate) await leaseGate.promise;
    let unlock, before;
    return { async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim(); calls.push({ sql: compact, params: structuredClone(params) });
      const rows = value => ({ rows: value, rowCount: value.length });
      if (compact === 'BEGIN ISOLATION LEVEL READ COMMITTED') return rows([]);
      if (compact === 'COMMIT') { if (commitGate) await commitGate.promise; unlock?.(); unlock = undefined; return rows([]); }
      if (compact === 'ROLLBACK') {
        if (before) state = before; unlock?.(); unlock = undefined;
        if (rollbackFailure) throw Error('rollback failure'); return rows([]);
      }
      if (failurePrefix && compact.startsWith(failurePrefix)) throw synthetic;
      if (compact.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) {
        if (compact.endsWith('FOR UPDATE')) {
          const predecessor = tail; tail = new Promise(done => { unlock = done; }); await predecessor;
        }
        before = structuredClone(state);
        return rows(actor ? [{ ...actor }] : []);
      }
      if (compact.startsWith('SELECT payload_hash,list_id FROM personal_list_create_receipts')) {
        const receipt = state.receipts.get(`${params[0]}:${params[1]}`); return rows(receipt ? [receipt] : []);
      }
      if (compact.startsWith('SELECT COUNT(*)::int total FROM listas_personales')) return rows([{ total: state.lists.filter(list => list.usuario_id === params[0]).length }]);
      if (compact.startsWith('INSERT INTO listas_personales')) {
        const [owner, titulo, emoji] = params;
        const list = { id: String(state.next++), usuario_id: owner, titulo, emoji,
          posicion: Math.max(-1, ...state.lists.filter(list => list.usuario_id === owner).map(list => list.posicion)) + 1,
          version: 1, created_at: '2026-10-23T12:00:00.000Z', updated_at: '2026-10-23T12:00:00.000Z' };
        state.lists.push(list); const { usuario_id, ...dto } = list; return rows([dto]);
      }
      if (compact.startsWith('INSERT INTO lista_secciones')) {
        state.sections.push({ id: String(state.next++), lista_id: params[0], titulo: 'Pendientes', posicion: 0, version: 1 }); return rows([]);
      }
      if (compact.startsWith('INSERT INTO lista_bloques')) {
        state.blocks.push({ id: String(state.next++), lista_id: params[0], tipo: params[1], contenido: JSON.parse(params[2]), posicion: params[3], version: 1 }); return rows([]);
      }
      if (compact.startsWith('INSERT INTO personal_list_create_receipts')) {
        state.receipts.set(`${params[0]}:${params[1]}`, { payload_hash: params[2], list_id: params[3] }); return rows([]);
      }
      if (compact.startsWith('SELECT id,titulo,emoji,posicion,version,created_at,updated_at FROM listas_personales')) {
        const list = state.lists.find(list => list.id === params[0] && list.usuario_id === params[1]);
        if (!list) return rows([]); const { usuario_id, ...dto } = list; return rows([dto]);
      }
      if (compact.includes('WHERE l.id=$1 AND l.usuario_id=$2')) {
        if (!state.lists.some(list => list.id === params[0] && list.usuario_id === params[1])) return rows([]);
        if (compact.startsWith('SELECT s.id')) return rows(state.sections.filter(section => section.lista_id === params[0]));
        if (compact.startsWith('SELECT b.id')) return rows(state.blocks.filter(block => block.lista_id === params[0]));
        if (compact.startsWith('SELECT i.id')) return rows(state.items.filter(item => state.sections.some(section => section.id === item.seccion_id && section.lista_id === params[0])));
      }
      throw Error('Unexpected mocked SQL');
    }, release(error) { releases.push(error); } };
  } };
  return { pool, calls, releases, synthetic, get state() { return state; }, get leases() { return leases; } };
}
const create = (f, selection = input(), actor = auth()) => createPersonalListWithReceipt(f.pool, actor, selection);
const writes = f => f.calls.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql));

test('request UUID required428, malformed400, normalized lowercase and closed input with existing defaults', () => {
  assert.throws(() => normalizePersonalListCreateInput({}), { status: 428 });
  assert.throws(() => normalizePersonalListCreateInput(undefined), { status: 428 });
  for (const value of [null, '', key + '\n', [], {}, 7]) assert.throws(() => personalListCreationRequestId(value), { status: 400 });
  assert.equal(personalListCreationRequestId(key.toUpperCase()), key);
  assert.throws(() => normalizePersonalListCreateInput({ request_id: key, usuario_id: 8 }), { status: 400 });
  const normalized = input({ titulo: '  Mi \n página ', emoji: ' 📝 ' });
  assert.equal(normalized.payload.titulo, 'Mi página');
  assert.deepEqual(normalized.payload.bloques, [{ tipo: 'checklist', contenido: { titulo: 'Pendientes', items: [] } }]);
  assert.deepEqual(input({ bloques: [] }).payload.bloques, []);
});

test('hash uses normalized business only with deep key sorting, retains array order and intentional differences', () => {
  const a = { titulo: 'T', emoji: '📝', bloques: [{ tipo: 'tabla', contenido: { filas: [{ celdas: { b: { texto: 'B', completado: false }, a: { texto: 'A', completado: false } } }] } }] };
  const b = { bloques: [{ contenido: { filas: [{ celdas: { a: { completado: false, texto: 'A' }, b: { completado: false, texto: 'B' } } }] }, tipo: 'tabla' }], emoji: '📝', titulo: 'T' };
  assert.equal(personalListCreationHash(a), personalListCreationHash(b));
  assert.match(personalListCreationHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(personalListCreationHash(a), personalListCreationHash({ ...a, titulo: 'Other' }));
  assert.notEqual(personalListCreationHash([1, 2]), personalListCreationHash([2, 1]));
  assert.equal(personalListCreationHash(input().payload), personalListCreationHash(input({ titulo: ' Mi página  ' }).payload));
});

test('new create atomically locks actor UPDATE first, inserts list/section/blocks/receipt and reads back exact BIGINT DTO', async () => {
  const f = fixture(), result = await create(f);
  assert.equal(result.replayed, false); assert.equal(result.list.id, '9007199254740993');
  assert.equal(result.list.creation_request_id, key); assert.equal(result.list.secciones.length, 1); assert.equal(result.list.bloques.length, 1);
  assert.equal(result.list.bloques[0].lista_id, result.list.id); assert.equal(result.list.secciones[0].lista_id, result.list.id);
  assert.deepEqual(result.list.secciones[0].items, []); assert.equal(Object.hasOwn(result.list, 'usuario_id'), false);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.match(f.calls[1].sql, /FROM usuarios WHERE id=\$1 FOR UPDATE$/);
  assert.match(f.calls[2].sql, /FROM personal_list_create_receipts/);
  assert.equal(writes(f).length, 4); assert.deepEqual(f.calls.at(-1), { sql: 'COMMIT', params: [] });
  assert.equal(f.state.receipts.size, 1); assert.deepEqual(f.releases, [undefined]);
});

test('exact replay returns CURRENT owned title/blocks despite cap, without INSERT/update or relying on names', async () => {
  const f = fixture({ initialCount: 99 }); const first = await create(f);
  assert.equal(f.state.lists.length, 100);
  f.state.lists.find(list => list.id === first.list.id).titulo = 'Renamed after ACK';
  f.state.blocks[0].contenido = { titulo: 'Changed', items: [] };
  f.calls.length = 0;
  const replay = await create(f, input(), { ...auth(), nombre: 'Other label' });
  assert.equal(replay.replayed, true); assert.equal(replay.list.id, first.list.id); assert.equal(replay.list.titulo, 'Renamed after ACK');
  assert.equal(replay.list.bloques[0].contenido.titulo, 'Changed'); assert.equal(replay.list.creation_request_id, key);
  assert.equal(writes(f).length, 0); assert.ok(!f.calls.some(call => call.sql.startsWith('SELECT COUNT')));
  assert.ok(f.calls.some(call => call.sql.includes('FROM listas_personales WHERE id=$1 AND usuario_id=$2 FOR SHARE')));
});

test('different payload same UUID409; equal payload different UUID creates an intentional second list', async () => {
  const f = fixture(), first = await create(f); f.calls.length = 0;
  await assert.rejects(create(f, input({ titulo: 'Other' })), { status: 409 }); assert.equal(writes(f).length, 0);
  const second = await create(f, input({ request_id: otherKey }));
  assert.notEqual(second.list.id, first.list.id); assert.equal(second.list.posicion, 1); assert.equal(f.state.lists.length, 2);
  assert.equal(f.state.receipts.size, 2);
});

test('actor scoped receipt cannot recover another owner; tombstone POST/lookup409 never recreates', async () => {
  const f = fixture(); await create(f); f.calls.length = 0;
  await assert.rejects(findPersonalListCreation(f.pool, { id: 8, rol: 'edicion', session_version: 3 }, key), { status: 401 });
  const missing = fixture({ actor: { id: 8, rol: 'edicion', session_version: 3, activo: true } });
  missing.state.receipts.set(`7:${key}`, { payload_hash: personalListCreationHash(input().payload), list_id: '9007199254740993' });
  await assert.rejects(findPersonalListCreation(missing.pool, { id: 8, rol: 'edicion', session_version: 3 }, key), { status: 404 });
  assert.deepEqual(missing.calls.find(call => call.sql.startsWith('SELECT payload_hash')).params, [8, key]);
  f.state.lists.length = 0; f.calls.length = 0;
  await assert.rejects(create(f), { status: 409 });
  await assert.rejects(findPersonalListCreation(f.pool, auth(), key), { status: 409 });
  assert.equal(writes(f).length, 0); assert.equal(f.state.receipts.size, 1);
});

test('lookup uses actor SHARE and owned list SHARE, returns correlation after edits, absent receipt404 and no writes', async () => {
  const f = fixture(), first = await create(f); f.state.lists[0].titulo = 'Latest'; f.calls.length = 0;
  const found = await findPersonalListCreation(f.pool, auth(), key);
  assert.equal(found.id, first.list.id); assert.equal(found.titulo, 'Latest'); assert.equal(found.creation_request_id, key);
  assert.match(f.calls[1].sql, /FOR SHARE$/); assert.equal(writes(f).length, 0);
  await assert.rejects(findPersonalListCreation(f.pool, auth(), otherKey), { status: 404 });
  assert.equal(writes(f).length, 0);
});

test('authority and normalized deep payload captured before pool lease; no fresh actor/name adoption', async () => {
  const leaseGate = deferred(), f = fixture({ leaseGate }), observed = auth(), selection = input();
  const pending = create(f, selection, observed);
  observed.id = 9; observed.rol = 'admin'; observed.session_version = 4;
  selection.payload.titulo = 'Changed'; selection.payload.bloques[0].contenido.titulo = 'Changed';
  leaseGate.resolve(); const result = await pending;
  assert.equal(result.list.titulo, 'Mi página'); assert.equal(result.list.bloques[0].contenido.titulo, 'Pendientes');
  assert.deepEqual(f.calls[1].params, [7]); assert.equal(f.state.lists[0].usuario_id, 7);
});

test('stale role/epoch/inactive actors fail401 before receipts/domain, malformed identity before lease', async () => {
  for (const actor of [null, { ...auth(), activo: false }, { ...auth(), activo: true, id: 8 },
    { ...auth(), activo: true, rol: 'admin' }, { ...auth(), activo: true, session_version: 4 }]) {
    const f = fixture({ actor }); await assert.rejects(create(f), { status: 401 });
    assert.deepEqual(f.calls.map(call => call.sql), ['BEGIN ISOLATION LEVEL READ COMMITTED',
      'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR UPDATE', 'ROLLBACK']);
  }
  for (const patch of [{ id: '7' }, { id: 2147483648 }, { session_version: 0 }, { rol: '' }]) {
    const f = fixture(); await assert.rejects(create(f, input(), { ...auth(), ...patch }), { status: 401 }); assert.equal(f.leases, 0);
  }
});

test('direct actor lock serializes concurrent same-key creates and cap/order across distinct keys in transaction double', async () => {
  const f = fixture(); const both = await Promise.all([create(f), create(f)]);
  assert.deepEqual(both.map(result => result.replayed), [false, true]); assert.equal(f.state.lists.length, 1);
  const g = fixture(); const distinct = await Promise.all([create(g), create(g, input({ request_id: otherKey }))]);
  assert.deepEqual(distinct.map(result => result.list.posicion), [0, 1]); assert.equal(g.state.lists.length, 2);
  const cap = fixture({ initialCount: 99 });
  const results = await Promise.allSettled([create(cap), create(cap, input({ request_id: otherKey }))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(cap.state.lists.length, 100); assert.equal(cap.state.receipts.size, 1);
});

test('receipt/block failures roll back all new rows; rollback failure discards connection without hiding original error', async () => {
  for (const failurePrefix of ['INSERT INTO lista_bloques', 'INSERT INTO personal_list_create_receipts']) {
    for (const rollbackFailure of [false, true]) {
      const f = fixture({ failurePrefix, rollbackFailure });
      await assert.rejects(create(f), error => error === f.synthetic);
      assert.equal(f.state.lists.length, 0); assert.equal(f.state.sections.length, 0); assert.equal(f.state.blocks.length, 0);
      assert.equal(f.state.receipts.size, 0); assert.equal(f.releases[0] instanceof Error, rollbackFailure);
    }
  }
  const commitGate = deferred(), f = fixture({ commitGate }); let settled = false;
  const pending = create(f).then(result => { settled = true; return result; });
  while (!f.calls.some(call => call.sql === 'COMMIT')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); commitGate.resolve(); await pending; assert.equal(settled, true);
});

test('actual router exposes201/200 and no-store on lookup errors; required UUID checked before pool', async () => {
  const f = fixture(), routes = new Map();
  const router = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, fn) => { routes.set(`${method}:${path}`, fn); }]));
  createPersonalListsRouter({ express: { Router: () => router }, pool: f.pool });
  const call = async (method, path, body, params = {}) => {
    const result = { status: 200, headers: {} };
    const res = { status(value) { result.status = value; return this; }, set(key, value) { result.headers[key] = value; return this; }, json(value) { result.body = value; return this; } };
    await routes.get(`${method}:${path}`)({ body, params, auth: auth() }, res, error => { throw error; }); return result;
  };
  assert.equal((await call('post', '/', {})).status, 428); assert.equal(f.leases, 0);
  const first = await call('post', '/', { request_id: key, titulo: 'Mi página' }); assert.equal(first.status, 201);
  const replay = await call('post', '/', { request_id: key, titulo: 'Mi página' }); assert.equal(replay.status, 200);
  assert.equal(first.body.id, replay.body.id); assert.equal(replay.body.creation_request_id, key);
  for (const [requestId, status] of [[key, 200], [otherKey, 404], ['bad', 400]]) {
    const result = await call('get', '/creaciones/:requestId', undefined, { requestId });
    assert.equal(result.status, status); assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  f.state.lists.length = 0;
  const tombstone = await call('get', '/creaciones/:requestId', undefined, { requestId: key });
  assert.equal(tombstone.status, 409); assert.equal(tombstone.headers['Cache-Control'], 'no-store');
});

test('087 schema retains immutable tombstones, exact types/hash/PK and no list FK or historical backfill', () => {
  const sql = readFileSync(new URL('../migrations/087_personal_list_create_receipts.sql', import.meta.url), 'utf8');
  for (const pattern of [/actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/,
    /request_id UUID NOT NULL/, /payload_hash TEXT NOT NULL/, /list_id BIGINT NOT NULL CHECK \(list_id>0\)/,
    /committed_at TIMESTAMPTZ NOT NULL/, /PRIMARY KEY\(actor_user_id,request_id\)/,
    /BEFORE UPDATE OR DELETE ON personal_list_create_receipts/, /ERRCODE='23514'/]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /REFERENCES listas_personales|ON DELETE CASCADE|INSERT INTO|ALTER TABLE listas_personales/);
});
