import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { encolarNotificacionPrivadaTarea } from '../src/private-task-notifications.js';
import { taskNotificationEligible } from '../src/task-notification-eligibility.js';

// Direct production enqueue/eligibility against generated PG only: no worker,
// SMTP, provider, HTTP listener or inferred historical recipient identity.
test('new legacy-label task notices bind the resolved recipient ID without rewriting legacy fingerprints or history', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55908, clusterOnly: true });
  t.after(async () => {
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own legacy task recipient-binding fixture cleanup ENOENT: ${f.root}`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55908,
    url: 'postgresql://render2_fixture@127.0.0.1:55908/render2_local_test', identity });
  const db = { query: async (sql, values) => ({ rows: await f.query(sql, values) }) };
  const env = Object.freeze({ APP_URL: 'https://example.invalid' });
  await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=91003');
  const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
    VALUES('QA278 immutable recipient binding','Luciano QA','en_revision','edicion','{"workspace":"render_os"}'::jsonb)
    RETURNING *`);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  for (const name of tables) assert.match(name, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
  const snapshot = async (excluded = []) => {
    const hashes = {};
    for (const name of tables.filter(name => !excluded.includes(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'[]')) AS hash FROM "${name}" r`);
      hashes[name] = row.hash;
    }
    return hashes;
  };
  const invariant = await snapshot(['usuarios', 'mia_private_task_notifications']);
  const queue = () => f.query('SELECT * FROM mia_private_task_notifications ORDER BY id');
  const fingerprint = detail => createHash('sha256').update(JSON.stringify([
    Number(task.id), 'revision', 'qa_luciano', task.updated_at || task.created_at || task.fecha_vencimiento || 'sin-version', detail.trim(),
  ])).digest('hex');
  const enqueue = (detail, names = ['qa_luciano'], extra = {}) => encolarNotificacionPrivadaTarea({
    pool: db, tarea: task, motivo: 'revision', detalle: detail, nombresDestinatarios: names,
    actor: 'QA278 verified actor', actorId: 91001, env, ...extra,
  });
  let notice;
  await t.test('unique active label stores recipient and verified actor IDs using the unchanged legacy fingerprint', async () => {
    const before = await snapshot(['mia_private_task_notifications']);
    const result = await enqueue('QA278 new binding');
    assert.equal(result.encolado, true); assert.equal(result.entregas.length, 1);
    const rows = await f.query('SELECT * FROM mia_private_task_notifications WHERE fingerprint=$1', [fingerprint('QA278 new binding')]);
    assert.equal(rows.length, 1); notice = rows[0];
    assert.equal(notice.detalles.destinatario_usuario_id, 91003);
    assert.equal(notice.detalles.actor_usuario_id, 91001);
    assert.equal(notice.destinatario_clave, 'qa_luciano');
    assert.equal(await taskNotificationEligible(db, notice), true);
    assert.deepEqual(await snapshot(['mia_private_task_notifications']), before);
    const saved = await queue();
    const replay = await enqueue('QA278 new binding');
    assert.equal(replay.encolado, false); assert.equal(replay.duplicadas, 1);
    assert.deepEqual(await queue(), saved, 'Replay must not change metadata, fingerprint or existing notice');
  });

  await t.test('revocation, disabled WhatsApp and login reuse cannot redirect the original notice', async () => {
    assert.ok(notice);
    const saved = await queue();
    const eligible = async expected => {
      const before = await snapshot();
      assert.equal(await taskNotificationEligible(db, notice), expected);
      assert.deepEqual(await snapshot(), before, 'Eligibility is read-only');
    };
    await eligible(true);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91003'); await eligible(false);
    await f.query('UPDATE usuarios SET activo=true WHERE id=91003'); await eligible(true);
    await f.query('UPDATE usuarios SET whatsapp_habilitado=false WHERE id=91003'); await eligible(false);
    await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=91003'); await eligible(true);
    await f.query("UPDATE usuarios SET usuario='qa278_retired_target' WHERE id=91003");
    await f.query("UPDATE usuarios SET usuario='qa_luciano' WHERE id=91004");
    await eligible(false);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91003'); await eligible(false);
    await f.query("UPDATE usuarios SET usuario='qa_designer' WHERE id=91004");
    await f.query("UPDATE usuarios SET usuario='qa_luciano',activo=true WHERE id=91003"); await eligible(true);
    assert.deepEqual(await queue(), saved);
    assert.deepEqual(await snapshot(['usuarios', 'mia_private_task_notifications']), invariant);
  });

  await t.test('unknown, empty, malformed and ambiguous fresh labels skip without writing', async () => {
    await f.query("UPDATE usuarios SET nombre='QA278 ambiguous label' WHERE id IN (91003,91004)");
    for (const names of [['qa278_unknown'], [''], [null], [{}], [false], ['QA278 ambiguous label']]) {
      const before = await snapshot();
      const result = await enqueue('QA278 skipped distinct intent', names);
      assert.equal(result.encolado, false); assert.equal(result.razon, 'responsable_sin_usuario');
      assert.deepEqual(await snapshot(), before);
    }
    await f.query("UPDATE usuarios SET nombre=CASE id WHEN 91003 THEN 'Luciano QA' ELSE 'Designer QA' END WHERE id IN (91003,91004)");
  });

  await t.test('accented login requires an explicitly approved own alias; normalization never grants routing ownership', async () => {
    const accented = 'qa278_josé', canonical = 'qa278_jose';
    const actorHash = createHash('sha256').update('QA278 explicit synthetic accent binding').digest('hex');
    const [original] = await f.query('SELECT usuario FROM usuarios WHERE id=91003');
    assert.deepEqual(await f.query('SELECT 1 FROM mia_whatsapp_identities WHERE actor_hash=$1 OR notification_key=$2',
      [actorHash, canonical]), []);
    let insertedAlias = false;
    try {
      await f.query('UPDATE usuarios SET usuario=$1 WHERE id=91003', [accented]);
      const before = await snapshot(['mia_private_task_notifications']);
      const result = await enqueue('QA278 accented login binding', [accented]);
      assert.equal(result.encolado, true); assert.equal(result.entregas.length, 1);
      const [accentNotice] = await f.query('SELECT * FROM mia_private_task_notifications WHERE id=$1', [result.entregas[0].id]);
      assert.equal(accentNotice.destinatario_clave, canonical);
      assert.equal(accentNotice.detalles.destinatario_usuario_id, 91003);
      assert.equal(accentNotice.detalles.actor_usuario_id, 91001);
      assert.deepEqual(await snapshot(['mia_private_task_notifications']), before,
        'Enqueue does not provision an alias or mutate the resolved account');
      const eligible = async expected => {
        const held = await snapshot();
        assert.equal(await taskNotificationEligible(db, accentNotice), expected);
        assert.deepEqual(await snapshot(), held, 'Routing validation is read-only');
        assert.deepEqual(await f.query('SELECT * FROM mia_private_task_notifications WHERE id=$1', [accentNotice.id]), [accentNotice],
          'Eligibility cannot rewrite the held recipient or retarget the notice');
      };
      // Intentional compatibility gate: LOWER(current username) differs from
      // the normalized key. Approval must supply a real own binding; this test
      // does not prescribe automatic provisioning or provider delivery.
      await eligible(false);
      await f.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name,enabled)
        VALUES($1,91003,$2,'QA278 explicitly approved fixture alias',true)`, [actorHash, canonical]);
      insertedAlias = true;
      await eligible(true);
      await f.query('UPDATE mia_whatsapp_identities SET enabled=false WHERE actor_hash=$1', [actorHash]);
      await eligible(false);
      await f.query('UPDATE mia_whatsapp_identities SET usuario_id=91004,enabled=true WHERE actor_hash=$1', [actorHash]);
      await eligible(false);
      await f.query('UPDATE mia_whatsapp_identities SET usuario_id=91003 WHERE actor_hash=$1', [actorHash]);
      await eligible(true);
    } finally {
      if (insertedAlias) await f.query('DELETE FROM mia_whatsapp_identities WHERE actor_hash=$1', [actorHash]);
      await f.query('UPDATE usuarios SET usuario=$1 WHERE id=91003', [original.usuario]);
    }
    assert.deepEqual(await f.query('SELECT 1 FROM mia_whatsapp_identities WHERE actor_hash=$1 OR notification_key=$2',
      [actorHash, canonical]), []);
    assert.deepEqual(await snapshot(['usuarios', 'mia_private_task_notifications']), invariant);
  });

  await t.test('preexisting no-ID notice remains historical, unchanged and deduplicated rather than backfilled', async () => {
    assert.ok(notice);
    const detail = 'QA278 historical replay';
    // Explicit synthetic historical fixture: never infer an ID for old rows.
    const [historical] = await f.query(`INSERT INTO mia_private_task_notifications
      (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
      SELECT $1,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,
        '{"cliente":null,"actor":"QA278 historical actor"}'::jsonb
      FROM mia_private_task_notifications WHERE id=$2 RETURNING *`, [fingerprint(detail), notice.id]);
    const before = await snapshot();
    const replay = await enqueue(detail);
    assert.equal(replay.encolado, false); assert.equal(replay.duplicadas, 1);
    assert.deepEqual(await snapshot(), before, 'Existing fingerprint does not get new ID metadata');
    await f.query('UPDATE usuarios SET activo=false,whatsapp_habilitado=false WHERE id=91003');
    const revoked = await snapshot();
    assert.equal(await taskNotificationEligible(db, historical), true, 'No-ID history retains existing legacy eligibility semantics');
    assert.deepEqual(await snapshot(), revoked);
    assert.deepEqual(await f.query('SELECT * FROM mia_private_task_notifications WHERE id=$1', [historical.id]), [historical]);
    await f.query('UPDATE usuarios SET activo=true,whatsapp_habilitado=true WHERE id=91003');
  });
  assert.deepEqual(await snapshot(['usuarios', 'mia_private_task_notifications']), invariant);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
  t.diagnostic(`${tables.length} public tables observed; outside explicit user and queue fixtures hashes are unchanged.`);
});
