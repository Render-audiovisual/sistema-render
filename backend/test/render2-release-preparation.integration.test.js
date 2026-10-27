import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Preparation-only snapshot QA. Business/DDL writes below belong exclusively
// to this newly created disposable fixture, OUTSIDE snapshot calls. No migration
// executor, backup restore, release authorization or production endpoint.
test('release preparation retains post-backup tasks and rejects stale data/schema/security observations without writes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const { captureReleaseSnapshot, compareReleaseSnapshot } = await import('../src/release-preservation-snapshot.js');
  const { readMigrationIdentity, readMigrationStatus, buildMigrationPlan } = await import('../src/migrations.js');
  const port = 55995, f = await startLocalHarness({ port, clusterOnly: true });
  let db;
  t.after(async () => {
    try { await db?.query('ROLLBACK').catch(() => {}); await db?.end(); }
    finally { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
      t.diagnostic('Owned release-preparation PG55995 removed ENOENT; migrations only bootstrap this disposable fixture, never a release target.'); }
  });
  db = new pg.Client({ host: '127.0.0.1', port, user: 'render2_fixture', database: 'render2_local_test', password: '',
    ssl: false, statement_timeout: 20000, lock_timeout: 12000, connectionTimeoutMillis: 5000 });
  await db.connect();
  assertFixtureIdentity({ root: f.root, cwd: f.root, port, url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,
    identity: (await db.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`)).rows[0] });
  const canary = 'QA_POST_BACKUP_PRIVATE_CONTENT_MUST_NOT_LEAVE_DATABASE';
  const created = async title => (await db.query(`INSERT INTO public.tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
    VALUES($1,'QA fixture member','desarrollo','pendiente','{"workspace":"render_os"}') RETURNING id`, [title])).rows[0].id;
  const originalId = await created('QA preparation original');
  const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const physical = async () => {
    const tables = (await db.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"")).rows;
    const hashes = {};
    for (const { tablename } of tables) {
      assert.match(tablename, /^[a-z_][a-z0-9_]*$/);
      hashes[tablename] = (await db.query(`SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM ONLY public."${tablename}" r`)).rows[0].hash;
    }
    const catalogs = (await db.query(`SELECT md5(jsonb_build_object(
      'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity)
        ORDER BY c.oid) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
      'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl::text,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_array(k.oid,k.conname,k.convalidated,k.condeferrable,pg_catalog.pg_get_constraintdef(k.oid)) ORDER BY k.oid)
        FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public'),
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
      'triggers',(SELECT jsonb_agg(jsonb_build_array(g.oid,g.tgenabled,pg_catalog.pg_get_triggerdef(g.oid),md5(p.prosrc),p.prosecdef,p.proconfig) ORDER BY g.oid)
        FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid=g.tgfoid
        JOIN pg_catalog.pg_class c ON c.oid=g.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
      'sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY sequencename) FROM pg_catalog.pg_sequences s WHERE schemaname='public')
      )::text) hash`)).rows[0].hash;
    return { hashes, catalogs };
  };
  const readonly = async work => {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      // Equal formatting for the independent physical checks before/after the
      // module's transaction-local canonical formatting configuration.
      await db.query("SET LOCAL TimeZone TO 'UTC'");
      await db.query('SET LOCAL search_path TO pg_catalog');
      const before = await physical();
      const mode = (await db.query("SELECT current_setting('transaction_read_only') ro,current_setting('transaction_isolation') isolation")).rows[0];
      assert.equal(mode.ro, 'on'); assert.equal(mode.isolation, 'repeatable read');
      const result = await work();
      assert.deepEqual(await physical(), before, 'Snapshot calls cannot mutate any public row/xmin/ctid, sequence, ACL or catalog');
      await db.query('COMMIT'); return result;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  };
  const capture = () => readonly(() => captureReleaseSnapshot(db));
  const compare = reference => readonly(() => compareReleaseSnapshot(db, reference));
  const taskEntry = snapshot => snapshot.tables.find(row => row.name === 'tareas');
  const assertShape = snapshot => {
    assert.equal(snapshot.version, 1); assert.ok(hex(snapshot.sha256));
    assert.ok(snapshot.tables.length > 0);
    assert.ok(snapshot.tables.every(row => typeof row.rows === 'string' && /^(0|[1-9]\d*)$/.test(row.rows)
      && hex(row.dataSha256) && hex(row.securitySha256) && row.columns.every(c => typeof c.name === 'string' && typeof c.type === 'string' && typeof c.notNull === 'boolean')));
    assert.equal(JSON.stringify(snapshot).includes(canary), false, 'No business row values in returned snapshot');
  };
  const sqlPlan = () => readonly(async () => buildMigrationPlan({ environment: 'test', identity: await readMigrationIdentity(db), status: await readMigrationStatus(db) }));
  let backupObservation, currentObservation, newTaskId;

  await t.test('caller must supply RR READ ONLY and repeated fresh transactions have identical hashes', async () => {
    await assert.rejects(captureReleaseSnapshot(db));
    backupObservation = await capture(); assertShape(backupObservation);
    const repeated = await capture(); assertShape(repeated);
    assert.equal(repeated.sha256, backupObservation.sha256, 'Do not bind snapshot hash to transaction IDs or physical snapshot text');
    const compared = await compare(backupObservation);
    assert.equal(compared.matches, true); assert.equal(compared.currentSha256, backupObservation.sha256);
    assert.deepEqual(compared.changedTables, []); assert.equal(compared.schemaChanged, false);
  });
  await t.test('task committed after backup invalidates old preservation approval even though SQL migration plan is unchanged', async () => {
    const planBefore = await sqlPlan();
    newTaskId = await created(canary); // Deliberate fixture business write, not a snapshot call.
    const stale = await compare(backupObservation);
    assert.equal(stale.matches, false, 'Old preservation observation cannot authorize preparation of current data');
    assert.ok(stale.changedTables.includes('tareas')); assert.equal(stale.schemaChanged, false);
    assert.equal(await sqlPlan(), planBefore, 'Migration-only hash cannot detect post-backup tasks; preservation gate is separately required');
    currentObservation = await capture(); assertShape(currentObservation);
    assert.equal(currentObservation.sha256, stale.currentSha256);
    assert.notEqual(taskEntry(currentObservation).dataSha256, taskEntry(backupObservation).dataSha256);
    assert.equal(BigInt(taskEntry(currentObservation).rows), BigInt(taskEntry(backupObservation).rows) + 1n);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.tareas WHERE id=$1', [newTaskId])).rows[0].n, 1);
    assert.equal((await compare(currentObservation)).matches, true, 'New preparation includes, never discards, post-backup work');
  });
  await t.test('editing an original row is detected even when task count stays unchanged', async () => {
    const count = taskEntry(currentObservation).rows;
    await db.query("UPDATE public.tareas SET aclaraciones='QA changed after preparation' WHERE id=$1", [originalId]);
    const changed = await compare(currentObservation);
    assert.equal(changed.matches, false); assert.ok(changed.changedTables.includes('tareas')); assert.equal(changed.schemaChanged, false);
    const fresh = await capture(); assert.equal(taskEntry(fresh).rows, count);
    assert.notEqual(taskEntry(fresh).dataSha256, taskEntry(currentObservation).dataSha256); currentObservation = fresh;
  });
  await t.test('strict full-state comparator rejects additive columns instead of implicitly allowing a migration', async () => {
    await db.query('ALTER TABLE public.tareas ADD COLUMN qa_release_preparation_column TEXT');
    try {
      const changed = await compare(currentObservation);
      assert.equal(changed.matches, false); assert.ok(changed.changedTables.includes('tareas')); assert.equal(changed.schemaChanged, true);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.tareas WHERE id=$1', [newTaskId])).rows[0].n, 1);
    } finally { await db.query('ALTER TABLE public.tareas DROP COLUMN qa_release_preparation_column'); }
    currentObservation = await capture();
  });
  await t.test('table ACL and constraints are preservation inputs even when rows stay byte-identical', async () => {
    for (const [change, undo] of [
      ['GRANT SELECT ON public.tareas TO PUBLIC', 'REVOKE SELECT ON public.tareas FROM PUBLIC'],
      ['ALTER TABLE public.tareas ADD CONSTRAINT qa_release_preparation_id CHECK (id>0)', 'ALTER TABLE public.tareas DROP CONSTRAINT qa_release_preparation_id'],
    ]) {
      const before = await capture(); await db.query(change);
      try {
        const changed = await compare(before), after = await capture();
        assert.equal(changed.matches, false); assert.ok(changed.changedTables.includes('tareas')); assert.equal(changed.schemaChanged, true);
        assert.equal(taskEntry(after).dataSha256, taskEntry(before).dataSha256);
        assert.notEqual(taskEntry(after).securitySha256, taskEntry(before).securitySha256);
      } finally { await db.query(undo); }
    }
    currentObservation = await capture();
  });
  await t.test('tampered snapshot SHA/count are never accepted as preparation evidence', async () => {
    const corruptHash = { ...currentObservation, sha256: '0'.repeat(64) };
    await readonly(() => assert.rejects(compareReleaseSnapshot(db, corruptHash)));
    const corruptRows = structuredClone(currentObservation); taskEntry(corruptRows).rows = String(BigInt(taskEntry(corruptRows).rows) + 1n);
    await readonly(() => assert.rejects(compareReleaseSnapshot(db, corruptRows)));
    assert.equal((await compare(currentObservation)).matches, true);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.tareas WHERE id=ANY($1::int[])', [[originalId, newTaskId]])).rows[0].n, 2);
  });
});
