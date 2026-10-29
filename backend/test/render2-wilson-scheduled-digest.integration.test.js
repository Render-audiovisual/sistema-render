import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { runWilsonScheduledDigest } from '../src/wilson-chat.js';

// Fresh synthetic cluster only: no server, scheduler, provider or configured DB.
test('Wilson scheduled digest: physical PostgreSQL atomicity, stable IDs and concurrent replay', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 56027;
  const fixture = await startLocalHarness({ port, clusterOnly: true });
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'render2_fixture', database: 'render2_local_test',
    password: '', ssl: false, max: 4, statement_timeout: 15000, lock_timeout: 10000,
    connectionTimeoutMillis: 5000, application_name: 'owned_wilson_scheduled_digest_test' });
  t.after(async () => {
    try { await pool.end(); } finally {
      await fixture.cleanup();
      await assert.rejects(access(fixture.root), { code: 'ENOENT' });
      t.diagnostic('Owned PG56027 cluster stopped and removed; no external messages or production access.');
    }
  });
  const identity = (await pool.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });

  // Identical names and misleading legacy labels must not merge recipients.
  await pool.query("UPDATE usuarios SET nombre='Same synthetic person',rol='admin' WHERE id IN (91001,91002,91003)");
  const clientId = (await pool.query("INSERT INTO clientes(nombre) VALUES('Owned digest client') RETURNING id")).rows[0].id;
  async function ownTask(owner, title, properties = {}) {
    const task = (await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,cliente_id,propiedades_extra)
      VALUES($1,'Same synthetic person','pendiente','edicion',$2,$3::jsonb) RETURNING id`,
    [title, clientId, JSON.stringify({ workspace: 'render_os', private_financial_canary: 'NEVER_SERIALIZE_MONEY', ...properties })])).rows[0];
    await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [task.id, owner]);
    return task.id;
  }
  const firstTask = await ownTask(91001, 'Stable first task');
  const failingTask = await ownTask(91003, 'Stable retry task');
  await ownTask(91004, 'Blocked, never claim', { bloqueada: true });
  const historicalConversation = (await pool.query(`INSERT INTO wilson_conversaciones(usuario_id,periodo)
    VALUES(91001,'2025-01') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO wilson_mensajes(conversacion_id,remitente,contenido,tipo)
    VALUES($1,'wilson','Historical sentinel','recordatorio')`, [historicalConversation]);
  const friday = new Date('2026-08-21T13:00:00Z');
  const snapshot = async () => {
    const state = {};
    for (const table of ['wilson_envios_programados', 'wilson_conversaciones', 'wilson_mensajes']) {
      state[table] = (await pool.query(`SELECT to_jsonb(r) data FROM "${table}" r ORDER BY to_jsonb(r)::text`)).rows;
    }
    return state;
  };
  const businessSnapshot = async () => {
    const state = {};
    for (const table of ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'publicaciones', 'historias']) {
      state[table] = (await pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'[]')) hash FROM "${table}" r`)).rows[0].hash;
    }
    return state;
  };
  const claimOwners = async () => (await pool.query('SELECT usuario_id FROM wilson_envios_programados ORDER BY usuario_id,fecha')).rows.map(r => r.usuario_id);

  await t.test('outside Córdoba 10:00 performs no database access', async () => {
    const result = await runWilsonScheduledDigest({ query() { assert.fail('off-schedule SQL'); }, connect() { assert.fail('off-schedule lease'); } },
      { now: new Date('2026-08-21T12:59:59Z') });
    assert.equal(result.due, false);
  });

  // An actual PostgreSQL exception AFTER the claim and conversation insert,
  // rather than a mocked query failure, must undo both in that recipient's tx.
  await pool.query(`CREATE FUNCTION owned_digest_message_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM wilson_conversaciones WHERE id=NEW.conversacion_id AND usuario_id=91003) THEN
        RAISE EXCEPTION 'OWNED_DIGEST_PRIVATE_SQL_FAULT';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER owned_digest_message_fault BEFORE INSERT ON wilson_mensajes
    FOR EACH ROW EXECUTE FUNCTION owned_digest_message_fault()`);
  const originalBusiness = await businessSnapshot();
  await t.test('message failure rolls back claim/conversation and isolates successful recipient', async () => {
    await assert.rejects(runWilsonScheduledDigest(pool, { now: friday }), error => {
      assert.equal(error.code, 'WILSON_DIGEST_FAILED');
      assert.deepEqual(error.result, { due: true, date: '2026-08-21', type: 'semanal', sent: 1, duplicates: 0, skipped: 2, failed: 1 });
      assert.ok(!error.message.includes('PRIVATE_SQL_FAULT'));
      return true;
    });
    assert.deepEqual(await claimOwners(), [91001]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM wilson_conversaciones WHERE usuario_id=91003')).rows[0].n, 0);
    const messages = (await pool.query(`SELECT c.usuario_id,c.periodo,m.contenido,m.metadata FROM wilson_mensajes m
      JOIN wilson_conversaciones c ON c.id=m.conversacion_id ORDER BY m.id`)).rows;
    assert.equal(messages.length, 2);
    assert.equal(messages[0].contenido, 'Historical sentinel');
    assert.equal(messages[1].usuario_id, 91001);
    assert.equal(messages[1].periodo, '2026-08');
    assert.equal(messages[1].contenido, 'Cierre de semana: tenés que priorizar esto:\n1. Stable first task — Owned digest client\nSi algún registro está mal, decime y lo revisamos.');
    assert.deepEqual(messages[1].metadata, { task_ids: [firstTask] });
    assert.ok(!JSON.stringify(messages).includes('NEVER_SERIALIZE_MONEY'));
    assert.deepEqual(await businessSnapshot(), originalBusiness);
  });
  await pool.query('DROP TRIGGER owned_digest_message_fault ON wilson_mensajes; DROP FUNCTION owned_digest_message_fault()');
  await t.test('retry commits failed recipient; replay leaves exact history unchanged', async () => {
    const result = await runWilsonScheduledDigest(pool, { now: friday });
    assert.equal(result.sent, 1); assert.equal(result.duplicates, 1); assert.equal(result.skipped, 2);
    assert.deepEqual(await claimOwners(), [91001, 91003]);
    const retryMessage = (await pool.query(`SELECT m.metadata FROM wilson_mensajes m JOIN wilson_conversaciones c
      ON c.id=m.conversacion_id WHERE c.usuario_id=91003`)).rows;
    assert.deepEqual(retryMessage, [{ metadata: { task_ids: [failingTask] } }]);
    const committed = await snapshot();
    assert.equal((await runWilsonScheduledDigest(pool, { now: friday })).duplicates, 2);
    assert.deepEqual(await snapshot(), committed);
    assert.deepEqual(await businessSnapshot(), originalBusiness);
  });
  await t.test('no eligible task did not consume claim; new personal task can send same Friday', async () => {
    const added = await ownTask(91002, 'Independent second profile');
    const result = await runWilsonScheduledDigest(pool, { now: friday });
    assert.equal(result.sent, 1); assert.equal(result.duplicates, 2); assert.equal(result.skipped, 1);
    assert.deepEqual(await claimOwners(), [91001, 91002, 91003]);
    const messages = (await pool.query(`SELECT m.metadata FROM wilson_mensajes m JOIN wilson_conversaciones c
      ON c.id=m.conversacion_id WHERE c.usuario_id=91002`)).rows;
    assert.deepEqual(messages, [{ metadata: { task_ids: [added] } }]);
  });
  await t.test('two concurrent one-shots use real unique constraint, exactly one message per ID/date/type', async () => {
    const before = await businessSnapshot();
    const results = await Promise.all([0, 1].map(() => runWilsonScheduledDigest(pool, { now: new Date('2026-08-28T13:00:00Z') })));
    assert.equal(results.reduce((n, r) => n + r.sent, 0), 3);
    assert.equal(results.reduce((n, r) => n + r.duplicates, 0), 3);
    const claims = (await pool.query(`SELECT usuario_id,fecha::text,tipo FROM wilson_envios_programados
      WHERE fecha='2026-08-28' ORDER BY usuario_id`)).rows;
    assert.deepEqual(claims.map(c => c.usuario_id), [91001, 91002, 91003]);
    assert.ok(claims.every(c => c.tipo === 'semanal_mensual'));
    const messages = (await pool.query("SELECT contenido FROM wilson_mensajes WHERE contenido LIKE 'Cierre semanal y mensual:%'")).rows;
    assert.equal(messages.length, 3);
    assert.deepEqual(await businessSnapshot(), before);
    assert.equal((await pool.query('SELECT contenido FROM wilson_mensajes WHERE conversacion_id=$1', [historicalConversation])).rows[0].contenido, 'Historical sentinel');
  });
});
