import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, request } from '../scripts/render2-local-test.js';
import { assertCoreSchemaReady } from '../src/startup-schema.js';

const migration = '091_production_visit_results.sql';

test('actual CLI upgrades populated pre091 production history without inferring results or modifying old rows', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55939;
  const f = await startLocalHarness({ port, clusterOnly: true, deferProductionResultsMigration: true });
  let db;
  t.after(async () => {
    try {
      if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    } finally {
      await f.cleanup();
      await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned production-result upgrade fixture stopped and removed.');
    }
  });
  assert.equal(f.base, null);
  const identitySql = `SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  guard((await f.query(identitySql))[0]);
  db = new pg.Client({ host: '127.0.0.1', port, user: 'render2_fixture', password: '',
    database: 'render2_local_test', ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 20000,
    options: '-c search_path=public', application_name: 'render2_qa319_result_upgrade' });
  await db.connect(); guard((await db.query(identitySql)).rows[0]);
  const safeOutput = result => {
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(/postgres(?:ql)?:\/\//i.test(output), false, 'Entrypoint output must not expose a database URL');
    assert.equal(output.includes(f.secret), false, 'Entrypoint output must not expose the fixture secret');
  };
  async function finish(handle) {
    const timer = setTimeout(() => { void handle.stop(); }, 20000);
    try { const result = await handle.done; safeOutput(result); return result; }
    finally { clearTimeout(timer); }
  }
  const cli = async args => finish(await f.launchActual({ entry: 'migrate', args }));
  const status = async () => {
    const result = await cli(['status']); assert.equal(result.code, 0); assert.equal(result.signal, null);
    return JSON.parse(result.stdout);
  };
  const tableNames = async () => (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const oldTables = await tableNames();
  assert.ok(oldTables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  assert.equal(oldTables.includes('produccion_resultados'), false);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA319 pre091 historical client',true) RETURNING id");
  const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,propiedades_extra)
    VALUES('QA319 Visita histórica','QA historical display',$1,'en_progreso','produccion','visita',$2::jsonb) RETURNING id`,
  [client.id, JSON.stringify({ workspace: 'render_os', produccion_videos_previstos: 3,
    produccion_registros: [{ id: randomUUID(), cantidad: 2, fecha: '2026-09-15', autor: 'QA legacy author',
      observaciones: 'QA legacy notes', correcciones: [{ cantidad: 1, motivo: 'QA old correction' }] }],
    qa319_preserve: { nested: ['legacy', 1] } })]);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'responsable')", [task.id]);
  const visitId = randomUUID(), videoId = randomUUID(), photoId = randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,drive_url,revision,creado_por_id,actualizado_por_id)
    VALUES($1,$2,$3,'2026-09-15','QA319 preserved visit','QA319 preserved notes','https://example.invalid/old-drive',7,91001,91001)`,
  [visitId, task.id, client.id]);
  await f.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) VALUES($1,91001),($1,91003)', [visitId]);
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,material_url,observaciones,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA319 old video','QA319 old script','pendiente','https://example.invalid/old-video','QA319 old video notes',91001,91001)`, [videoId, visitId]);
  await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,estado,drive_url,observaciones,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA319 old photo','repetir','https://example.invalid/old-photo','QA319 old photo notes',91001,91001)`, [photoId, visitId]);
  async function snapshot() {
    const hashes = {};
    for (const name of oldTables.filter(name => name !== '_migrations')) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${name}" r`);
      hashes[name] = row.hash;
    }
    return hashes;
  }
  const ledger = () => f.query('SELECT to_jsonb(m) AS row FROM _migrations m ORDER BY id');
  const before = await snapshot(), ledgerBefore = await ledger();
  let approved;

  await t.test('status reports only091 pending and ordinary startup refuses without writing or repairing', async () => {
    approved = await status();
    assert.deepEqual(approved.status.pending.map(file => file.name), [migration]);
    assert.deepEqual(approved.status.unknownApplied, []);
    assert.ok(approved.status.applied.includes('090_task_create_receipts.sql'));
    assert.match(approved.planHash, /^[0-9a-f]{64}$/);
    assert.equal(approved.identity.database, 'render2_local_test'); assert.equal(approved.identity.username, 'render2_fixture');
    await assert.rejects(assertCoreSchemaReady(db), /Principal schema is not compatible/);
    const server = await f.launchActual({ entry: 'server' });
    try {
      await assert.rejects(server.ready);
      const result = await finish(server); assert.notEqual(result.code, 0); assert.equal(result.signal, null);
      assert.equal(/Backend listening|render-startup-ready/.test(result.stdout), false);
    } finally { await server.stop(); }
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await ledger(), ledgerBefore);
    assert.deepEqual(await tableNames(), oldTables);
  });

  await t.test('explicit approved CLI apply creates an empty journal, records091 and preserves every old row physically', async () => {
    assert.ok(approved);
    const result = await cli(['apply', '--plan', approved.planHash, '--database', 'render2_local_test', '--user', 'render2_fixture']);
    assert.equal(result.code, 0); assert.equal(result.signal, null);
    const after = await status();
    assert.deepEqual(after.status.pending, []); assert.deepEqual(after.status.unknownApplied, []);
    assert.deepEqual(after.status.applied, [...approved.status.applied, migration]);
    assert.deepEqual(await tableNames(), [...oldTables, 'produccion_resultados'].sort());
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await f.query('SELECT id FROM produccion_resultados'), []);
    const appliedLedger = await ledger();
    assert.deepEqual(appliedLedger.slice(0, ledgerBefore.length), ledgerBefore);
    assert.equal(appliedLedger.length, ledgerBefore.length + 1);
    assert.equal(appliedLedger.at(-1).row.nombre, migration);
    await assertCoreSchemaReady(db);
    const columns = (await db.query(`SELECT column_name,udt_name,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='produccion_resultados' ORDER BY ordinal_position`)).rows;
    assert.deepEqual(columns.map(row => [row.column_name,row.udt_name,row.is_nullable]), [
      ['id','uuid','NO'],['visita_id','uuid','NO'],['visita_revision','int4','NO'],['revision_resultante','int4','NO'],
      ['registrado_por_id','int4','NO'],['request_id','uuid','NO'],['payload_hash','text','NO'],
      ['registrado_at','timestamptz','NO'],['resumen','jsonb','NO'],
    ]);
    const triggers = (await db.query(`SELECT t.tgname,t.tgenabled,t.tgtype,t.tgnargs,p.proname,n.nspname
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.produccion_resultados'::regclass AND NOT t.tgisinternal`)).rows;
    assert.deepEqual(triggers, [{ tgname:'produccion_resultado_immutable',tgenabled:'O',tgtype:27,tgnargs:0,
      proname:'produccion_resultado_immutable',nspname:'public' }]);
  });

  await t.test('actual normal startup becomes ready after091 without changing populated data or creating results', async () => {
    const ledgerBeforeStart = await ledger();
    const server = await f.launchActual({ entry: 'server' });
    const timer = setTimeout(() => { void server.stop(); }, 20000);
    try {
      const ready = await server.ready;
      const health = await request(ready.base, '/health'); assert.equal(health.status, 200);
      assert.deepEqual(server.intervals(), []);
    } finally { clearTimeout(timer); safeOutput(await server.stop()); }
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await ledger(), ledgerBeforeStart);
    assert.deepEqual(await f.query('SELECT id FROM produccion_resultados'), []);
  });

  await t.test('real SQL constraints reject invalid versions, revisions, duplicate keys and mutation with SQLSTATE', async () => {
    guard((await db.query(identitySql)).rows[0]);
    const insert = `INSERT INTO produccion_resultados(id,visita_id,visita_revision,revision_resultante,registrado_por_id,request_id,payload_hash,resumen)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`;
    const id = randomUUID(), requestId = randomUUID();
    const values = [id, visitId, 7, 8, 91001, requestId, 'a'.repeat(64), JSON.stringify({version:1})];
    async function rejectsState(sql, params, code) {
      await db.query('SAVEPOINT expected_failure');
      try { await assert.rejects(db.query(sql, params), error => error.code === code); }
      finally { await db.query('ROLLBACK TO SAVEPOINT expected_failure'); await db.query('RELEASE SAVEPOINT expected_failure'); }
    }
    await db.query('BEGIN');
    try {
      for (const summary of [{}, {version:0}, {version:2}, {version:'1'}, []]) {
        await rejectsState(insert, [...values.slice(0,7),JSON.stringify(summary)], '23514');
      }
      await rejectsState(insert, values.map((value,index) => index === 3 ? 9 : value), '23514');
      await rejectsState(insert, values.map((value,index) => index === 2 ? 0 : index === 3 ? 1 : value), '23514');
      await rejectsState(insert, values.map((value,index) => index === 6 ? 'not-a-hash' : value), '23514');
      await rejectsState(insert, values.map((value,index) => index === 1 ? randomUUID() : value), '23503');
      await db.query(insert, values);
      await rejectsState(insert, values.map((value,index) => index === 0 || index === 5 ? randomUUID() : value), '23505');
      await rejectsState(insert, values.map((value,index) => index === 0 ? randomUUID() : index === 2 ? 8 : index === 3 ? 9 : value), '23505');
      await rejectsState('UPDATE produccion_resultados SET resumen=resumen WHERE id=$1', [id], '23514');
      await rejectsState('DELETE FROM produccion_resultados WHERE id=$1', [id], '23514');
      assert.equal((await db.query('SELECT id FROM produccion_resultados WHERE id=$1', [id])).rows.length, 1);
    } finally { await db.query('ROLLBACK'); }
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await f.query('SELECT id FROM produccion_resultados'), []);
  });
});
