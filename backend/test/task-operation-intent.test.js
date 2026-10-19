import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTaskOperationIntent, taskOperationKey, taskOperationIntentHash,
  taskOperationConfirmationHash, taskOperationEventKey, findTaskOperationReceipt,
  consumeTaskOperationConfirmation, taskOperationReceiptDto } from '../src/task-operation-receipts.js';

const edit = (input = {}, targetId = 91) => canonicalTaskOperationIntent({ expected_revision: 7, ...input }, { operation: 'editar', targetId });
const create = input => canonicalTaskOperationIntent(input, { operation: 'crear' });
const hash = input => taskOperationIntentHash(edit(input));
const status = expected => error => error.status === expected;
const token = '00000000-0000-4000-8000-000000000001';
const req = (overrides = {}) => ({ body: { confirmacion_token: token }, wilson: {
  channel: 'whatsapp', actorId: 'external-actor', groupId: 'conversation', userId: 22, ...overrides } });

test('equivalent aliases normalize once, independently of object order', () => {
  const aliased = edit({ responsable: ' Persona ', vencimiento: '2026-10-22', lista: 'Diseño',
    aclaraciones: ' Brief ', material_referencia: ' Drive ', prioridad: 'ALTA' });
  const canonical = edit({ prioridad: 'alta', material: 'Drive', descripcion: 'Brief',
    sector: 'diseno', fecha_vencimiento: '2026-10-22', asignado_a: 'Persona' });
  assert.deepEqual(aliased, canonical);
  assert.equal(taskOperationIntentHash(aliased), taskOperationIntentHash(canonical));
  assert.equal(edit({ tipo_tarea: 'Comunidad' }).business.sector, 'community');
  assert.deepEqual(edit({ descripcion: ' A ', aclaraciones: 'A' }).business, { descripcion: 'A' });
});

test('contradictory aliases, selectors and responsibility lists reject 400', () => {
  for (const input of [{ descripcion: 'A', aclaraciones: 'B' }, { sector: 'diseno', tipo_tarea: 'edicion' },
    { responsable: 'A', asignado_a: 'B' }, { cliente_id: 1, cliente: 'Client' },
    { asignado_a_id: 1, asignado_a: 'Person' }, { colaborador_ids: [1], colaboradores: ['Person'] },
    { responsables: ['A', 'B'], asignado_a: 'B' }, { responsables: ['A', 'B'], colaboradores: ['C'] }])
    assert.throws(() => edit(input), status(400));
});

test('responsables expands to explicit owner and collaborators; duplicate entries normalize', () => {
  assert.deepEqual(edit({ responsables: [' A ', 'B', 'B'] }).business, { asignado_a: 'A', colaboradores: ['B'] });
  assert.deepEqual(edit({ colaborador_ids: [3, 3, 4] }).business, { colaborador_ids: [3, 4] });
  assert.deepEqual(edit({ asignado_a_id: 2, asignado_a: '', colaborador_ids: [], colaboradores: [] }).business,
    { asignado_a_id: 2, colaborador_ids: [] });
});

test('omission, explicit null, empty text and clearing collaborators remain different intentions', () => {
  const untouched = edit({ titulo: 'T' });
  for (const change of [{ descripcion: null }, { descripcion: '' }, { colaborador_ids: [] }, { produccion_videos_previstos: null }])
    assert.notEqual(taskOperationIntentHash(untouched), hash({ titulo: 'T', ...change }));
  assert.notEqual(hash({ descripcion: null }), hash({ descripcion: '' }));
  assert.equal(hash({ fecha_vencimiento: '' }), hash({ fecha_vencimiento: null }));
  assert.ok(!Object.hasOwn(untouched.business, 'asignado_a_id'));
  assert.ok(!Object.hasOwn(untouched.business, 'colaborador_ids'));
});

test('append remains an append intention, not replacement or merge with a live task', () => {
  const intent = edit({ append_descripcion: ' Add this ' });
  assert.deepEqual(intent.business, { append_descripcion: 'Add this' });
  assert.notEqual(taskOperationIntentHash(intent), hash({ descripcion: 'Add this' }));
  assert.throws(() => edit({ append_descripcion: 'A', descripcion: 'B' }), status(400));
  assert.throws(() => create({ append_descripcion: 'A' }), status(400));
});

test('target, observed revision, duplicate override and operation bind the intention hash', () => {
  const base = edit({ titulo: 'T' });
  for (const alternative of [edit({ titulo: 'T' }, 92), edit({ titulo: 'T', expected_revision: 8 }),
    edit({ titulo: 'T', permitir_duplicado: true }), create({ titulo: 'T' })])
    assert.notEqual(taskOperationIntentHash(base), taskOperationIntentHash(alternative));
  assert.equal(hash({ titulo: 'T' }), hash({ titulo: 'T', permitir_duplicado: false }));
  assert.throws(() => edit({ titulo: 'T', permitir_duplicado: 'true' }), status(400));
});

test('all destructive/edit operations require positive integer target and revision, never timestamps', () => {
  for (const operation of ['editar', 'archivar', 'eliminar']) {
    for (const expected_revision of [undefined, null, 0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => canonicalTaskOperationIntent({ titulo: 'T', expected_revision }, { operation, targetId: 91 }), status(400));
    for (const targetId of [null, 0, -1, '91', 1.5])
      assert.throws(() => canonicalTaskOperationIntent({ expected_revision: 7 }, { operation, targetId }), status(400));
  }
  assert.throws(() => edit({ titulo: 'T', expected_updated_at: '2026-10-01T00:00:00Z' }), status(400));
  assert.throws(() => canonicalTaskOperationIntent({}, { operation: 'crear', targetId: 91 }), status(400));
});

test('archive/delete accept only transport and observed revision, not hidden business mutations', () => {
  for (const operation of ['archivar', 'eliminar']) {
    const intent = canonicalTaskOperationIntent({ expected_revision: 7 }, { operation, targetId: 91 });
    assert.deepEqual(intent.business, {});
    for (const input of [{ titulo: 'T' }, { permitir_duplicado: true }, { estado: 'finalizada' }])
      assert.throws(() => canonicalTaskOperationIntent({ expected_revision: 7, ...input }, { operation, targetId: 91 }), status(400));
  }
});

test('malformed types, unknown fields and approval/provenance writes reject instead of dropping', () => {
  for (const input of [{ titulo: {} }, { descripcion: [] }, { asignado_a_id: '2' }, { cliente_id: null },
    { colaborador_ids: [1, null] }, { colaboradores: [false] }, { responsables: [] },
    { prioridad: 'urgent' }, { sector: 'unknown' }, { produccion_videos_previstos: 1.5 },
    { fecha_vencimiento: '2026-02-30' }, { fecha_vencimiento: '2026-10-22T00:00:00Z' },
    { estado: 'finalizada' }, { aprobada: true }, { wilson_last_update_key: 'key' },
    { origen_integracion: 'wilson' }, { propiedades_extra: {} }, { arbitrary: true }, { titulo: 'a\0b' }])
    assert.throws(() => edit(input), status(400));
  for (const input of [null, [], 'text']) assert.throws(() => canonicalTaskOperationIntent(input, { operation: 'crear' }), status(400));
  assert.throws(() => edit({}), status(400));
});

test('pure normalization does not mutate frozen caller arrays or objects', () => {
  const input = Object.freeze({ expected_revision: 7, colaborador_ids: Object.freeze([3, 3, 4]) });
  assert.deepEqual(canonicalTaskOperationIntent(input, { operation: 'editar', targetId: 91 }).business.colaborador_ids, [3, 4]);
  assert.deepEqual(input.colaborador_ids, [3, 3, 4]);
});

test('transport secrets do not affect intent hash; canonical key validation rejects disagreement/types/controls', () => {
  assert.equal(hash({ titulo: 'T' }), hash({ titulo: 'T', idempotency_key: 'key', confirmacion_token: token, confirmado: true,
    confirmado_en: 'transport', telegram_user_id: 'transport' }));
  assert.equal(taskOperationKey({ 'idempotency-key': ' key ' }, { idempotency_key: 'key' }), 'key');
  assert.equal(taskOperationKey({}, { idempotency_key: 'x'.repeat(200) }).length, 200);
  for (const value of ['', ' ', 'x'.repeat(201), 1, null, [], 'a\nb', 'a\u007fb', 'a\u0085b'])
    assert.throws(() => taskOperationKey({}, { idempotency_key: value }), status(400));
  assert.throws(() => taskOperationKey({ 'idempotency-key': 'A' }, { idempotency_key: 'B' }), status(400));
});

test('confirmation hash binds stable actor, key and resolved ID selections, independent of object key order', () => {
  const base = { intent: edit({ asignado_a: 'Same label' }), userId: 22, key: 'key', selections: { cliente_id: 3, asignado_a_id: 8 } };
  const expected = taskOperationConfirmationHash(base);
  assert.equal(expected, taskOperationConfirmationHash({ ...base, selections: { asignado_a_id: 8, cliente_id: 3 } }));
  for (const change of [{ userId: 23 }, { key: 'other' }, { selections: { cliente_id: 3, asignado_a_id: 9 } },
    { intent: edit({ asignado_a: 'Same label' }, 92) }])
    assert.notEqual(expected, taskOperationConfirmationHash({ ...base, ...change }));
  assert.throws(() => taskOperationConfirmationHash({ ...base, userId: '22' }), status(403));
  const event = { userId: 22, operation: 'editar', key: 'key', payloadHash: 'a'.repeat(64) };
  for (const change of [{ userId: 23 }, { operation: 'crear' }, { key: 'other' }, { payloadHash: 'b'.repeat(64) }])
    assert.notEqual(taskOperationEventKey(event), taskOperationEventKey({ ...event, ...change }));
});

test('receipt lookup locks actor/operation/key scope first, binds hash and never queries JSON metadata', async () => {
  const calls = [], scope = { userId: 22, operation: 'editar', key: 'key', payloadHash: 'a'.repeat(64) };
  let receipt = { payload_hash: scope.payloadHash, task_id: 91 };
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: sql.startsWith('SELECT operation') ? [receipt] : [] }; } };
  assert.equal(await findTaskOperationReceipt(db, scope), receipt);
  assert.deepEqual(JSON.parse(calls[0].params[0]), ['task-operation-receipt-v1', 22, 'editar', 'key']);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls[1].params, [22, 'editar', 'key']);
  assert.match(calls[1].sql, /actor_user_id=\$1 AND operation=\$2 AND idempotency_key=\$3/);
  assert.ok(calls.every(({ sql }) => !/propiedades_extra|FROM tareas/.test(sql)));
  receipt = { ...receipt, payload_hash: 'b'.repeat(64) };
  await assert.rejects(findTaskOperationReceipt(db, scope), status(409));
});

test('receipt DTO exposes only minimal immutable result fields', () => {
  const safe = { operation: 'editar', task_id: 91, task_revision: 7, outcome: 'unchanged', changed_fields: [], committed_at: '2026-10-22T00:00:00Z' };
  assert.deepEqual(taskOperationReceiptDto({ ...safe, payload_hash: 'secret', idempotency_key: 'secret', contenido: 'secret', actor_user_id: 22 }), safe);
});

test('both channels consume exact scoped tokens after locking without an expiry predicate', async () => {
  for (const channel of ['whatsapp', 'telegram']) {
    const calls = [], request = req({ channel }), intent = edit({ titulo: 'T' }), selections = { asignado_a_id: 8 };
    const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ token }] }; } };
    await consumeTaskOperationConfirmation(db, request, intent, 'key', selections);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /FOR UPDATE$/);
    assert.doesNotMatch(calls[0].sql, /expires_at|used_at|NOW\(\)|clock_timestamp/);
    assert.match(calls[1].sql, /SET used_at=clock_timestamp\(\)/);
    assert.match(calls[1].sql, /used_at IS NULL AND expires_at>clock_timestamp\(\) RETURNING token/);
    assert.deepEqual(calls[0].params, [token, channel, 'external-actor', 'conversation', 'editar', 91,
      taskOperationConfirmationHash({ intent, userId: 22, key: 'key', selections })]);
    assert.deepEqual(calls[1].params, calls[0].params);
  }
});

test('missing/foreign token never updates; expiration after simulated lock wait rejects 409', async () => {
  const intent = edit({ titulo: 'T' });
  let calls = 0;
  const forbidden = { async query() { calls++; return { rows: [] }; } };
  await assert.rejects(consumeTaskOperationConfirmation(forbidden, { ...req(), body: { confirmado: true } }, intent, 'key'), status(400));
  assert.equal(calls, 0);
  await assert.rejects(consumeTaskOperationConfirmation(forbidden, req(), intent, 'key'), status(409));
  assert.equal(calls, 1);
  let releaseLock;
  const lockWait = new Promise(resolve => { releaseLock = resolve; });
  const statements = [];
  const db = { async query(sql) { statements.push(sql); if (statements.length === 1) { await lockWait; return { rows: [{ token }] }; } return { rows: [] }; } };
  const consuming = consumeTaskOperationConfirmation(db, req(), intent, 'key');
  assert.equal(statements.length, 1, 'expiry UPDATE cannot execute before scoped lock is acquired');
  releaseLock();
  await assert.rejects(consuming, status(409));
  assert.equal(statements.length, 2);
});
