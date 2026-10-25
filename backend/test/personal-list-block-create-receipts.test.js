import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPersonalListBlockWithReceipt, findPersonalListBlockCreation } from '../src/personal-list-block-create-receipts.js';
import { personalListCreationHash } from '../src/personal-list-create-receipts.js';
import { normalizeBlockType, normalizeBlockContent } from '../src/personal-list-blocks.js';

const key = '10000000-0000-4000-8000-00000000000a';
const otherKey = '10000000-0000-4000-8000-00000000000b';
const listA = '9007199254740993', listB = '9007199254740994', foreignList = '9007199254740995';
const auth = (id = 7) => ({ id, rol: 'edicion', session_version: 3 });
const payload = (text = 'QA block') => {
  const tipo = normalizeBlockType('texto');
  return { tipo, contenido: normalizeBlockContent(tipo, { texto: text }) };
};
const selection = (patch = {}) => ({ requestId: key, listId: listA, payload: payload(), ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// In-memory row-lock/transaction double only. No physical PostgreSQL, router,
// migration, external provider or browser claims. Model owner UPDATE locking
// before ALL list/block/receipt access, rollback and full BIGINT identities.
function fixture(options = {}) {
  let state = { lists: [{ id: listA, usuario_id: 7 }, { id: listB, usuario_id: 7 }, { id: foreignList, usuario_id: 8 }],
    blocks: [], receipts: new Map(), next: 9007199254741993n };
  for (let index = 0; index < (options.initialCount ?? 0); index++) state.blocks.push({
    id: String(state.next++), lista_id: listA, tipo: 'texto', contenido: { texto: 'Existing' }, posicion: index * 2, version: 1,
  });
  const calls = [], releases = [], locks = new Map(); let leases = 0;
  const synthetic = new Error('Synthetic primary transaction failure'), rollbackError = new Error('Synthetic rollback failure');
  const pool = { async connect() {
    leases++; if (options.leaseGate) await options.leaseGate.promise;
    let before, unlock;
    return { release(error) { releases.push(error); }, async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim(); calls.push({ sql: compact, params: structuredClone(params) });
      const rows = value => ({ rows: structuredClone(value), rowCount: value.length });
      if (compact === 'BEGIN ISOLATION LEVEL READ COMMITTED') return rows([]);
      if (compact === 'ROLLBACK') {
        if (before) state = before; unlock?.(); unlock = undefined;
        if (options.rollbackFails) throw rollbackError;
        return rows([]);
      }
      if (options.failurePrefix && compact.startsWith(options.failurePrefix)) throw synthetic;
      if (compact === 'COMMIT') {
        if (options.commitGate) await options.commitGate.promise;
        unlock?.(); unlock = undefined; return rows([]);
      }
      if (compact.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) {
        assert.match(compact, /FOR (UPDATE|SHARE)$/);
        if (compact.endsWith('FOR UPDATE')) {
          const predecessor = locks.get(params[0]) ?? Promise.resolve();
          locks.set(params[0], new Promise(done => { unlock = done; })); await predecessor;
        }
        before = structuredClone(state);
        const actor = Object.hasOwn(options, 'actor') ? options.actor : { ...auth(params[0]), activo: true };
        return rows(actor ? [actor] : []);
      }
      if (compact.startsWith('SELECT id FROM listas_personales')) {
        assert.equal(compact, 'SELECT id FROM listas_personales WHERE id=$1 AND usuario_id=$2 FOR SHARE');
        return rows(state.lists.filter(row => row.id === params[0] && row.usuario_id === params[1]).map(({ id }) => ({ id })));
      }
      if (compact.startsWith('SELECT payload_hash,list_id,block_id FROM personal_list_block_create_receipts')) {
        assert.match(compact, /actor_user_id=\$1 AND request_id=\$2$/);
        const found = state.receipts.get(`${params[0]}:${params[1]}`); return rows(found ? [found] : []);
      }
      if (compact.startsWith('SELECT COUNT(*)::int total,COALESCE(MAX(posicion),-1)+1 AS next_position')) {
        const blocks = state.blocks.filter(row => row.lista_id === params[0]);
        return rows([{ total: blocks.length, next_position: Math.max(-1, ...blocks.map(row => row.posicion)) + 1 }]);
      }
      if (compact.startsWith('INSERT INTO lista_bloques')) {
        assert.match(compact, /RETURNING id,lista_id,tipo,contenido,posicion,version,created_at,updated_at$/);
        const block = { id: String(state.next++), lista_id: params[0], tipo: params[1], contenido: JSON.parse(params[2]),
          posicion: params[3], version: 1, created_at: '2026-11-01T12:00:00.000Z', updated_at: '2026-11-01T12:00:00.000Z' };
        state.blocks.push(block); return rows([block]);
      }
      if (compact.startsWith('INSERT INTO personal_list_block_create_receipts')) {
        const [actorId, requestId, parentId, blockId, hash] = params, namespace = `${actorId}:${requestId}`;
        assert.equal(state.receipts.has(namespace), false, 'Immutable receipt cannot be overwritten');
        state.receipts.set(namespace, { list_id: parentId, block_id: blockId, payload_hash: hash }); return rows([]);
      }
      if (compact.startsWith('SELECT b.id,b.lista_id,b.tipo,b.contenido,b.posicion,b.version,b.created_at,b.updated_at')) {
        assert.match(compact, /JOIN listas_personales l ON l.id=b.lista_id/);
        assert.match(compact, /WHERE b.id=\$1 AND b.lista_id=\$2 AND l.usuario_id=\$3 FOR SHARE OF b$/);
        const ownsList = state.lists.some(row => row.id === params[1] && row.usuario_id === params[2]);
        return rows(ownsList ? state.blocks.filter(row => row.id === params[0] && row.lista_id === params[1]) : []);
      }
      throw new Error(`Unexpected bounded SQL: ${compact}`);
    } };
  } };
  return { pool, calls, releases, synthetic, rollbackError, get state() { return state; }, get leases() { return leases; } };
}
const create = (f, input = selection(), actor = auth()) => createPersonalListBlockWithReceipt(f.pool, actor, input);
const lookup = (f, parentId = listA, requestId = key, actor = auth()) => findPersonalListBlockCreation(f.pool, actor, parentId, requestId);
const writes = f => f.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));

test('required UUID428, malformed UUID400 and bounded canonical BIGINTs reject before lease', async () => {
  for (const run of [f => create(f, selection({ requestId: undefined })),
    f => findPersonalListBlockCreation(f.pool, auth(), listA, undefined)]) {
    const f = fixture(); await assert.rejects(run(f), { status: 428 }); assert.equal(f.leases, 0);
  }
  for (const requestId of [null, '', key + '\n', {}, [], 7]) {
    const f = fixture(); await assert.rejects(create(f, selection({ requestId })), { status: 400 }); assert.equal(f.leases, 0);
  }
  for (const listId of [0, -1, 1.1, Number(listA), '01', '1\n', '0', '9223372036854775808', {}, [], null, undefined]) {
    const f = fixture(); await assert.rejects(create(f, selection({ listId })), { status: 400 });
    await assert.rejects(findPersonalListBlockCreation(f.pool, auth(), listId, key), { status: 400 }); assert.equal(f.leases, 0);
  }
  for (const listId of ['9223372036854775807', 1]) {
    const f = fixture(); f.state.lists[0].id = String(listId);
    assert.equal((await create(f, selection({ listId }))).block.lista_id, String(listId));
  }
});

test('fresh create locks actor exclusively before list/receipt, caps and positions within the same commit', async () => {
  const f = fixture({ initialCount: 2 }), result = await create(f, selection({ requestId: key.toUpperCase() }));
  assert.equal(result.replayed, false); assert.equal(result.block.creation_request_id, key);
  assert.equal(result.block.id, '9007199254741995'); assert.equal(result.block.lista_id, listA);
  assert.equal(result.block.posicion, 3); assert.equal(result.block.version, 1);
  assert.deepEqual(result.block.contenido, payload().contenido);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal(f.calls[1].sql, 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR UPDATE');
  assert.deepEqual(f.calls[1].params, [7]); assert.match(f.calls[2].sql, /FROM listas_personales/);
  const inserted = writes(f); assert.equal(inserted.length, 2);
  assert.match(inserted[0].sql, /^INSERT INTO lista_bloques/); assert.match(inserted[1].sql, /^INSERT INTO personal_list_block_create_receipts/);
  assert.equal(f.state.receipts.get(`7:${key}`).payload_hash, personalListCreationHash({ listId: listA, ...payload() }));
  assert.equal(f.calls.at(-1).sql, 'COMMIT'); assert.deepEqual(f.releases, [undefined]);
});

test('safe numeric and canonical string list IDs identify the same hashed intention', async () => {
  const f = fixture(); f.state.lists[0].id = '1';
  const first = await create(f, selection({ listId: 1 })); f.calls.length = 0;
  const replay = await create(f, selection({ listId: '1' }));
  assert.equal(replay.replayed, true); assert.equal(replay.block.id, first.block.id); assert.equal(writes(f).length, 0);
});

test('caller payload envelope must be closed before any pool lease', async () => {
  for (const value of [undefined, null, [], {}, { ...payload(), usuario_id: 8 },
    { tipo: 'texto', contenido: null }, { tipo: 'texto', contenido: [] }, { tipo: 7, contenido: {} }]) {
    const f = fixture(); await assert.rejects(create(f, selection({ payload: value })), { status: 400 }); assert.equal(f.leases, 0);
  }
});

test('canonical deep hash includes list/type/content, ignores object key ordering and distinguishes array order', async () => {
  const f = fixture(), a = { tipo: 'listado', contenido: { titulo: 'A', items: [{ id: 'one', texto: 'One' }, { id: 'two', texto: 'Two' }] } };
  const first = await create(f, selection({ payload: a }));
  const equivalent = { contenido: { items: [{ texto: 'One', id: 'one' }, { texto: 'Two', id: 'two' }], titulo: 'A' }, tipo: 'listado' };
  f.calls.length = 0;
  assert.equal((await create(f, selection({ payload: equivalent }))).block.id, first.block.id); assert.equal(writes(f).length, 0);
  for (const patch of [{ listId: listB }, { payload: payload('Other') }, { payload: { ...a, tipo: 'checklist' } },
    { payload: { ...a, contenido: { ...a.contenido, items: [...a.contenido.items].reverse() } } }]) {
    f.calls.length = 0; await assert.rejects(create(f, selection(patch)), { status: 409 }); assert.equal(writes(f).length, 0);
  }
  assert.equal(f.state.blocks.length, 1); assert.equal(f.state.receipts.size, 1);
});

test('replay and GET return current edited block with correlation, never overwrite or append', async () => {
  const f = fixture(), first = await create(f);
  Object.assign(f.state.blocks[0], { tipo: 'texto', contenido: { texto: 'Edited after creation' }, version: 4, posicion: 8 });
  f.calls.length = 0;
  const replay = await create(f), found = await lookup(f);
  assert.equal(replay.replayed, true); assert.equal(replay.block.id, first.block.id);
  assert.equal(replay.block.version, 4); assert.deepEqual(replay.block.contenido, { texto: 'Edited after creation' });
  assert.deepEqual(found, replay.block); assert.equal(found.creation_request_id, key); assert.equal(writes(f).length, 0);
  assert.ok(f.calls.some(({ sql }) => sql === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE'));
});

test('deleted or moved block retains tombstone409; cannot recreate with an old request', async () => {
  for (const change of ['delete', 'move']) {
    const f = fixture(); await create(f);
    if (change === 'delete') f.state.blocks.length = 0; else f.state.blocks[0].lista_id = listB;
    f.calls.length = 0;
    await assert.rejects(create(f), { status: 409 }); await assert.rejects(lookup(f), { status: 409 });
    assert.equal(writes(f).length, 0); assert.equal(f.state.receipts.size, 1);
  }
});

test('owned list required even for replay; foreign/missing list404 and no cross-list receipt lookup', async () => {
  const f = fixture(); await create(f); f.calls.length = 0;
  for (const id of [foreignList, '99']) {
    await assert.rejects(create(f, selection({ listId: id })), { status: 404 });
    await assert.rejects(lookup(f, id), { status: 404 });
  }
  await assert.rejects(lookup(f, listB), { status: 404 }); await assert.rejects(lookup(f, listA, otherKey), { status: 404 });
  f.state.lists = f.state.lists.filter(row => row.id !== listA);
  await assert.rejects(create(f), { status: 404 }); await assert.rejects(lookup(f), { status: 404 });
  assert.equal(writes(f).length, 0); assert.equal(f.state.receipts.size, 1);
});

test('same UUID for another actual actor has an independent namespace and no elevated owner access', async () => {
  const f = fixture(), first = await create(f), second = await create(f, selection({ listId: foreignList }), auth(8));
  assert.notEqual(second.block.id, first.block.id); assert.equal(second.replayed, false); assert.equal(f.state.receipts.size, 2);
  f.calls.length = 0;
  await assert.rejects(lookup(f, listA, key, auth(8)), { status: 404 });
  await assert.rejects(create(f, selection({ listId: foreignList }), { ...auth(), rol: 'admin' }), { status: 401 });
  assert.equal(writes(f).length, 0);
  const admin = fixture({ actor: { ...auth(), rol: 'admin', activo: true } });
  await assert.rejects(create(admin, selection({ listId: foreignList }), { ...auth(), rol: 'admin' }), { status: 404 });
});

test('80-block cap is fresh-only: committed replay works at cap and lookup is no-DML', async () => {
  const f = fixture({ initialCount: 79 }), first = await create(f); assert.equal(f.state.blocks.length, 80);
  f.calls.length = 0; assert.equal((await create(f)).block.id, first.block.id); await lookup(f);
  await assert.rejects(create(f, selection({ requestId: otherKey })), { status: 409 });
  assert.equal(writes(f).length, 0); assert.equal(f.state.receipts.size, 1);
});

test('owner UPDATE lock serializes duplicate keys, distinct positions and cap in the transaction double', async () => {
  const f = fixture(), same = await Promise.all([create(f), create(f)]);
  assert.deepEqual(same.map(row => row.replayed), [false, true]); assert.equal(f.state.blocks.length, 1);
  const g = fixture(), different = await Promise.all([create(g), create(g, selection({ requestId: otherKey }))]);
  assert.deepEqual(different.map(row => row.block.posicion), [0, 1]); assert.equal(g.state.blocks.length, 2);
  const h = fixture({ initialCount: 79 }), cap = await Promise.allSettled([create(h), create(h, selection({ requestId: otherKey }))]);
  assert.equal(cap.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(cap.find(row => row.status === 'rejected').reason.status, 409);
  assert.equal(h.state.blocks.length, 80); assert.equal(h.state.receipts.size, 1);
});

test('deep payload, UUID/list ID and actor are captured before lease for create and lookup', async () => {
  const leaseGate = deferred(), f = fixture({ leaseGate }), actor = auth(), input = selection();
  const pending = create(f, input, actor);
  actor.id = 8; actor.rol = 'admin'; actor.session_version = 4;
  input.requestId = otherKey; input.listId = foreignList; input.payload.contenido.texto = 'Changed during lease';
  leaseGate.resolve(); const first = await pending;
  assert.equal(first.block.lista_id, listA); assert.deepEqual(first.block.contenido, payload().contenido);
  assert.equal(first.block.creation_request_id, key); assert.deepEqual(f.calls[1].params, [7]);
  const gate = deferred(), g = fixture(); await create(g); g.calls.length = 0;
  const originalConnect = g.pool.connect;
  g.pool.connect = async () => { await gate.promise; return originalConnect(); };
  const reader = auth(), found = lookup(g, listA, key, reader); reader.id = 8; reader.session_version = 8;
  gate.resolve(); assert.equal((await found).id, first.block.id); assert.deepEqual(g.calls[1].params, [7]);
});

test('revoked/missing/inactive/changed-role actors reject before domain access; malformed identities never lease', async () => {
  for (const actor of [null, { ...auth(), activo: false }, { ...auth(), activo: true, id: 8 },
    { ...auth(), activo: true, rol: 'admin' }, { ...auth(), activo: true, session_version: 4 }]) {
    for (const read of [false, true]) {
      const f = fixture({ actor }); await assert.rejects(read ? lookup(f) : create(f), { status: 401 });
      assert.equal(f.calls.length, 3); assert.equal(writes(f).length, 0);
      assert.equal(f.calls[1].sql.endsWith(read ? 'FOR SHARE' : 'FOR UPDATE'), true);
    }
  }
  for (const patch of [{ id: '7' }, { id: 2147483648 }, { session_version: 0 }, { rol: '' }]) {
    const f = fixture(); await assert.rejects(create(f, selection(), { ...auth(), ...patch }), { status: 401 });
    await assert.rejects(lookup(f, listA, key, { ...auth(), ...patch }), { status: 401 }); assert.equal(f.leases, 0);
  }
});

test('block/receipt/readback/commit failures roll back all changes; failed rollback discards without hiding primary', async () => {
  for (const failurePrefix of ['INSERT INTO lista_bloques', 'INSERT INTO personal_list_block_create_receipts', 'COMMIT']) {
    for (const rollbackFails of [false, true]) {
      const f = fixture({ failurePrefix, rollbackFails });
      await assert.rejects(create(f), error => error === f.synthetic);
      assert.equal(f.state.blocks.length, 0); assert.equal(f.state.receipts.size, 0);
      assert.deepEqual(f.releases, [rollbackFails ? f.rollbackError : undefined]);
    }
  }
  const f = fixture(); await create(f); const receiptBefore = structuredClone(f.state.receipts);
  const original = f.pool.connect;
  f.pool.connect = async () => { const db = await original(); const query = db.query;
    db.query = async (sql, values) => { if (sql.includes('SELECT b.id,b.lista_id')) throw f.synthetic; return query(sql, values); }; return db; };
  await assert.rejects(lookup(f), error => error === f.synthetic);
  assert.equal(f.state.blocks.length, 1); assert.deepEqual(f.state.receipts, receiptBefore);
});

test('creation result is not observable until COMMIT completes', async () => {
  const commitGate = deferred(), f = fixture({ commitGate }); let settled = false;
  const pending = create(f).then(result => { settled = true; return result; });
  while (!f.calls.some(({ sql }) => sql === 'COMMIT')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); commitGate.resolve(); assert.equal((await pending).replayed, false); assert.equal(settled, true);
});

test('GET failures preserve primary errors, discard only on failed rollback and never mutate', async () => {
  for (const rollbackFails of [false, true]) {
    const options = {}, f = fixture(options); await create(f);
    const before = structuredClone(f.state); f.calls.length = 0; f.releases.length = 0;
    options.failurePrefix = 'SELECT b.id,b.lista_id'; options.rollbackFails = rollbackFails;
    await assert.rejects(lookup(f), error => error === f.synthetic);
    assert.deepEqual(f.state, before); assert.equal(writes(f).length, 0);
    assert.deepEqual(f.releases, [rollbackFails ? f.rollbackError : undefined]);
  }
});

test('receipt engine has no router circular import, DDL, notifications or providers', () => {
  const source = readFileSync(new URL('../src/personal-list-block-create-receipts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*personal-lists\.js|CREATE TABLE|ALTER TABLE|fetch\(|notificar|ON CONFLICT/);
  assert.match(source, /withPersonalListWrite/);
});
