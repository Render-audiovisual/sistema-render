import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {persistAssignedTask} from '../src/task-persistence.js';
import {
  captureTaskCreateReceipt, beginTaskCreateReceipt,
  readTaskCreateReceiptTask, recordTaskCreateReceipt,
} from '../src/task-create-receipts.js';

// Pure helpers and bounded SQL doubles only: no pool, listeners or environment.
const requestId = 'ABCDEF01-2345-4678-ABCD-0123456789AB';
const intent = () => ({ workspace: 'render_os', titulo: 'Synthetic task',
  asignado_a_id: 91003, colaborador_ids: [91001, 91002],
  cliente_id: null, tarea_padre_id: null, fecha_vencimiento: null,
  tipo_tarea: 'edicion', aclaraciones: 'Private synthetic draft',
  metadata: { tags: ['a', 'b'], enabled: false, amount: 2 } });
const capture = value => captureTaskCreateReceipt({ requestId, intent: value ?? intent() });
test('persistence rejects receipt on an unbound/non-create operation before acquiring a connection',async()=>{
  const pool={connect:()=>assert.fail('Invalid opt-in cannot lease a connection')};
  const assignment={ownerId:91003,collaboratorIds:[]};
  await assert.rejects(persistAssignedTask(pool,'UPDATE tareas',[],assignment,null,null,
    {createReceipt:{requestId,intent:intent()}}),{status:400});
  await assert.rejects(persistAssignedTask(pool,'INSERT INTO tareas',[],assignment,null,null,
    {assignmentNotificationMode:'created',createReceipt:{requestId,intent:intent()}}),{status:401});
});
function stub(rows = []) {
  const calls = [];
  return { calls, async query(sql, values) { calls.push({ sql, values }); return { rows }; } };
}

test('capture is synchronous, frozen and retains only canonical UUID and a namespaced digest', () => {
  const source = intent(), original = structuredClone(source), result = capture(source);
  assert.equal(typeof result?.then, 'undefined');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), ['payloadHash', 'requestId']);
  assert.equal(result.requestId, requestId.toLowerCase());
  assert.match(result.payloadHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(source, original);
  source.metadata.tags.push('later'); source.titulo = 'Changed';
  assert.equal(result.payloadHash, capture(original).payloadHash);
  assert.equal(JSON.stringify(result).includes('Private synthetic draft'), false);
});

test('hash uses the versioned canonical JSON, sorts nested object keys and preserves array order', () => {
  const a = { workspace: 'render_os', z: { b: 2, a: 1 }, a: [false, null, 'x'] };
  const b = { a: [false, null, 'x'], z: { a: 1, b: 2 }, workspace: 'render_os' };
  const canonical = '{"a":[false,null,"x"],"workspace":"render_os","z":{"a":1,"b":2}}';
  const expected = createHash('sha256').update('render-task-create-v1\n' + canonical).digest('hex');
  assert.equal(capture(a).payloadHash, expected);
  assert.equal(capture(b).payloadHash, expected);
  assert.notEqual(capture({ ...a, a: ['x', null, false] }).payloadHash, expected);
  assert.equal(captureTaskCreateReceipt({ requestId: '00000000-0000-4000-8000-000000000001', intent: a }).payloadHash, expected);
});

test('every changed business field, explicit null and missing field affect the digest', () => {
  const original = intent(), baseline = capture(original).payloadHash;
  for (const [key, value] of Object.entries({ titulo: 'Other', asignado_a_id: 91004,
    colaborador_ids: [91002], cliente_id: 7, tarea_padre_id: 8,
    fecha_vencimiento: '2026-10-30', tipo_tarea: 'produccion', aclaraciones: '',
    produccion_videos_previstos: 3, metadata: { tags: ['a'], enabled: false, amount: 2 } })) {
    assert.notEqual(capture({ ...original, [key]: value }).payloadHash, baseline, `Changed ${key} cannot replay`);
  }
  const missing = { ...original }; delete missing.cliente_id;
  assert.notEqual(capture(missing).payloadHash, baseline);
});

test('invalid UUIDs and non-shared or non-object intents reject synchronously', () => {
  for (const value of [null, undefined, '', 'x', requestId + '\n', requestId.slice(1), 1])
    assert.throws(() => captureTaskCreateReceipt({ requestId: value, intent: intent() }), { status: 400 });
  for (const value of [null, [], 'text', 1, {}, { workspace: 'historical' }, Object.create(null)])
    assert.throws(() => captureTaskCreateReceipt({ requestId, intent: value }), { status: 400 });
});

test('non-finite numbers, unsupported values, exotic objects and sparse arrays fail closed', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, 1n, Symbol('x'), () => 1,
    new Date('2026-01-01'), new Map(), Object.create(null), Array(1)]) {
    assert.throws(() => capture({ workspace: 'render_os', nested: { value } }), { status: 400 });
  }
});

test('cycles, excessive depth, arrays and UTF8 payload size have bounded rejection', () => {
  const cyclic = { workspace: 'render_os' }; cyclic.self = cyclic;
  assert.throws(() => capture(cyclic), { status: 400 });
  let nested = null; for (let i = 0; i < 32; i++) nested = { nested };
  assert.throws(() => capture({ workspace: 'render_os', nested }), { status: 400 });
  assert.throws(() => capture({ workspace: 'render_os', values: Array(1001).fill(0) }), { status: 400 });
  assert.throws(() => capture({ workspace: 'render_os', text: 'á'.repeat(100001) }), { status: 400 });
  assert.match(capture({ workspace: 'render_os', values: Array(1000).fill(0) }).payloadHash, /^[a-f0-9]{64}$/);
});

test('begin obtains actor/UUID namespaced transaction mutex before receipt lookup and never starts a transaction', async () => {
  const db = stub(), own = capture();
  assert.equal(await beginTaskCreateReceipt(db, own, 91003), null);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/);
  assert.deepEqual(JSON.parse(db.calls[0].values[0]), ['render-task-create-v1', 91003, own.requestId]);
  assert.match(db.calls[1].sql, /FROM task_create_receipts/);
  assert.match(db.calls[1].sql, /actor_user_id=\$1 AND request_id=\$2/);
  assert.deepEqual(db.calls[1].values, [91003, own.requestId]);
  assert.doesNotMatch(db.calls.map(call => call.sql).join('\n'), /\b(?:BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE)\b/);
  const other = stub(); await beginTaskCreateReceipt(other, own, 91002);
  assert.notEqual(other.calls[0].values[0], db.calls[0].values[0]);
});

test('matching replay returns receipt; same actor/UUID with different payload is409 without mutation', async () => {
  const own = capture(), receipt = { task_id: 7, task_revision: '1', payload_hash: own.payloadHash };
  assert.equal(await beginTaskCreateReceipt(stub([receipt]), own, 91003), receipt);
  const db = stub([{ ...receipt, payload_hash: '0'.repeat(64) }]);
  await assert.rejects(beginTaskCreateReceipt(db, own, 91003), { status: 409 });
  assert.equal(db.calls.length, 2);
  assert.doesNotMatch(db.calls.map(call => call.sql).join('\n'), /\b(?:INSERT|UPDATE|DELETE)\b/);
});

test('invalid actor cannot acquire a receipt mutex or query DB', async () => {
  for (const actorId of [null, 0, -1, '91003', 2147483648, NaN]) {
    const db = stub();
    await assert.rejects(beginTaskCreateReceipt(db, capture(), actorId), { status: 401 });
    assert.equal(db.calls.length, 0);
  }
});

test('replay reads current shared task under a row lock, excludes trash and does not restore receipt revision', async () => {
  const current = { id: 7, revision: 9, titulo: 'Current title' }, db = stub([current]);
  assert.equal(await readTaskCreateReceiptTask(db, { task_id: 7, task_revision: '1' }), current);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].values, [7]);
  assert.match(db.calls[0].sql, /workspace'='render_os'/);
  assert.match(db.calls[0].sql, /papelera_render_os/);
  assert.match(db.calls[0].sql, /FOR SHARE/);
  assert.doesNotMatch(db.calls[0].sql, /\b(?:INSERT|UPDATE|DELETE)\b/);
});

test('gone, hidden or malformed receipt task identity is404, never a request to recreate', async () => {
  const db = stub();
  await assert.rejects(readTaskCreateReceiptTask(db, { task_id: 7 }), { status: 404 });
  assert.equal(db.calls.length, 1);
  for (const receipt of [null, {}, { task_id: 0 }, { task_id: '7' }, { task_id: 2147483648 }]) {
    const invalid = stub();
    await assert.rejects(readTaskCreateReceiptTask(invalid, receipt), { status: 404 });
    assert.equal(invalid.calls.length, 0);
  }
});

test('record stores only minimal correlated evidence and leaves transaction lifecycle to caller', async () => {
  const db = stub(), own = capture();
  await recordTaskCreateReceipt(db, own, 91003, { id: 7, revision: '1', titulo: 'Private synthetic draft' });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO task_create_receipts\(actor_user_id,request_id,payload_hash,task_id,task_revision\)/);
  assert.deepEqual(db.calls[0].values, [91003, own.requestId, own.payloadHash, 7, '1']);
  assert.equal(JSON.stringify(db.calls).includes('Private synthetic draft'), false);
  assert.doesNotMatch(db.calls[0].sql, /\b(?:BEGIN|COMMIT|ROLLBACK)\b/);
});

test('unverifiable saved task or actor cannot create a receipt', async () => {
  for (const [actorId, task] of [[0, { id: 7, revision: 1 }], [91003, null],
    [91003, { id: 0, revision: 1 }], [91003, { id: 7, revision: 0 }],
    [91003, { id: 7, revision: NaN }], [91003, { id: 7, revision: Number.MAX_SAFE_INTEGER + 1 }],
    ...[true,[1],'01','1\n',' 1'].map(revision=>[91003,{id:7,revision}])]) {
    const db = stub();
    await assert.rejects(recordTaskCreateReceipt(db, capture(), actorId, task), { status: 409 });
    assert.equal(db.calls.length, 0);
  }
});

test('SQL failures propagate unchanged so transaction owner can roll back or classify uncertainty', async () => {
  const failure = new Error('Synthetic SQL failure'), db = { query: async () => { throw failure; } };
  await assert.rejects(beginTaskCreateReceipt(db, capture(), 91003), error => error === failure);
  await assert.rejects(readTaskCreateReceiptTask(db, { task_id: 7 }), error => error === failure);
  await assert.rejects(recordTaskCreateReceipt(db, capture(), 91003, { id: 7, revision: 1 }), error => error === failure);
});
