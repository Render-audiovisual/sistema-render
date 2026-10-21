import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Only a disposable, identity-checked principal server. No bank/Drive/provider calls.
test('manual team payment ledger: exact money, current authority, idempotency and append-only void history', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55753 });
  const connections = new Set();
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA111 cleanup ENOENT: ${f.root}; PostgreSQL port55753`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55753/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55753, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa111-own-barrier', statement_timeout: 15000 });
    connections.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); connections.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected principal HTTP status'); return result.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), otherAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  const [clock] = await f.query(`SELECT to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+1,'YYYY-MM-DD') AS tomorrow,
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period`);
  const base = '/finanzas/pagos';
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const http = async (path, token, method = 'GET', body) => {
    const response = await fetch(new URL(`/api${path}`, f.base), { method, signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const cents = value => {
    assert.match(value, /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
    const [whole, fraction] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction);
  };
  const money = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  const make = (extra = {}) => ({ operation_key: randomUUID(), recipient_id: 91003, fecha_pago: clock.today,
    periodo_trabajo: '2026-09', moneda: 'ARS', importe: '123.45', referencia: 'QA111 manual partial payment',
    drive_url: 'https://drive.google.com/file/d/QA111-synthetic/view', attestation: true, ...extra });
  const users = new Map((await f.query('SELECT id,nombre FROM usuarios ORDER BY id')).map(row => [row.id, row.nombre]));
  const expected = new Map();
  const paymentKeys = ['id', 'recipient_id', 'recipient_name', 'recorded_by_id', 'recorded_by_name', 'fecha_pago',
    'periodo_trabajo', 'moneda', 'importe', 'referencia', 'drive_url', 'provenance', 'status', 'revision', 'created_at',
    'voided_at', 'voided_by_id', 'void_reason'];
  const checkPayment = payment => {
    keys(payment, paymentKeys); assert.ok(Number.isSafeInteger(payment.id) && payment.id > 0);
    assert.equal(payment.moneda, 'ARS'); assert.equal(payment.provenance, 'manual');
    assert.match(payment.importe, /^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/); assert.ok(cents(payment.importe) > 0n);
    assert.match(payment.revision, new RegExp(`^pay1:${payment.id}:[1-9][0-9]*$`));
    assert.ok(Number.isFinite(Date.parse(payment.created_at)));
    assert.match(payment.fecha_pago, /^\d{4}-\d{2}-\d{2}$/); assert.match(payment.periodo_trabajo, /^\d{4}-\d{2}$/);
    if (payment.status === 'recorded') {
      assert.equal(payment.voided_at, null); assert.equal(payment.voided_by_id, null); assert.equal(payment.void_reason, null);
    } else {
      assert.equal(payment.status, 'voided'); assert.ok(Number.isFinite(Date.parse(payment.voided_at)));
      assert.ok(Number.isSafeInteger(payment.voided_by_id)); assert.equal(typeof payment.void_reason, 'string');
    }
  };
  const checkResponse = (body, replayed) => {
    keys(body, ['version', 'payment', 'replayed']); assert.equal(body.version, 1); assert.equal(body.replayed, replayed);
    checkPayment(body.payment); return body.payment;
  };
  const record = async (input, token = admin, actor = 91001) => {
    const row = checkResponse(ok(await http(base, token, 'POST', input), 201), false);
    assert.equal(row.recipient_id, input.recipient_id); assert.equal(row.recipient_name, users.get(input.recipient_id));
    assert.equal(row.recorded_by_id, actor); assert.equal(row.recorded_by_name, users.get(actor));
    assert.equal(row.fecha_pago, input.fecha_pago); assert.equal(row.periodo_trabajo, input.periodo_trabajo);
    assert.equal(cents(row.importe), cents(input.importe.includes('.') ? input.importe.padEnd(input.importe.indexOf('.') + 3, '0') : `${input.importe}.00`));
    assert.equal(row.referencia, input.referencia.trim()); assert.equal(row.drive_url, input.drive_url);
    expected.set(row.id, row); return row;
  };
  const checkList = (body, period = clock.period) => {
    keys(body, ['version', 'periodo', 'items', 'total_recorded_ars']); assert.equal(body.version, 1); assert.equal(body.periodo, period);
    const rows = [...expected.values()].filter(row => row.fecha_pago.slice(0, 7) === period)
      .sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago) || b.id - a.id);
    assert.deepEqual(body.items, rows);
    assert.equal(body.total_recorded_ars, money(rows.filter(row => row.status === 'recorded').reduce((sum, row) => sum + cents(row.importe), 0n)));
  };
  const initial = await snapshot();
  for (const table of ['team_payments', 'team_payment_events', 'team_payment_receipts']) assert.deepEqual(initial[table], [], 'No legacy backfill');

  await t.test('context exposes only active real account identity to admins and all initial GETs are no-store/read-only', async () => {
    const before = await snapshot();
    for (const token of [admin, otherAdmin]) {
      const context = await http(`${base}/contexto`, token), body = ok(context);
      assert.equal(context.cacheControl, 'no-store'); keys(body, ['version', 'recipients']); assert.equal(body.version, 1);
      const active = await f.query('SELECT id,nombre,usuario,rol FROM usuarios WHERE activo=true ORDER BY id');
      for (const person of body.recipients) keys(person, ['id', 'nombre', 'usuario', 'rol']);
      assert.deepEqual([...body.recipients].sort((a, b) => a.id - b.id), active);
      assert.ok(body.recipients.some(person => person.id === 91001), 'An owner is a valid real recipient');
      const list = await http(`${base}?periodo=${clock.period}`, token);
      assert.equal(list.cacheControl, 'no-store'); checkList(ok(list));
    }
    assert.deepEqual(await snapshot(), before);
  });

  let firstInput, first;
  await t.test('real payments preserve exact cents, actual recipient/actor names and independent payment/work dates; partial records never infer full salary', async () => {
    firstInput = make({ importe: '0.01', referencia: '  QA111 first cent partial  ' }); first = await record(firstInput);
    assert.equal(first.importe, '0.01'); assert.equal(first.status, 'recorded');
    await record(make({ importe: '123.40', recipient_id: 91001, drive_url: null }), otherAdmin, 91002);
    await record(make({ importe: '10', referencia: 'QA111 second independent partial' }));
    for (const token of [admin, otherAdmin]) checkList(ok(await http(`${base}?periodo=${clock.period}`, token)));
    const after = await snapshot();
    for (const table of tables.filter(table => !['team_payments', 'team_payment_events', 'team_payment_receipts'].includes(table)))
      assert.deepEqual(after[table], initial[table], `Manual records must not mutate legacy payroll, tasks or payment tables: ${table}`);
  });

  await t.test('manual payments before September2026 remain reachable by actual payment month, independently of projection lower bound', async () => {
    const input = make({ fecha_pago: '2026-08-15', periodo_trabajo: '2026-07', importe: '1.23', referencia: 'QA111 explicit historical payment' });
    const payment = await record(input);
    assert.equal(payment.fecha_pago, '2026-08-15'); assert.equal(payment.periodo_trabajo, '2026-07');
    const before = await snapshot();
    for (const token of [admin, otherAdmin]) {
      const result = await http(`${base}?periodo=2026-08`, token); assert.equal(result.cacheControl, 'no-store');
      const body = ok(result); checkList(body, '2026-08'); assert.equal(body.total_recorded_ars, '1.23');
      checkList(ok(await http(`${base}?periodo=2026-07`, token)), '2026-07');
      checkList(ok(await http(`${base}?periodo=${clock.period}`, token)));
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('ignored genuine ACK and concurrent identical retries never duplicate records/events; operation collisions stay read-only', async () => {
    const before = await snapshot();
    const replay = checkResponse(ok(await http(base, admin, 'POST', firstInput)), true);
    assert.deepEqual(replay, first); assert.deepEqual(await snapshot(), before);
    const input = make({ referencia: 'QA111 deliberately unobserved ACK' });
    const committed = ok(await http(base, admin, 'POST', input), 201);
    // The first HTTP really committed; only caller observation is withheld.
    // This is not a TCP-disconnect, bank transfer, or browser proof.
    const afterCommit = await snapshot();
    const recovered = checkResponse(ok(await http(base, admin, 'POST', input)), true);
    assert.deepEqual(recovered, committed.payment); expected.set(recovered.id, recovered);
    assert.deepEqual(await snapshot(), afterCommit);
    const concurrent = make({ referencia: 'QA111 concurrent duplicate intent' });
    const results = await Promise.all([http(base, admin, 'POST', concurrent), http(base, admin, 'POST', concurrent)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    const created = checkResponse(results.find(result => result.status === 201).body, false);
    assert.deepEqual(checkResponse(results.find(result => result.status === 200).body, true), created); expected.set(created.id, created);
    const stable = await snapshot();
    ok(await http(base, admin, 'POST', { ...firstInput, importe: '0.02' }), 409);
    ok(await http(`${base}/${first.id}/anular`, admin, 'POST', { operation_key: firstInput.operation_key,
      expected_revision: first.revision, reason: 'QA111 cross-operation key collision', attestation: true }), 409);
    assert.deepEqual(await snapshot(), stable);
  });

  await t.test('same UUID belongs to actor, not a global namespace; more than50 real records remain fully listed', async () => {
    await record({ ...make({ importe: '0.01' }), operation_key: firstInput.operation_key }, otherAdmin, 91002);
    for (let n = 0; n < 51; n++) await record(make({ importe: '0.01', referencia: `QA111 volume ${n}` }));
    const before = await snapshot();
    for (const token of [admin, otherAdmin]) {
      const response = await http(`${base}?periodo=${clock.period}`, token); assert.equal(response.cacheControl, 'no-store');
      const body = ok(response); checkList(body); assert.ok(body.items.length > 50);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('void CAS preserves original record and audit; create replay returns CURRENT voided record without resurrecting it', async () => {
    const voidInput = { operation_key: randomUUID(), expected_revision: first.revision, reason: '  QA111 mistaken manual entry  ', attestation: true };
    const before = await snapshot();
    const row = checkResponse(ok(await http(`${base}/${first.id}/anular`, otherAdmin, 'POST', voidInput)), false);
    assert.equal(row.status, 'voided'); assert.equal(row.voided_by_id, 91002); assert.equal(row.void_reason, voidInput.reason.trim());
    assert.notEqual(row.revision, first.revision);
    for (const field of paymentKeys.filter(key => !['status', 'revision', 'voided_at', 'voided_by_id', 'void_reason'].includes(key)))
      assert.deepEqual(row[field], first[field], field);
    expected.set(row.id, row);
    const after = await snapshot();
    assert.equal(after.team_payment_events.length, before.team_payment_events.length + 1);
    const events = after.team_payment_events.filter(event => event.payment_id === first.id);
    assert.deepEqual(events.map(event => event.kind).sort(), ['recorded', 'voided']);
    for (const table of tables.filter(table => !['team_payments', 'team_payment_events', 'team_payment_receipts'].includes(table)))
      assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(checkResponse(ok(await http(`${base}/${first.id}/anular`, otherAdmin, 'POST', voidInput)), true), row);
    assert.deepEqual(checkResponse(ok(await http(base, admin, 'POST', firstInput)), true), row);
    ok(await http(`${base}/${first.id}/anular`, otherAdmin, 'POST', { ...voidInput, operation_key: randomUUID(), expected_revision: row.revision }), 409);
    const { expected_revision, ...missing } = voidInput;
    ok(await http(`${base}/${first.id}/anular`, admin, 'POST', { ...missing, operation_key: randomUUID() }), 428);
    ok(await http(`${base}/${first.id}/anular`, admin, 'POST', { ...voidInput, operation_key: randomUUID(), expected_revision: 'bad' }), 400);
    ok(await http(`${base}/${first.id}/anular`, admin, 'POST', { ...voidInput, operation_key: randomUUID() }), 409);
    assert.deepEqual(await snapshot(), after);
    checkList(ok(await http(`${base}?periodo=${clock.period}`, admin)));
  });

  await t.test('two owners concurrently voiding one observed record have one winner, one409 and exactly one new audit event', async () => {
    const payment = await record(make({ importe: '999999999999.99', referencia: 'QA111 maximum exact cents and competing voids' }));
    assert.equal(payment.importe, '999999999999.99');
    const input = { operation_key: randomUUID(), expected_revision: payment.revision, reason: 'QA111 explicit competing void', attestation: true };
    const before = await snapshot();
    const results = await Promise.all([http(`${base}/${payment.id}/anular`, admin, 'POST', input),
      http(`${base}/${payment.id}/anular`, otherAdmin, 'POST', { ...input, operation_key: randomUUID() })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200), row = checkResponse(results[winner].body, false);
    assert.equal(row.id, payment.id); assert.equal(row.status, 'voided'); assert.equal(row.importe, payment.importe);
    assert.equal(row.voided_by_id, winner === 0 ? 91001 : 91002); expected.set(row.id, row);
    const after = await snapshot();
    assert.equal(after.team_payment_events.length, before.team_payment_events.length + 1);
    assert.equal(after.team_payment_receipts.length, before.team_payment_receipts.length + 1);
    assert.equal(after.team_payments.length, before.team_payments.length);
    const stable = await snapshot();
    for (const change of [{ attestation: false }, { reason: ' ' }, { extra: true }])
      ok(await http(`${base}/${payment.id}/anular`, admin, 'POST', { ...input, operation_key: randomUUID(), ...change }), 400);
    ok(await http(`${base}/${payment.id}/anular`, admin, 'POST', { ...input, operation_key: randomUUID(),
      expected_revision: `pay1:${payment.id + 1}:1` }), 409);
    assert.deepEqual(await snapshot(), stable);
  });

  await t.test('actual081 SQL guard rejects original-field rewrites and deletion, preserving both recorded and voided payment history', async () => {
    const before = await snapshot(), db = await connect();
    const recorded = [...expected.values()].find(row => row.status === 'recorded'); assert.ok(recorded);
    try {
      for (const payment of [recorded, expected.get(first.id)]) {
        for (const sql of [
          "UPDATE team_payments SET importe=importe+1 WHERE id=$1",
          "UPDATE team_payments SET referencia='QA111 forbidden history rewrite' WHERE id=$1",
          "UPDATE team_payments SET fecha_pago=fecha_pago-1 WHERE id=$1",
          'UPDATE team_payments SET recipient_id=91004 WHERE id=$1',
          'DELETE FROM team_payments WHERE id=$1',
        ]) await assert.rejects(db.query(sql, [payment.id]), error => error.code === '23514');
      }
    } finally { await close(db); }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('strict query/payload and non-admin requests disclose no money and never modify any business table', async () => {
    const before = await snapshot();
    for (const [token, status] of [[employee, 403], [null, 401]]) for (const [path, method, body] of [
      [`${base}/contexto`, 'GET'], [`${base}?periodo=${clock.period}`, 'GET'], [base, 'POST', make()],
      [`${base}/${first.id}/anular`, 'POST', { operation_key: randomUUID(), expected_revision: first.revision, reason: 'QA111 forbidden', attestation: true }],
    ]) {
      const rejected = ok(await http(path, token, method, body), status);
      for (const key of ['payment', 'items', 'recipients', 'total_recorded_ars']) assert.equal(Object.hasOwn(rejected, key), false);
      assert.equal(JSON.stringify(rejected).includes('QA111 first cent'), false);
    }
    for (const query of ['', 'periodo=0000-10', 'periodo=2026-13', 'periodo=2026-1',
      `periodo=${clock.period}&periodo=${clock.period}`, `periodo[]=${clock.period}`, `periodo=${clock.period}&limit=1`])
      ok(await http(`${base}?${query}`, admin), 400);
    ok(await http(`${base}/contexto?periodo=${clock.period}`, admin), 400);
    const invalid = [
      { importe: '0' }, { importe: 1 }, { importe: '01.00' }, { importe: '1.001' }, { importe: '1000000000000' },
      { importe: '1e2' }, { importe: '1\n' }, { fecha_pago: clock.tomorrow }, { fecha_pago: '2026-02-30' },
      { periodo_trabajo: '0000-10' }, { recipient_id: '91003' }, { recipient_id: 2147483648 },
      { referencia: '  ' }, { attestation: false }, { drive_url: 'http://drive.google.com/file/d/x' },
      { drive_url: 'https://drive.google.com.evil.invalid/file/d/x' }, { drive_url: 'https://x@drive.google.com/file/d/x' },
      { drive_url: 'https://drive.google.com:444/file/d/x' }, { moneda: 'USD' }, { extra: true }, { recipient_name: 'Forged name' },
      { operation_key: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
    ];
    for (const change of invalid) ok(await http(base, admin, 'POST', make(change)), 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('late audit insert failure rolls back payment and receipt; same genuine intent can then commit once', async () => {
    const input = make({ referencia: 'QA111 forced late failure' });
    await f.query(`CREATE FUNCTION qa111_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'QA111 synthetic audit failure'; END $$`);
    await f.query('CREATE TRIGGER qa111_event_fault BEFORE INSERT ON team_payment_events FOR EACH ROW EXECUTE FUNCTION qa111_fail_event()');
    try { const before = await snapshot(); ok(await http(base, admin, 'POST', input), 500); assert.deepEqual(await snapshot(), before); }
    finally { await f.query('DROP TRIGGER qa111_event_fault ON team_payment_events'); await f.query('DROP FUNCTION qa111_fail_event()'); }
    await record(input);
  });

  await t.test('receipt insert failure after payment and event rolls back the entire transaction; healthy SAME-key retry commits exactly once', async () => {
    const input = make({ referencia: 'QA111 forced receipt insert failure' });
    await f.query(`CREATE FUNCTION qa111_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'QA111 synthetic receipt failure'; END $$`);
    await f.query('CREATE TRIGGER qa111_receipt_fault BEFORE INSERT ON team_payment_receipts FOR EACH ROW EXECUTE FUNCTION qa111_fail_receipt()');
    try {
      const before = await snapshot();
      ok(await http(base, admin, 'POST', input), 500);
      assert.deepEqual(await snapshot(), before, 'Failed receipt must roll back the already-inserted payment/event and leave all business state intact');
    } finally {
      await f.query('DROP TRIGGER qa111_receipt_fault ON team_payment_receipts');
      await f.query('DROP FUNCTION qa111_fail_receipt()');
    }
    const beforeHealthy = await snapshot(), row = await record(input), committed = await snapshot();
    assert.equal(committed.team_payments.length, beforeHealthy.team_payments.length + 1);
    assert.equal(committed.team_payment_events.length, beforeHealthy.team_payment_events.length + 1);
    assert.equal(committed.team_payment_receipts.length, beforeHealthy.team_payment_receipts.length + 1);
    assert.deepEqual(checkResponse(ok(await http(base, admin, 'POST', input)), true), row);
    assert.deepEqual(await snapshot(), committed, 'Exact retry after recovery must not add another payment, event or receipt');
  });

  for (const [index, loss] of [
    { name: 'revoked epoch', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'current role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
  ].entries()) await t.test(`${loss.name} after HTTP authentication while account mutex waits denies create, replay and void without DML`, async () => {
    const id = 991111 + index, usuario = `qa111_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA111 isolated owner','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    users.set(id, 'QA111 isolated owner'); const token = await login(usuario);
    const committedInput = make(), committed = await record(committedInput, token, id);
    const holder = await connect(), changer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = http(base, token, 'POST', make()); void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await changer.query(`SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid]);
        if (rows.length) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Actual HTTP writer must wait on the account-admin mutex before actor SHARE');
      await changer.query(loss.sql, [id]); const before = await snapshot();
      await holder.query('COMMIT'); ok(await pending, loss.status);
      ok(await http(base, token, 'POST', committedInput), loss.status);
      ok(await http(`${base}/${committed.id}/anular`, token, 'POST', { operation_key: randomUUID(),
        expected_revision: committed.revision, reason: 'QA111 lost authority', attestation: true }), loss.status);
      ok(await http(`${base}?periodo=${clock.period}`, token), loss.status);
      ok(await http(`${base}/contexto`, token), loss.status);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(changer); await close(holder);
    }
  });

  await t.test('final shared reads and legacy finance estimate stay read-only and never reconcile manual records into salary/payment state', async () => {
    const before = await snapshot();
    for (const token of [admin, otherAdmin]) {
      checkList(ok(await http(`${base}?periodo=${clock.period}`, token)));
      ok(await api(`/sueldos?periodo=${clock.period}`, token));
    }
    assert.deepEqual(await snapshot(), before);
    // Isolated authority actors log in after the initial baseline, legitimately
    // adding login throttle rows. They are not legacy payment/business writes.
    // The immediately preceding GET snapshot comparison still includes ALL tables.
    for (const table of tables.filter(table => !['team_payments', 'team_payment_events', 'team_payment_receipts', 'usuarios', 'auth_login_buckets'].includes(table)))
      assert.deepEqual(before[table], initial[table], `Ledger must not overwrite legacy business/payment state: ${table}`);
  });
});
