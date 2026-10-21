import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeamPaymentInput, normalizeTeamPaymentVoidInput, teamPaymentId, teamPaymentIntentHash,
  teamPaymentDto, TEAM_PAYMENT_READ_SQL, readTeamPaymentContext, readTeamPayments, recordTeamPayment,
  voidTeamPayment, createTeamPaymentsRouter } from '../src/team-payments.js';

const KEY = '11111111-1111-4111-8111-111111111111';
const VOID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const auth = () => ({ id: 1, session_version: 2, nombre: 'Untrusted cached name', rol: 'admin' });
const actor = () => ({ id: 1, session_version: 2, nombre: 'Current DB administrator', usuario: 'actual_admin', rol: 'admin', activo: true });
const input = changes => ({ operation_key: KEY, recipient_id: 2, fecha_pago: '2026-09-15', periodo_trabajo: '2026-08',
  moneda: 'ARS', importe: '123456.78', referencia: 'Manual payment QA', drive_url: null, attestation: true, ...changes });
const voidInput = changes => ({ operation_key: VOID, expected_revision: 'pay1:1:1', reason: 'Duplicate manual record', attestation: true, ...changes });
const row = changes => ({ id: 1, recipient_id: 2, recipient_name: 'Actual recipient', recorded_by_id: 1,
  recorded_by_name: actor().nombre, fecha_pago: '2026-09-15', periodo_trabajo: '2026-08', moneda: 'ARS', importe: '123456.78',
  referencia: 'Manual payment QA', drive_url: null, provenance: 'manual', status: 'recorded', version: 1,
  created_at: new Date('2026-09-15T15:00:00.000Z'), voided_at: null, voided_by_id: null, void_reason: null, ...changes });

function fixture({ current = actor(), initial = [], failAt, rollbackFailure = false, corruptReadback } = {}) {
  const calls = [], releases = [], failure = new Error('Synthetic private storage failure');
  const rollbackError = new Error('Synthetic rollback failure');
  let state = { payments: structuredClone(initial), events: [], receipts: [] }, baseline;
  const people = [actor(), { id: 2, nombre: 'Actual recipient', usuario: 'actual_recipient', rol: 'edicion', activo: true },
    { id: 3, nombre: 'Inactive recipient', usuario: 'inactive', rol: 'diseno', activo: false }];
  const db = { release: error => releases.push(error), async query(sql, values = []) {
    const stage = sql.startsWith('BEGIN') ? 'begin' : sql === 'COMMIT' ? 'commit' : sql === 'ROLLBACK' ? 'rollback'
      : sql.startsWith('SELECT pg_advisory') ? 'mutex' : sql.startsWith('SELECT id,rol') ? 'actor'
      : sql.startsWith('SELECT id,nombre,usuario,rol') ? 'context' : sql.startsWith('SELECT id,nombre,activo') ? 'recipient'
      : sql.startsWith('SELECT intent_hash') ? 'receipt' : sql.startsWith('INSERT INTO team_payments') ? 'insert'
      : sql.startsWith('UPDATE team_payments') ? 'update' : sql.startsWith('INSERT INTO team_payment_events') ? 'event'
      : sql.startsWith('INSERT INTO team_payment_receipts') ? 'receipt-insert' : sql.startsWith(TEAM_PAYMENT_READ_SQL) ? 'payment' : 'unknown';
    calls.push({ sql, values, stage });
    if (stage === failAt) throw failure;
    if (stage === 'begin') { baseline = structuredClone(state); return { rows: [] }; }
    if (stage === 'commit' || stage === 'mutex') return { rows: [] };
    if (stage === 'rollback') { if (rollbackFailure) throw rollbackError; state = baseline ?? state; return { rows: [] }; }
    if (stage === 'actor') return { rows: current ? [structuredClone(current)] : [] };
    if (stage === 'context') return { rows: people.filter(person => person.activo).map(person => ({ ...person, password_hash: 'MUST_NOT_ESCAPE' })) };
    if (stage === 'recipient') return { rows: people.filter(person => person.id === values[0]) };
    if (stage === 'receipt') return { rows: state.receipts.filter(receipt => receipt.actor_id === values[0] && receipt.operation_key === values[1]) };
    if (stage === 'insert') {
      const [recipient_id, recipient_name, recorded_by_id, recorded_by_name, fecha_pago, workDate, importe, referencia, drive_url] = values;
      const payment = row({ id: state.payments.length + 1, recipient_id, recipient_name, recorded_by_id, recorded_by_name,
        fecha_pago, periodo_trabajo: workDate.slice(0, 7), importe, referencia, drive_url });
      state.payments.push(payment); return { rows: [{ id: payment.id }] };
    }
    if (stage === 'update') {
      const payment = state.payments.find(item => item.id === values[0] && item.version === values[3] && item.status === 'recorded');
      if (!payment) return { rows: [] };
      Object.assign(payment, { status: 'voided', version: payment.version + 1, voided_at: new Date('2026-10-21T15:00:00Z'), voided_by_id: values[1], void_reason: values[2] });
      return { rows: [{ id: payment.id }] };
    }
    if (stage === 'event') { state.events.push({ payment_id: values[0], actor_id: values[1], kind: values[2], reason: values[3] }); return { rows: [] }; }
    if (stage === 'receipt-insert') { state.receipts.push({ actor_id: values[0], operation_key: values[1], intent_hash: values[2], payment_id: values[3] }); return { rows: [] }; }
    if (stage === 'payment') {
      let rows = sql.includes('WHERE p.id=$1') ? state.payments.filter(item => item.id === values[0])
        : state.payments.filter(item => item.fecha_pago.slice(0, 7) === values[0].slice(0, 7)).sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago) || b.id - a.id);
      rows = structuredClone(rows);
      if (corruptReadback && state.receipts.length) rows = rows.map(item => ({ ...item, ...corruptReadback }));
      return { rows };
    }
    assert.fail(`Unexpected SQL stage ${stage}`);
  } };
  return { calls, releases, failure, rollbackError, db, people, pool: { connect: async () => db }, get state() { return state; } };
}

test('create DTO is closed, explicit and normalizes exact decimal/text without deriving amounts or identities', () => {
  const value = normalizeTeamPaymentInput(input({ importe: '1.2', referencia: '  Manual payment QA  ' }), '2026-10-21');
  assert.equal(value.importe, '1.20'); assert.equal(value.referencia, 'Manual payment QA'); assert.equal(Object.isFrozen(value), true);
  assert.equal(normalizeTeamPaymentInput(input({ importe: '999999999999.99' }), '2026-10-21').importe, '999999999999.99');
  for (const changes of [{ recipient_id: '2' }, { recipient_id: 0 }, { recipient_id: 2147483648 }, { attestation: 'true' }, { attestation: false },
    { moneda: 'USD' }, { recipient_name: 'Caller authority' }, { recorded_by_id: 1 }, { status: 'recorded' }, { importe: 1 },
    ...['0', '0.00', '-1', '01', ' 1', '1 ', '1e2', '1.001', '1000000000000', '', '1\n'].map(importe => ({ importe })),
    { referencia: 'ab' }, { referencia: 'x'.repeat(501) }, { referencia: 'text\u0000bad' }, { operation_key: KEY.toUpperCase() },
    { operation_key: KEY + '\n' }, { operation_key: KEY.replace('-4111-', '-5111-') }]) {
    // KEY contains no letters: use an actual upper-case UUID variant separately.
    if (changes.operation_key === KEY) continue;
    assert.throws(() => normalizeTeamPaymentInput(input(changes), '2026-10-21'), { status: 400 });
  }
  assert.throws(() => normalizeTeamPaymentInput(input({ operation_key: 'aaaaaaaa-aaaa-4aaa-8aaa-AAAAAAAAAAAA' }), '2026-10-21'), { status: 400 });
  for (const body of [null, [], {}, { ...input(), drive_url: undefined }]) assert.throws(() => normalizeTeamPaymentInput(body, '2026-10-21'), { status: 400 });
  const missing = input(); delete missing.drive_url;
  assert.throws(() => normalizeTeamPaymentInput(missing, '2026-10-21'), { status: 400 });
});
test('dates are real nonfuture calendar dates; work month is independent and never defaulted', () => {
  assert.equal(normalizeTeamPaymentInput(input({ fecha_pago: '2024-02-29', periodo_trabajo: '2027-01' }), '2026-10-21').periodo_trabajo, '2027-01');
  for (const fecha_pago of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-10-22', '2026-09-15\n', null])
    assert.throws(() => normalizeTeamPaymentInput(input({ fecha_pago }), '2026-10-21'), { status: 400 });
  for (const periodo_trabajo of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-01\n', null])
    assert.throws(() => normalizeTeamPaymentInput(input({ periodo_trabajo }), '2026-10-21'), { status: 400 });
});
test('Drive evidence is optional null or exact HTTPS Google Drive with no credentials/port/lookalikes', () => {
  for (const drive_url of [null, 'https://drive.google.com/file/d/manual/view', 'https://drive.google.com/drive/folders/manual?usp=sharing#evidence'])
    assert.equal(normalizeTeamPaymentInput(input({ drive_url }), '2026-10-21').drive_url, drive_url);
  for (const drive_url of ['', 'http://drive.google.com/file/x', 'https://drive.google.com:443/file/x', 'https://drive.google.com:8443/x',
    'https://user@drive.google.com/file/x', 'https://drive.google.com.evil.test/x', 'https://drive.google.com./x',
    'https://drive.google.com\\@evil.test/x', ' https://drive.google.com/x', 'https://drive.google.com/' + 'x'.repeat(2000), {}, []])
    assert.throws(() => normalizeTeamPaymentInput(input({ drive_url }), '2026-10-21'), { status: 400 });
});
test('void CAS distinguishes missing428, malformed400, cross-record409; body/key/attestation are exact', () => {
  assert.equal(teamPaymentId('1'), 1);
  for (const value of ['01', '1\n', '0', '-1', '2147483648', 1]) assert.throws(() => teamPaymentId(value), { status: 400 });
  const missing = voidInput(); delete missing.expected_revision;
  assert.throws(() => normalizeTeamPaymentVoidInput(missing, 1), { status: 428 });
  for (const expected_revision of ['pay1:1:01', 'pay1:1:0', 'pay1:1:1\n', 'pay1:1:2147483648', null, []])
    assert.throws(() => normalizeTeamPaymentVoidInput(voidInput({ expected_revision }), 1), { status: 400 });
  assert.throws(() => normalizeTeamPaymentVoidInput(voidInput({ expected_revision: 'pay1:2:1' }), 1), { status: 409 });
  for (const changes of [{ attestation: false }, { reason: 'ab' }, { status: 'voided' }, { operation_key: 'not-a-uuid' }])
    assert.throws(() => normalizeTeamPaymentVoidInput(voidInput(changes), 1), { status: 400 });
});
test('intent hashes bind operation/target/normalized business body, not key or caller object key order', () => {
  const a = normalizeTeamPaymentInput(input({ importe: '1', referencia: ' Manual payment QA ' }), '2026-10-21');
  const b = normalizeTeamPaymentInput(Object.fromEntries(Object.entries(input({ importe: '1.00', operation_key: OTHER })).reverse()), '2026-10-21');
  assert.equal(teamPaymentIntentHash('recorded', null, a), teamPaymentIntentHash('recorded', null, b));
  assert.notEqual(teamPaymentIntentHash('recorded', null, a), teamPaymentIntentHash('voided', 1, normalizeTeamPaymentVoidInput(voidInput(), 1)));
});
test('record locks mutex before actor/recipient, snapshots DB names, writes one event/receipt, verifies closed readback before commit', async () => {
  const f = fixture(), result = await recordTeamPayment(f.pool, auth(), input());
  assert.equal(result.status, 201); assert.equal(result.body.replayed, false); assert.equal(result.body.version, 1);
  assert.equal(result.body.payment.recipient_name, 'Actual recipient'); assert.equal(result.body.payment.recorded_by_name, actor().nombre);
  assert.equal(result.body.payment.revision, 'pay1:1:1'); assert.equal(f.state.events.length, 1); assert.equal(f.state.receipts.length, 1);
  assert.deepEqual(f.calls.map(call => call.stage), ['begin', 'mutex', 'actor', 'receipt', 'recipient', 'insert', 'event', 'receipt-insert', 'payment', 'commit']);
  assert.equal(f.calls[1].sql, 'SELECT pg_advisory_xact_lock(20261019, 1)');
  assert.match(f.calls[2].sql, /FOR SHARE$/); assert.match(f.calls[4].sql, /FOR SHARE$/);
  assert.deepEqual(f.releases, [undefined]);
});
test('captured ID/epoch and normalized immutable intent survive pool wait; self/owner recipient is allowed', async () => {
  const f = fixture(), identity = auth(), body = input({ recipient_id: 1 });
  f.pool.connect = async () => { identity.id = 99; identity.session_version = 99; body.importe = '999'; body.recipient_id = 3; return f.db; };
  const result = await recordTeamPayment(f.pool, identity, body);
  assert.equal(result.body.payment.recipient_id, 1); assert.equal(result.body.payment.importe, '123456.78');
  assert.deepEqual(f.calls.find(call => call.stage === 'actor').values, [1]);
});
test('revoked/missing/inactive/downgraded current actors cannot mutate or replay; labels never grant authority', async () => {
  for (const current of [null, { ...actor(), activo: false }, { ...actor(), session_version: 3 }, { ...actor(), id: 2 }, { ...actor(), rol: 'edicion', nombre: 'admin' }]) {
    const f = fixture({ current });
    await assert.rejects(recordTeamPayment(f.pool, auth(), input()), { status: current?.rol === 'edicion' ? 403 : 401 });
    assert.deepEqual(f.state, { payments: [], events: [], receipts: [] });
    assert.ok(!f.calls.some(call => call.stage === 'receipt'));
  }
  for (const recipient_id of [3, 999]) {
    const f = fixture(); await assert.rejects(recordTeamPayment(f.pool, auth(), input({ recipient_id })), { status: 409 });
    assert.equal(f.state.payments.length, 0);
  }
  const f = fixture();
  assert.throws(() => recordTeamPayment(f.pool, { id: '1', session_version: 2 }, input()), { status: 401 }); assert.equal(f.calls.length, 0);
});
test('exact create replay is200 and current, with no DML; mismatched payload or cross-operation key is409', async () => {
  const f = fixture(); await recordTeamPayment(f.pool, auth(), input());
  const before = structuredClone(f.state), start = f.calls.length;
  const replay = await recordTeamPayment(f.pool, auth(), input());
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.deepEqual(f.state, before);
  assert.ok(!f.calls.slice(start).some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)));
  await assert.rejects(recordTeamPayment(f.pool, auth(), input({ importe: '1.00' })), { status: 409 });
  await assert.rejects(voidTeamPayment(f.pool, auth(), '1', voidInput({ operation_key: KEY })), { status: 409 });
  assert.deepEqual(f.state, before);
});
test('void preserves original facts, locks payment, increments version and adds one event/receipt; replay never reactivates', async () => {
  const f = fixture(); await recordTeamPayment(f.pool, auth(), input());
  const original = structuredClone(f.state.payments[0]), result = await voidTeamPayment(f.pool, auth(), '1', voidInput());
  assert.equal(result.status, 200); assert.equal(result.body.payment.status, 'voided'); assert.equal(result.body.payment.revision, 'pay1:1:2');
  for (const key of Object.keys(original).filter(key => !['version', 'status', 'voided_at', 'voided_by_id', 'void_reason'].includes(key))) assert.deepEqual(f.state.payments[0][key], original[key]);
  assert.equal(f.state.events.length, 2); assert.equal(f.state.events[1].kind, 'voided'); assert.equal(f.state.receipts.length, 2);
  assert.ok(f.calls.some(call => call.stage === 'payment' && /FOR UPDATE OF p$/.test(call.sql)));
  const before = structuredClone(f.state), count = f.calls.length;
  assert.equal((await voidTeamPayment(f.pool, auth(), '1', voidInput())).body.replayed, true);
  assert.equal((await recordTeamPayment(f.pool, auth(), input())).body.payment.status, 'voided');
  assert.ok(!f.calls.slice(count).some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)));
  await assert.rejects(voidTeamPayment(f.pool, auth(), '1', voidInput({ operation_key: OTHER, expected_revision: 'pay1:1:2' })), { status: 409 });
  assert.deepEqual(f.state, before);
});
test('new-key stale void conflicts and missing resource404 leave payment/event/receipt unchanged', async () => {
  const f = fixture({ initial: [row()] }), before = structuredClone(f.state);
  await assert.rejects(voidTeamPayment(f.pool, auth(), '1', voidInput({ expected_revision: 'pay1:1:2' })), { status: 409 });
  await assert.rejects(voidTeamPayment(f.pool, auth(), '2', voidInput({ expected_revision: 'pay1:2:1' })), { status: 404 });
  assert.deepEqual(f.state, before);
});
test('create readback rejects wrong recipient snapshot or initial revision before acknowledging or committing', async () => {
  for (const corruptReadback of [{ recipient_name: 'Not selected DB recipient' }, { version: 2 }, { importe: '1.00' }, { recorded_by_name: 'Cached name' }]) {
    const f = fixture({ corruptReadback });
    await assert.rejects(recordTeamPayment(f.pool, auth(), input()), /Invalid team payment storage/);
    assert.deepEqual(f.state, { payments: [], events: [], receipts: [] }); assert.equal(f.calls.at(-1).stage, 'rollback');
  }
});
for (const stage of ['begin', 'mutex', 'actor', 'recipient', 'receipt', 'insert', 'event', 'receipt-insert', 'payment', 'commit'])
  test(`record ${stage} storage failure rolls back payment/event/receipt, never retries or confirms`, async () => {
    const f = fixture({ failAt: stage });
    await assert.rejects(recordTeamPayment(f.pool, auth(), input()), error => error === f.failure);
    assert.deepEqual(f.state, { payments: [], events: [], receipts: [] });
    assert.equal(f.calls.at(-1).stage, 'rollback'); assert.deepEqual(f.releases, [undefined]);
  });
test('void audit failure rolls back status/version and original history; rollback failure preserves original and discards lease', async () => {
  const f = fixture({ initial: [row()], failAt: 'event' }), before = structuredClone(f.state);
  await assert.rejects(voidTeamPayment(f.pool, auth(), '1', voidInput()), error => error === f.failure); assert.deepEqual(f.state, before);
  const broken = fixture({ failAt: 'insert', rollbackFailure: true });
  await assert.rejects(recordTeamPayment(broken.pool, auth(), input()), error => error === broken.failure);
  assert.deepEqual(broken.releases, [broken.rollbackError]);
});
test('context is current-admin RR read-only and closed; active actual IDs include the owner, no credential/financial fields', async () => {
  const f = fixture(), value = await readTeamPaymentContext(f.pool, auth(), {});
  assert.equal(value.version, 1); assert.deepEqual(value.recipients.map(person => person.id), [1, 2]);
  for (const person of value.recipients) assert.deepEqual(Object.keys(person), ['id', 'nombre', 'usuario', 'rol']);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(!f.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)));
  const denied = fixture({ current: { ...actor(), rol: 'community' } });
  await assert.rejects(readTeamPaymentContext(denied.pool, auth()), { status: 403 });
  assert.ok(!denied.calls.some(call => call.stage === 'context'));
});
test('list uses actual payment date, includes voids, exact cents, no hidden limit and all supported historical months', async () => {
  const initial = [row({ id: 1, fecha_pago: '2025-01-09', periodo_trabajo: '2026-10', importe: '0.10' }),
    row({ id: 2, fecha_pago: '2025-01-10', importe: '0.20' }),
    row({ id: 3, fecha_pago: '2025-01-10', importe: '999999999999.99', status: 'voided', version: 2, voided_at: new Date(), voided_by_id: 1, void_reason: 'Explicit correction' }),
    row({ id: 4, fecha_pago: '2026-10-01', periodo_trabajo: '2025-01' })];
  const f = fixture({ initial }), value = await readTeamPayments(f.pool, auth(), { periodo: '2025-01' });
  assert.deepEqual(value.items.map(item => item.id), [3, 2, 1]); assert.equal(value.total_recorded_ars, '0.30');
  assert.equal(value.periodo, '2025-01'); assert.equal(value.version, 1);
  assert.ok(!f.calls.some(call => /LIMIT|OFFSET|^(INSERT|UPDATE|DELETE)/.test(call.sql)));
  const large = fixture({ initial: Array.from({ length: 1100 }, (_, index) => row({ id: index + 1, importe: '999999999999.99' })) });
  const all = await readTeamPayments(large.pool, auth(), { periodo: '2026-09' });
  assert.equal(all.items.length, 1100); assert.equal(all.total_recorded_ars, '1099999999999989.00');
});
test('closed/duplicate/non-scalar list queries and any context filter reject before pool access', async () => {
  const f = fixture();
  for (const query of [null, {}, [], { periodo: ['2026-10'] }, { periodo: {} }, { periodo: '0000-01' }, { periodo: '2026-13' },
    { periodo: '2026-10\n' }, { periodo: '2026-10', limit: '20' }]) await assert.rejects(readTeamPayments(f.pool, auth(), query), { status: 400 });
  await assert.rejects(readTeamPaymentContext(f.pool, auth(), { periodo: '2026-10' }), { status: 400 });
  assert.equal(f.calls.length, 0);
});
test('safe payment DTO has exactly contract fields and fails closed on malformed stored monetary/void evidence', () => {
  const value = teamPaymentDto({ ...row(), password_hash: 'MUST_NOT_ESCAPE', bank: 'MUST_NOT_ESCAPE' });
  assert.deepEqual(Object.keys(value), ['id', 'recipient_id', 'recipient_name', 'recorded_by_id', 'recorded_by_name', 'fecha_pago', 'periodo_trabajo',
    'moneda', 'importe', 'referencia', 'drive_url', 'provenance', 'status', 'revision', 'created_at', 'voided_at', 'voided_by_id', 'void_reason']);
  assert.equal(value.created_at, '2026-09-15T15:00:00.000Z');
  for (const change of [{ importe: 1 }, { importe: '1.2' }, { importe: '0.00' }, { status: 'paid' }, { provenance: 'provider' },
    { status: 'voided' }, { void_reason: 'Unmatched void' }, { created_at: 'bad timestamp' }]) assert.throws(() => teamPaymentDto(row(change)), /Invalid team payment storage/);
});
test('router exports only exact GET/POST routes, no-store errors, no PATCH/DELETE and no import-time IO', async () => {
  const routes = [], f = fixture();
  createTeamPaymentsRouter({ pool: f.pool, express: { Router: () => ({ get(path, handler) { routes.push({ method: 'GET', path, handler }); }, post(path, handler) { routes.push({ method: 'POST', path, handler }); } }) } });
  assert.deepEqual(routes.map(route => [route.method, route.path]), [['GET', '/contexto'], ['GET', '/'], ['POST', '/'], ['POST', '/:id/anular']]);
  assert.equal(f.calls.length, 0);
  const invoke = async (route, req) => {
    const result = { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await route.handler(req, result, error => { result.error = error; }); return result;
  };
  const denied = await invoke(routes[1], { auth: auth(), query: { periodo: ['2026-10'] } });
  assert.equal(denied.statusCode, 400); assert.equal(denied.headers['Cache-Control'], 'no-store'); assert.equal(f.calls.length, 0);
  const create = await invoke(routes[2], { auth: auth(), query: {}, body: input() });
  assert.equal(create.statusCode, 201); assert.equal(create.body.payment.provenance, 'manual');
  const forbiddenQuery = await invoke(routes[2], { auth: auth(), query: { actor: 'other' }, body: input() });
  assert.equal(forbiddenQuery.statusCode, 400);
});
