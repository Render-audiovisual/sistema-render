import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const reserved = ['origen', 'confirmado_por', 'confirmado_por_id', 'confirmado_at', 'provenance_version', 'wilson_idempotency_key'];

test('feedback durable receipts: signed human confirmation, scoped retry and atomic persistence', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const actors = { a: 'qa-feedback-a', b: 'qa-feedback-b', groupOnly: 'qa-feedback-group-only' };
  const groupId = 'qa-feedback-authorized-group';
  const fixture = await startLocalHarness({ port: 55604, deferFeedbackReceiptsMigration: true, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), allowedWhatsappIds: [actors.a, actors.b].join(','),
    allowedWhatsappGroups: groupId,
    telegramUserBindings: JSON.stringify({ 'qa-feedback-tg-a': 102001 }), allowedTelegramIds: 'qa-feedback-tg-a',
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own feedback-receipts fixture stopped and removed: ${fixture.root}`);
  });
  const ok = (response, statuses = [200]) => {
    assert.ok(statuses.includes(response.status), `${response.status}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const signed = async (route, body, { actor = 'a', channel = 'whatsapp', method = 'POST', headerKey,
    groupId: requestGroupId = '', name = 'UNTRUSTED display name' } = {}) => {
    const actorId = channel === 'telegram' ? 'qa-feedback-tg-a' : actors[actor];
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const message = ['v2', timestamp, nonce, channel, actorId, requestGroupId, name, method,
      `${url.pathname}${url.search}`, hash(body === undefined ? '' : canonical(body))].join('\n');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(5000), headers: {
      'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-channel': channel, 'x-wilson-actor-id': actorId, 'x-wilson-actor-name': name,
      ...(requestGroupId ? { 'x-wilson-group-id': requestGroupId } : {}),
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headerKey === undefined ? {} : { 'idempotency-key': headerKey }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const login = async usuario => ok(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  for (const [actor, id] of [['a', 102001], ['b', 102002], ['groupOnly', 102003]])
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_id_hash,whatsapp_habilitado)
      SELECT $1,$2,$3,'diseno',password_hash,true,1,$4,true FROM usuarios WHERE id=91004`,
    [id, `qa_feedback_${actor}`, `QA Feedback ${actor}`, hash(actors[actor])]);
  const browserToken = await login('qa_franco');
  const browser = (route, body, method = 'PATCH') => request(fixture.base, `/api${route}`, { token: browserToken, method, body });
  const employeeToken = await login('qa_designer');
  const employeeBrowser = (route, body, method = 'PATCH') => request(fixture.base, `/api${route}`, { token: employeeToken, method, body });
  const [legacy] = await fixture.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback,updated_at)
    VALUES ('QA legacy receipt poison','Preserve historical note','general','QA history','QA history',
      '{"origen":"mia_whatsapp","confirmado_por":"Unverified legacy","wilson_idempotency_key":"qa-legacy-key","responsables":["Luciano QA"],"flujo":"feedback"}',
      '2026-10-01T12:00:00.123456Z') RETURNING *`);
  await fixture.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,detalles)
    VALUES ('wilson','whatsapp',$1,'QA legacy','qa_legacy','{"preserve":true}')`, [actors.a]);
  await fixture.query(`INSERT INTO integracion_confirmaciones(token,integracion,canal,actor_id,grupo_id,operacion,payload_hash,expires_at)
    VALUES ('00000000-0000-4000-8000-000000055604','wilson','whatsapp',$1,'','crear_feedback',$2,'2099-01-01')`, [actors.a, 'a'.repeat(64)]);
  await fixture.query(`INSERT INTO mia_private_task_notifications
    (fingerprint,destinatario,destinatario_clave,tarea_id,feedback_id,motivo,mensaje,tarea_url,detalles)
    VALUES ('qa-feedback-history','Luciano QA','qa_luciano',NULL,$1,'feedback','QA historical notification','https://example.invalid/qa','{}')`, [legacy.id]);
  const baseTables = ['notas_compartidas', 'integracion_auditoria', 'integracion_confirmaciones', 'mia_private_task_notifications'];
  const snapshot = async (receipts = true) => {
    const state = {};
    for (const table of [...baseTables, ...(receipts ? ['feedback_operation_receipts'] : [])])
      state[table] = await fixture.query(`SELECT to_jsonb(${table}) AS row FROM ${table} ORDER BY to_jsonb(${table})::text`);
    return state;
  };
  await t.test('061 preserves populated notes, audit, notification and confirmation history without promoting legacy keys', async () => {
    assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE nombre='061_feedback_operation_receipts.sql'"), []);
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.feedback_operation_receipts') AS relation"), [{ relation: null }]);
    const before = await snapshot(false);
    await fixture.query(await readFile(new URL('../migrations/061_feedback_operation_receipts.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(false), before);
    assert.deepEqual(await fixture.query('SELECT * FROM feedback_operation_receipts'), []);
    const columns = await fixture.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='feedback_operation_receipts' ORDER BY column_name`);
    assert.deepEqual(columns.map(row => row.column_name), ['id', 'actor_user_id', 'operation', 'idempotency_key',
      'payload_hash', 'note_id', 'note_updated_at', 'committed_at'].sort());
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('061_feedback_operation_receipts.sql')");
  });
  let serial = 0;
  const business = () => ({ seccion: 'equipo', titulo: `QA receipt distinct subject ${++serial}`,
    contenido: `Synthetic independent detail ${serial}`, responsables: ['Luciano QA'],
    vigencia: 'puntual', estado: 'pendiente', permitir_duplicado: true });
  const createPayload = (key = crypto.randomUUID()) => ({ ...business(), idempotency_key: key });
  const confirmation = async (payload, id, options = {}) => {
    const result = await signed('/confirmaciones', { operacion: id ? 'editar_feedback' : 'crear_feedback',
      ...(id ? { tarea_id: id } : {}), payload }, options);
    return ok(result, [201]).confirmacion_token;
  };
  const mutate = (payload, token, id, options = {}) => signed(id ? `/feedback/${id}` : '/feedback', {
    ...payload, ...(token === undefined ? {} : { confirmacion_token: token }),
  }, { ...options, method: id ? 'PATCH' : 'POST' });
  const create = async (payload = createPayload(), options = {}) => {
    const token = await confirmation(payload, null, options);
    return { payload, token, result: ok(await mutate(payload, token, null, options), [201]) };
  };
  const note = async id => (await fixture.query('SELECT * FROM notas_compartidas WHERE id=$1', [id]))[0];
  const editPayload = async (id, key = crypto.randomUUID(), extra = {}) => {
    const current = ok(await signed(`/feedback/${id}`, undefined, { method: 'GET' })).feedback;
    return { contenido: `QA changed detail ${++serial}`, expected_updated_at: current.updated_at,
      idempotency_key: key, permitir_duplicado: true, ...extra };
  };
  const replayShape = (body, operation, id) => {
    assert.equal(body.idempotent, true);
    assert.equal(body[operation === 'crear_feedback' ? 'created' : 'updated'], false);
    assert.equal(Number(body.feedback_id), Number(id));
    assert.deepEqual(Object.keys(body.receipt).sort(), ['operation', 'note_id', 'note_updated_at', 'committed_at'].sort());
    assert.equal(body.receipt.operation, operation);
    assert.equal(Number(body.receipt.note_id), Number(id));
    assert.ok(Number.isFinite(Date.parse(body.receipt.note_updated_at)));
    assert.ok(Number.isFinite(Date.parse(body.receipt.committed_at)));
    for (const secret of ['confirmacion_token', 'idempotency_key', 'payload_hash'])
      assert.ok(!Object.hasOwn(body.receipt, secret));
  };

  await t.test('browser rejects every reserved root/nested field and preserves legacy provenance during business edits', async () => {
    const plain = { titulo: 'QA browser note', contenido: 'Business only', categoria: 'general', feedback: {} };
    const saved = ok(await browser('/notas', plain, 'POST'), [201]);
    for (const key of reserved) for (const nested of [false, true]) {
      const forged = nested ? { ...plain, feedback: { [key]: 'forged' } } : { ...plain, [key]: 'forged' };
      const before = await snapshot();
      assert.equal((await browser('/notas', forged, 'POST')).status, 400);
      assert.equal((await browser(`/notas/${saved.id}`, forged)).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    const provenance = Object.fromEntries(reserved.filter(key => Object.hasOwn(legacy.feedback, key)).map(key => [key, legacy.feedback[key]]));
    ok(await browser(`/notas/${legacy.id}`, { feedback: { referencia: 'QA business edit' } }));
    const edited = await note(legacy.id);
    for (const [key, value] of Object.entries(provenance)) assert.equal(edited.feedback[key], value);
    assert.equal(edited.feedback.referencia, 'QA business edit');
    assert.ok(!Object.hasOwn(edited.feedback, 'provenance_version'));
    const employeeNote = ok(await employeeBrowser('/notas', {
      titulo: 'QA employee shared note', contenido: 'Employee business note', categoria: 'general',
      feedback: { referencia: 'QA employee reference' },
    }, 'POST'), [201]);
    assert.ok(employeeNote.id);
    const otherAuthor = await note(saved.id);
    const employeeEdited = ok(await employeeBrowser(`/notas/${saved.id}`, {
      feedback: { referencia: 'QA employee edits another author', estado: 'resuelto' },
    }));
    assert.equal(employeeEdited.creado_por, otherAuthor.creado_por);
    const sharedEdited = await note(saved.id);
    assert.equal(sharedEdited.feedback.referencia, 'QA employee edits another author');
    assert.equal(sharedEdited.feedback.estado, 'resuelto');
    for (const key of reserved) for (const nested of [false, true]) {
      const forged = nested ? { ...plain, feedback: { [key]: 'forged' } } : { ...plain, [key]: 'forged' };
      const before = await snapshot();
      assert.equal((await employeeBrowser('/notas', forged, 'POST')).status, 400);
      assert.equal((await employeeBrowser(`/notas/${saved.id}`, forged)).status, 400);
      assert.deepEqual(await snapshot(), before, 'Employee provenance forgery must not change notes, receipts, tokens, audit or notifications');
    }
    assert.deepEqual(await fixture.query('SELECT * FROM feedback_operation_receipts'), []);
  });
  await t.test('both channels require real exact confirmation; provenance comes from verified user not signed display name', async () => {
    for (const channel of ['whatsapp', 'telegram']) {
      const payload = createPayload();
      const before = await snapshot();
      assert.ok([400, 403].includes((await mutate(payload, undefined, null, { channel })).status));
      assert.deepEqual(await snapshot(), before);
      const token = await confirmation(payload, null, { channel });
      const afterToken = await snapshot();
      assert.ok([400, 403, 409].includes((await mutate({ ...payload, contenido: 'Different confirmed intent' }, token, null, { channel })).status));
      assert.deepEqual(await snapshot(), afterToken);
      const result = ok(await mutate(payload, token, null, { channel }), [201]);
      assert.equal(result.feedback.feedback.confirmado_por_id, 102001);
      assert.equal(result.feedback.feedback.confirmado_por, 'QA Feedback a');
      assert.equal(result.feedback.feedback.provenance_version, 1);
      assert.equal(result.feedback.feedback.origen, channel === 'whatsapp' ? 'mia_whatsapp' : 'wilson_telegram');
      assert.ok(Number.isFinite(Date.parse(result.feedback.feedback.confirmado_at)));
      assert.ok(!Object.hasOwn(result.feedback.feedback, 'wilson_idempotency_key'));
    }
    const privateOptions = { actor: 'groupOnly' };
    const groupOptions = { ...privateOptions, groupId };
    const payload = createPayload();
    const token = await confirmation(payload, null, privateOptions);
    const beforeGroupCreate = await snapshot();
    assert.equal((await signed('/confirmaciones', { operacion: 'crear_feedback', payload }, groupOptions)).status, 403);
    assert.equal((await mutate(payload, token, null, groupOptions)).status, 403);
    assert.deepEqual(await snapshot(), beforeGroupCreate, 'Group-only actor cannot consume a valid private confirmation');
    const saved = ok(await mutate(payload, token, null, privateOptions), [201]);
    const beforeGroupReplay = await snapshot();
    assert.equal((await mutate(payload, undefined, null, groupOptions)).status, 403);
    assert.deepEqual(await snapshot(), beforeGroupReplay, 'Group policy must precede an already committed private receipt');
    const edit = await editPayload(saved.feedback.id);
    const editToken = await confirmation(edit, saved.feedback.id, privateOptions);
    const beforeGroupEdit = await snapshot();
    assert.equal((await signed('/confirmaciones', { operacion: 'editar_feedback', tarea_id: saved.feedback.id, payload: edit }, groupOptions)).status, 403);
    assert.equal((await mutate(edit, editToken, saved.feedback.id, groupOptions)).status, 403);
    assert.deepEqual(await snapshot(), beforeGroupEdit);
    ok(await mutate(edit, editToken, saved.feedback.id, privateOptions));
    const afterPrivateEdit = await snapshot();
    assert.equal((await mutate(edit, undefined, saved.feedback.id, groupOptions)).status, 403);
    assert.deepEqual(await snapshot(), afterPrivateEdit);
  });
  await t.test('create retry reads current DTO; actor, operation and hash scope do not trust historical JSON', async () => {
    const saved = await create(createPayload('qa-legacy-key'));
    assert.notEqual(Number(saved.result.feedback.id), Number(legacy.id));
    const id = saved.result.feedback.id;
    ok(await browser(`/notas/${id}`, { titulo: 'QA browser current title' }));
    const beforeReplay = await snapshot();
    const replay = ok(await mutate(saved.payload));
    replayShape(replay, 'crear_feedback', id);
    assert.equal(replay.result_current, true);
    assert.equal(replay.feedback.titulo, 'QA browser current title');
    assert.deepEqual(await snapshot(), beforeReplay);
    assert.equal((await mutate({ ...saved.payload, contenido: 'Conflicting same key' })).status, 409);
    const other = await create(saved.payload, { actor: 'b' });
    assert.notEqual(Number(other.result.feedback.id), Number(id));
    const edit = await editPayload(id, saved.payload.idempotency_key);
    ok(await mutate(edit, await confirmation(edit, id), id));
    const receipts = await fixture.query('SELECT actor_user_id,operation FROM feedback_operation_receipts WHERE idempotency_key=$1 ORDER BY actor_user_id,operation', [saved.payload.idempotency_key]);
    assert.equal(receipts.length, 3);
  });
  await t.test('confirmation binds actor, key and expiry and cannot be substituted across feedback requests', async () => {
    const payload = createPayload(); const token = await confirmation(payload);
    for (const [body, options] of [[payload, { actor: 'b' }], [{ ...payload, idempotency_key: crypto.randomUUID() }, {}]]) {
      const before = await snapshot();
      assert.ok([400, 403, 409].includes((await mutate(body, token, null, options)).status));
      assert.deepEqual(await snapshot(), before);
    }
    await fixture.query("UPDATE integracion_confirmaciones SET expires_at='2000-01-01' WHERE token=$1", [token]);
    const beforeExpired = await snapshot();
    assert.ok([400, 403, 409].includes((await mutate(payload, token)).status));
    assert.deepEqual(await snapshot(), beforeExpired);
    ok(await mutate(payload, await confirmation(payload)), [201]);
  });
  await t.test('confirmation expiring during note or unchanged-token lock waits is rejected at wall clock, not transaction start', async () => {
    for (const lockTarget of ['note', 'token']) {
    const saved = await create();
    const id = Number(saved.result.feedback.id);
    assert.ok(Number.isSafeInteger(id) && id > 0);
    const payload = await editPayload(id);
    const token = await confirmation(payload, id);
    assert.match(token, /^[0-9a-f-]{36}$/i);
    const marker = `qa_feedback_expiry_${crypto.randomUUID().replaceAll('-', '')}`;
    const poll = async predicate => {
      const deadline = Date.now() + 650;
      while (Date.now() < deadline) {
        const result = await predicate();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.fail('Expected bounded PostgreSQL lock-wait barrier was not observed');
    };
    // One physical PostgreSQL query owns the complete transaction/session.
    // Its no-op UPDATE takes the lock and trigger revision bump, then rollback
    // restores the observed CAS base. Never issue BEGIN via separate pool calls.
    // Set expiry before locking the token row: changing it after acquisition
    // would itself wait and fail to exercise an unchanged tuple's lock wait.
    await fixture.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()+interval '0.8 seconds' WHERE token=$1", [token]);
    const heldRow = lockTarget === 'note'
      ? `UPDATE notas_compartidas SET contenido=contenido WHERE id=${id}`
      : `SELECT token FROM integracion_confirmaciones WHERE token='${token}'::uuid FOR UPDATE`;
    const blocker = fixture.query(`/* ${marker} */ BEGIN;
      ${heldRow};
      SELECT pg_sleep(1.5); ROLLBACK;`).then(value => ({ value }), error => ({ error }));
    let operation;
    try {
      await poll(async () => (await fixture.query(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND position($1 in query)>0 AND wait_event='PgSleep'`, [marker])).length > 0);
      const before = await snapshot();
      operation = mutate(payload, token, id);
      // Prove the HTTP transaction is actually waiting before token expiry;
      // merely delaying the client request would not reproduce NOW()'s bug.
      const waiting = await poll(async () => (await fixture.query(`SELECT
          a.xact_start<c.expires_at AS began_before_expiry,
          clock_timestamp()<c.expires_at AS observed_before_expiry
        FROM pg_stat_activity a CROSS JOIN integracion_confirmaciones c
        WHERE c.token=$1 AND a.datname=current_database() AND a.pid<>pg_backend_pid()
          AND a.wait_event_type='Lock' AND a.query ILIKE $2
        LIMIT 1`, [token, lockTarget === 'note' ? '%notas_compartidas%' : '%integracion_confirmaciones%']))[0]);
      assert.equal(waiting.began_before_expiry, true);
      assert.equal(waiting.observed_before_expiry, true);
      assert.equal((await operation).status, 409);
      const stopped = await blocker;
      if (stopped.error) throw stopped.error;
      assert.deepEqual(await snapshot(), before);
      const [confirmationRow] = await fixture.query(`SELECT used_at,expires_at<=clock_timestamp() AS expired
        FROM integracion_confirmaciones WHERE token=$1`, [token]);
      assert.equal(confirmationRow.used_at, null);
      assert.equal(confirmationRow.expired, true);
    } finally {
      const stopped = await blocker;
      if (operation) await operation;
      if (stopped.error) throw stopped.error;
    }
    }
  });
  await t.test('identical concurrent create has one note/audit/notification/receipt; conflicting same key has one winner', async () => {
    for (const conflict of [false, true]) {
      const a = createPayload(); const b = conflict ? { ...a, contenido: 'QA competing intent' } : a;
      const tokens = await Promise.all([confirmation(a), confirmation(b)]);
      const results = await Promise.all([mutate(a, tokens[0]), mutate(b, tokens[1])]);
      assert.deepEqual(results.map(r => r.status).sort(), conflict ? [201, 409] : [200, 201]);
      const winner = results.find(r => r.status === 201).body;
      const id = winner.feedback.id;
      assert.equal((await fixture.query('SELECT * FROM feedback_operation_receipts WHERE idempotency_key=$1', [a.idempotency_key])).length, 1);
      assert.equal((await fixture.query("SELECT * FROM integracion_auditoria WHERE accion='crear_feedback' AND detalles->>'feedback_id'=$1", [String(id)])).length, 1);
      assert.equal((await fixture.query('SELECT * FROM mia_private_task_notifications WHERE feedback_id=$1', [id])).length, 1);
      assert.equal((await fixture.query('SELECT token FROM integracion_confirmaciones WHERE token=ANY($1::uuid[]) AND used_at IS NOT NULL', [tokens])).length, 1);
    }
  });
  await t.test('edit CAS roundtrips ISO with monotonic milliseconds; exact replay survives newer edits and scopes target ID', async () => {
    const saved = await create(); const id = saved.result.feedback.id;
    const before = (await note(id)).updated_at;
    const a = await editPayload(id); const b = { ...a, idempotency_key: crypto.randomUUID(), contenido: 'QA stale competing patch' };
    const tokens = await Promise.all([confirmation(a, id), confirmation(b, id)]);
    const results = await Promise.all([mutate(a, tokens[0], id), mutate(b, tokens[1], id)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results.findIndex(r => r.status === 200);
    const winningPayload = [a, b][winner];
    assert.ok(Date.parse((await note(id)).updated_at) >= Date.parse(before) + 1);
    const fresh = await editPayload(id, crypto.randomUUID(), { referencia: '' });
    const freshResult = ok(await mutate(fresh, await confirmation(fresh, id), id));
    assert.ok(Date.parse(freshResult.feedback.updated_at) >= Date.parse(results[winner].body.feedback.updated_at) + 1);
    const replay = ok(await mutate(winningPayload, undefined, id));
    replayShape(replay, 'editar_feedback', id);
    assert.equal(replay.result_current, true);
    assert.equal(replay.feedback.contenido, freshResult.feedback.contenido);
    const other = await create();
    assert.equal((await mutate(winningPayload, undefined, other.result.feedback.id)).status, 409);
    const missingVersion = { idempotency_key: crypto.randomUUID(), contenido: 'QA missing version' };
    assert.equal((await mutate(missingVersion, undefined, id)).status, 400);
  });
  await t.test('receipt and note/audit/token/outbox commit atomically; post-write SQL failure permits same-token retry', async () => {
    const payload = createPayload(); const token = await confirmation(payload);
    await fixture.query(`CREATE FUNCTION qa_feedback_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.accion='crear_feedback' THEN RAISE EXCEPTION 'QA feedback audit failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_feedback_receipt_fail BEFORE INSERT ON integracion_auditoria FOR EACH ROW EXECUTE FUNCTION qa_feedback_receipt_fail()`);
    try {
      const before = await snapshot();
      assert.equal((await mutate(payload, token)).status, 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await fixture.query('DROP TRIGGER qa_feedback_receipt_fail ON integracion_auditoria; DROP FUNCTION qa_feedback_receipt_fail()');
    }
    const result = ok(await mutate(payload, token), [201]);
    assert.equal((await fixture.query('SELECT * FROM mia_private_task_notifications WHERE feedback_id=$1', [result.feedback.id])).length, 1);
    const before = await snapshot();
    replayShape(ok(await mutate(payload)), 'crear_feedback', result.feedback.id);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('notification enqueue failure is transactional, not a post-response callback gap', async () => {
    const payload = createPayload(); const token = await confirmation(payload);
    await fixture.query(`CREATE FUNCTION qa_feedback_queue_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA private enqueue failure' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER qa_feedback_queue_fail BEFORE INSERT ON mia_private_task_notifications
      FOR EACH ROW EXECUTE FUNCTION qa_feedback_queue_fail()`);
    try {
      const before = await snapshot();
      assert.equal((await mutate(payload, token)).status, 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await fixture.query('DROP TRIGGER qa_feedback_queue_fail ON mia_private_task_notifications; DROP FUNCTION qa_feedback_queue_fail()');
    }
    const saved = ok(await mutate(payload, token), [201]);
    assert.equal((await fixture.query('SELECT * FROM mia_private_task_notifications WHERE feedback_id=$1', [saved.feedback.id])).length, 1);
  });
  await t.test('edit failure after UPDATE rolls back note, audit, receipt and token; retry consumes once', async () => {
    const saved = await create(); const id = saved.result.feedback.id;
    const payload = await editPayload(id); const token = await confirmation(payload, id);
    await fixture.query(`CREATE FUNCTION qa_feedback_edit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.accion='editar_feedback' THEN RAISE EXCEPTION 'QA feedback edit failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_feedback_edit_fail BEFORE INSERT ON integracion_auditoria
      FOR EACH ROW EXECUTE FUNCTION qa_feedback_edit_fail()`);
    try {
      const before = await snapshot();
      assert.equal((await mutate(payload, token, id)).status, 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await fixture.query('DROP TRIGGER qa_feedback_edit_fail ON integracion_auditoria; DROP FUNCTION qa_feedback_edit_fail()');
    }
    ok(await mutate(payload, token, id));
    const before = await snapshot();
    replayShape(ok(await mutate(payload, undefined, id)), 'editar_feedback', id);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('receipt survives archive/purge without returning saved content or recreating the note', async () => {
    const saved = await create(); const id = saved.result.feedback.id;
    const edit = await editPayload(id);
    ok(await mutate(edit, await confirmation(edit, id), id));
    ok(await browser(`/notas/${id}`, undefined, 'DELETE'));
    const archived = ok(await mutate(saved.payload));
    replayShape(archived, 'crear_feedback', id);
    assert.equal(archived.feedback, null); assert.equal(archived.archived, true);
    ok(await browser(`/notas/${id}?permanente=true`, undefined, 'DELETE'));
    const before = await snapshot();
    const deleted = ok(await mutate(saved.payload));
    replayShape(deleted, 'crear_feedback', id);
    assert.equal(deleted.feedback, null); assert.equal(deleted.deleted, true);
    const deletedEdit = ok(await mutate(edit, undefined, id));
    replayShape(deletedEdit, 'editar_feedback', id);
    assert.equal(deletedEdit.feedback, null); assert.equal(deletedEdit.deleted, true);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await note(id), undefined);
  });
  await t.test('current active role and external mapping are required even for a committed retry', async () => {
    const saved = await create();
    const actorBeforeDelete = await fixture.query('SELECT to_jsonb(usuarios) AS row FROM usuarios WHERE id=102001');
    assert.equal(actorBeforeDelete[0].row.activo, true);
    assert.ok((await fixture.query('SELECT id FROM feedback_operation_receipts WHERE actor_user_id=102001')).length > 0);
    const beforeDelete = await snapshot();
    const deletedActor = await browser('/usuarios/102001', undefined, 'DELETE');
    assert.equal(deletedActor.status, 409);
    assert.match(deletedActor.body.error, /desactiv/i);
    assert.deepEqual(await fixture.query('SELECT to_jsonb(usuarios) AS row FROM usuarios WHERE id=102001'), actorBeforeDelete,
      'Receipt actor identity must remain present, active and unchanged');
    assert.deepEqual(await snapshot(), beforeDelete, 'Rejected actor deletion must preserve receipts, notes, audit, tokens and notifications');
    for (const [column, value, restore] of [['activo', false, true], ['rol', 'qa_unknown', 'diseno'], ['whatsapp_habilitado', false, true]]) {
      await fixture.query(`UPDATE usuarios SET ${column}=$1 WHERE id=102001`, [value]);
      try {
        const before = await snapshot();
        assert.equal((await mutate(saved.payload)).status, 403);
        assert.deepEqual(await snapshot(), before);
      } finally { await fixture.query(`UPDATE usuarios SET ${column}=$1 WHERE id=102001`, [restore]); }
    }
  });
  await t.test('malformed keys/types, header mismatch, contradictory aliases and legacy confirmations never mutate', async () => {
    for (const key of ['', ' ', 'x'.repeat(201), 123, {}, []]) {
      const before = await snapshot();
      assert.equal((await mutate(createPayload(key))).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    for (const extra of [{ detalle: 'Contradicts contenido' }, { titulo: {} }, { unexpected_business_field: 'not silently ignored' }]) {
      const before = await snapshot();
      assert.equal((await mutate({ ...createPayload(), ...extra })).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    const before = await snapshot();
    assert.equal((await mutate(createPayload('qa-key-body'), undefined, null, { headerKey: 'qa-key-header' })).status, 400);
    assert.deepEqual(await snapshot(), before);
    const old = await mutate(createPayload(), '00000000-0000-4000-8000-000000055604');
    assert.ok([400, 403, 409].includes(old.status));
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('maximum key is trimmed rather than truncated, aliases canonicalize and explicit empty is distinct from omission', async () => {
    const key = 'k'.repeat(200);
    const payload = createPayload(` ${key} `);
    const saved = await create(payload);
    const alias = { ...payload, idempotency_key: key, detalle: payload.contenido };
    delete alias.contenido;
    const before = await snapshot();
    replayShape(ok(await mutate(alias)), 'crear_feedback', saved.result.feedback.id);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await fixture.query('SELECT idempotency_key FROM feedback_operation_receipts WHERE note_id=$1', [saved.result.feedback.id]))[0].idempotency_key, key);
    const edit = await editPayload(saved.result.feedback.id, crypto.randomUUID(), { referencia: '' });
    ok(await mutate(edit, await confirmation(edit, saved.result.feedback.id), saved.result.feedback.id));
    const omit = { ...edit }; delete omit.referencia;
    assert.equal((await mutate(omit, undefined, saved.result.feedback.id)).status, 409);
  });
});
