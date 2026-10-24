import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const port = 55867;
const systemActorId = 'qa219-system';
const recipientId = 91003;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// Real signed HTTP and fresh PostgreSQL only. No worker, provider, phone number,
// configured database, browser session or replacement authentication middleware.
test('task notification eligibility binds current recipient identity before preview/claim LIMIT and verification', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const f = await startLocalHarness({ port, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), systemActorId,
  } });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA219 eligibility fixture cleanup ENOENT: ${f.root}`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: 'postgresql://render2_fixture@127.0.0.1:55867/render2_local_test', identity });
  // Enable only the fixture recipient's delivery preference. No phone/hash or
  // provider destination is installed; this suite cannot send a real message.
  await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=$1', [recipientId]);

  async function signed(route, { method = 'GET', body, tamper = false, changedQuery } = {}) {
    const url = new URL(`/api/integraciones/wilson${route}`, f.base);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
    // Empty actorName/group are signed exactly as sent. System Telegram actor
    // needs no human link, but still passes the real v2 signature and route gate.
    const message = ['v2', timestamp, nonce, 'telegram', systemActorId, '', '', method,
      `${url.pathname}${url.search}`, sha(body === undefined ? '' : canonical(body))].join('\n');
    const signature = crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64');
    if (changedQuery !== undefined) url.search = changedQuery;
    const response = await fetch(url, { method, signal: AbortSignal.timeout(10000), headers: {
      'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce, 'x-wilson-signature-version': '2',
      'x-wilson-signature': tamper ? Buffer.from('qa219-invalid-signature').toString('base64') : signature,
      'x-wilson-channel': 'telegram', 'x-wilson-actor-id': systemActorId, 'x-wilson-actor-name': '',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const notificationRows = () => f.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n ORDER BY id');
  const seededIds = [];
  let serial = 0;
  async function seedTask({ assigned = true, metadata = { workspace: 'render_os' } } = {}) {
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES('QA219 synthetic task','QA219 historical label','en_revision','edicion',$1::jsonb) RETURNING id`, [JSON.stringify(metadata)]);
    if (assigned) await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [task.id, recipientId]);
    return task.id;
  }
  async function seedNotice({ taskId, key = 'qa_luciano', details = { destinatario_usuario_id: recipientId, actor_usuario_id: 91001 },
    reason = 'comentario' } = {}) {
    const fingerprint = sha(`qa219-synthetic-notice:${++serial}`);
    const [notice] = await f.query(`INSERT INTO mia_private_task_notifications
      (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles,created_at)
      VALUES($1,'QA219 synthetic recipient',$2,$3,$4,'QA219 synthetic private marker',
        'https://example.invalid/qa219',$5::jsonb,$6::timestamptz) RETURNING id::text AS id,fingerprint`,
    [fingerprint, key, taskId ?? await seedTask(), reason, JSON.stringify(details),
      new Date(Date.UTC(2026, 0, 1, 0, 0, serial)).toISOString()]);
    seededIds.push(notice.id);
    return notice;
  }
  const verify = notice => signed(`/notificaciones-privadas/${notice.id}/verificar?fingerprint=${notice.fingerprint}`);
  async function expectVerify(notice, deliverable) {
    const before = await notificationRows(), result = await verify(notice);
    assert.equal(result.status, 200, 'Eligibility must return a normal decision, not SQL/cast/auth failure');
    assert.deepEqual(result.body, { deliverable });
    assert.deepEqual(await notificationRows(), before, 'Verification does not claim, cancel or acknowledge rows');
  }
  async function expectPreview(ids, limit = 50) {
    const before = await notificationRows();
    const result = await signed(`/notificaciones-privadas?limit=${limit}&dry_run=true`);
    assert.equal(result.status, 200); assert.equal(result.body.dry_run, true);
    assert.ok(Array.isArray(result.body.notifications));
    assert.deepEqual(result.body.notifications.map(row => String(row.id)), ids.map(String));
    assert.deepEqual(await notificationRows(), before, 'Preview must not perform queue DML');
  }
  async function rejectedEverywhere(notice) {
    await expectVerify(notice, false);
    await expectPreview([]);
    const before = await notificationRows(), claimed = await signed('/notificaciones-privadas?limit=1');
    assert.equal(claimed.status, 200); assert.deepEqual(claimed.body, { notifications: [] });
    assert.deepEqual(await notificationRows(), before, 'Ineligible row must not be claimed or have attempts incremented');
  }
  async function isolated(name, run) {
    await t.test(name, async () => {
      // Retire only this test's earlier synthetic rows; never erase queue data.
      if (seededIds.length) await f.query('UPDATE mia_private_task_notifications SET cancelled_at=NOW() WHERE id=ANY($1::bigint[])', [seededIds]);
      await run();
    });
  }

  await isolated('real system signature accepted; tampered signature/query rejected and no human task authority granted', async () => {
    const notice = await seedNotice();
    await expectVerify(notice, true);
    assert.equal((await signed('/notificaciones-privadas?limit=1&dry_run=true', { tamper: true })).status, 401);
    assert.equal((await signed('/notificaciones-privadas?limit=1&dry_run=true', { changedQuery: '?limit=2&dry_run=true' })).status, 401);
    assert.equal((await signed('/tareas/1')).status, 403, 'Automatic actor is not a human/admin task reader');
  });

  await isolated('equivalent JSON numeric representation uses the same ID in preview and verify', async () => {
    const notice = await seedNotice();
    await f.query('UPDATE mia_private_task_notifications SET detalles=$2::jsonb WHERE id=$1',
      [notice.id, '{"destinatario_usuario_id":91003.0}']);
    const [{ representation }] = await f.query("SELECT detalles->>'destinatario_usuario_id' AS representation FROM mia_private_task_notifications WHERE id=$1", [notice.id]);
    assert.equal(representation, '91003.0');
    await expectVerify(notice, true);
    await expectPreview([notice.id]);
  });

  await isolated('invalid oldest rows cannot consume preview/claim LIMIT; only current eligible row changes', async () => {
    const invalid = await seedNotice({ details: { destinatario_usuario_id: null } });
    const unassigned = await seedNotice({ taskId: await seedTask({ assigned: false }) });
    const valid = await seedNotice();
    await expectVerify(invalid, false); await expectVerify(unassigned, false); await expectVerify(valid, true);
    await expectPreview([valid.id], 1);
    const before = await notificationRows(), claimed = await signed('/notificaciones-privadas?limit=1');
    assert.equal(claimed.status, 200); assert.ok(Array.isArray(claimed.body.notifications));
    assert.deepEqual(claimed.body.notifications.map(row => String(row.id)), [valid.id]);
    assert.equal(claimed.body.notifications[0].mensaje, 'QA219 synthetic private marker');
    assert.equal(claimed.body.notifications[0].detalles.destinatario_usuario_id, recipientId);
    const after = await notificationRows();
    assert.equal(after.length, before.length);
    for (let index = 0; index < before.length; index++) {
      if (String(before[index].row.id) !== valid.id) { assert.deepEqual(after[index], before[index]); continue; }
      const { estado, claimed_at, intentos, ...rest } = after[index].row;
      const { estado: oldState, claimed_at: oldClaim, intentos: oldAttempts, ...oldRest } = before[index].row;
      assert.equal(oldState, 'pending'); assert.equal(oldClaim, null);
      assert.equal(estado, 'sending'); assert.equal(intentos, oldAttempts + 1);
      assert.ok(Number.isFinite(Date.parse(claimed_at))); assert.deepEqual(rest, oldRest);
    }
    await expectVerify(valid, true);
    const [{ tarea_id: taskId }] = await f.query('SELECT tarea_id FROM mia_private_task_notifications WHERE id=$1', [valid.id]);
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [taskId, recipientId]);
    await expectVerify(valid, false);
    await expectPreview([]);
  });

  await isolated('inactive recipient never reaches preview, claim or verify', async () => {
    const notice = await seedNotice();
    await f.query('UPDATE usuarios SET activo=false WHERE id=$1', [recipientId]);
    try { await rejectedEverywhere(notice); }
    finally { await f.query('UPDATE usuarios SET activo=true WHERE id=$1', [recipientId]); }
  });
  await isolated('recipient disabling WhatsApp delivery also retires eligibility', async () => {
    const notice = await seedNotice();
    await f.query('UPDATE usuarios SET whatsapp_habilitado=false WHERE id=$1', [recipientId]);
    try { await rejectedEverywhere(notice); }
    finally { await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=$1', [recipientId]); }
  });

  await isolated('rename and reuse of the old login cannot retarget an ID-bound message', async () => {
    const notice = await seedNotice();
    const [other] = await f.query('SELECT usuario FROM usuarios WHERE id=91004');
    await f.query("UPDATE usuarios SET usuario='qa219_renamed' WHERE id=$1", [recipientId]);
    try {
      await rejectedEverywhere(notice);
      await f.query("UPDATE usuarios SET usuario='qa_luciano' WHERE id=91004");
      await rejectedEverywhere(notice);
    } finally {
      await f.query('UPDATE usuarios SET usuario=$1 WHERE id=91004', [other.usuario]);
      await f.query("UPDATE usuarios SET usuario='qa_luciano' WHERE id=$1", [recipientId]);
    }
  });

  async function alias(key, userId, enabled = true) {
    const actorHash = sha(`qa219-synthetic-external-identity:${key}`);
    await f.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name,enabled)
      VALUES($1,$2,$3,'QA219 synthetic alias',$4)`, [actorHash, userId, key, enabled]);
  }
  await isolated('enabled alias belonging to the same ID is a positive canary', async () => {
    await alias('qa219_same_id', recipientId);
    const notice = await seedNotice({ key: 'qa219_same_id' });
    await expectVerify(notice, true); await expectPreview([notice.id]);
  });
  await isolated('disabled alias does not establish recipient ownership', async () => {
    await alias('qa219_disabled', recipientId, false);
    await rejectedEverywhere(await seedNotice({ key: 'qa219_disabled' }));
  });
  await isolated('current username colliding with an enabled alias for another ID fails closed', async () => {
    await alias('qa_luciano', 91004);
    try { await rejectedEverywhere(await seedNotice()); }
    finally { await f.query("DELETE FROM mia_whatsapp_identities WHERE notification_key='qa_luciano'"); }
  });
  await isolated('alias for recipient colliding with another current username fails closed', async () => {
    await alias('qa_designer', recipientId);
    try { await rejectedEverywhere(await seedNotice({ key: 'qa_designer' })); }
    finally { await f.query("DELETE FROM mia_whatsapp_identities WHERE notification_key='qa_designer'"); }
  });

  for (const value of [null, String(recipientId), 0, -1, 1.5, 2147483648, 1e100, true, false, {}, [], 'not-an-id']) {
    await isolated(`present invalid recipient metadata ${JSON.stringify(value)} denies without cast error or legacy fallback`, async () => {
      await rejectedEverywhere(await seedNotice({ details: { destinatario_usuario_id: value } }));
    });
  }

  for (const metadata of [{ workspace: 'historical' }, {}, { workspace: 'render_os', archivada_render_os: true },
    { workspace: 'render_os', papelera_render_os: true }]) {
    await isolated(`comment recipient eligibility rejects task context ${JSON.stringify(metadata)}`, async () => {
      await rejectedEverywhere(await seedNotice({ taskId: await seedTask({ metadata }) }));
    });
  }
  await isolated('missing task cannot authorize private comment delivery', async () => {
    assert.deepEqual(await f.query('SELECT id FROM tareas WHERE id=2147483647'), []);
    await rejectedEverywhere(await seedNotice({ taskId: 2147483647 }));
  });
  await isolated('bloqueada uses the same current-assignment rule, not the shared board read ACL', async () => {
    const notice = await seedNotice({ reason: 'bloqueada', taskId: await seedTask({ assigned: false }) });
    await rejectedEverywhere(notice);
  });
  await isolated('other explicit-ID reason keeps identity guard without imposing comment assignment policy', async () => {
    const notice = await seedNotice({ reason: 'creada', taskId: await seedTask({ assigned: false }) });
    await expectVerify(notice, true); await expectPreview([notice.id]);
    await f.query('UPDATE usuarios SET activo=false WHERE id=$1', [recipientId]);
    try { await rejectedEverywhere(notice); }
    finally { await f.query('UPDATE usuarios SET activo=true WHERE id=$1', [recipientId]); }
  });
  await isolated('legacy notification without recipient ID retains existing eligibility without inferred backfill', async () => {
    const notice = await seedNotice({ key: 'qa219_legacy_unmapped', details: {}, taskId: await seedTask({ assigned: false }) });
    await expectVerify(notice, true); await expectPreview([notice.id]);
    const claimed = await signed('/notificaciones-privadas?limit=1');
    assert.equal(claimed.status, 200); assert.deepEqual(claimed.body.notifications.map(row => String(row.id)), [notice.id]);
    assert.deepEqual(claimed.body.notifications[0].detalles, {}, 'No identity is inferred from a legacy key');
  });
});
