import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { runMigrations, readMigrationIdentity, readMigrationStatus, buildMigrationPlan } from '../src/migrations.js';
import { assertCoreSchemaReady } from '../src/startup-schema.js';
import { createTaskComment, findTaskCommentCreation } from '../src/task-comment-receipts.js';

const migration = '089_task_comment_create_receipts.sql';
const relation = 'task_comment_create_receipts';
const port = 55863;
const url = 'postgresql://render2_fixture@127.0.0.1:55863/render2_local_test';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('089 real migration preserves populated 088 history, records only its ledger entry and supports receipts', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port, clusterOnly: true, deferTaskCommentReceiptsMigration: true });
  let pool, tableCount;
  try {
    // No configured DB import, env-file read, API listener or caller-supplied URL.
    assertFixtureIdentity({ root: f.root, cwd: f.root, port, url });
    pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000,
      statement_timeout: 20000, options: '-c search_path=public' });
    const rows = async (sql, values = []) => (await pool.query(sql, values)).rows;
    async function guardPhysicalIdentity() {
      const [identity] = await rows(`SELECT current_database() AS database,current_user AS username,
        host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
      assertFixtureIdentity({ root: f.root, cwd: f.root, port, url, identity });
    }
    await guardPhysicalIdentity();
    const initialStatus = await readMigrationStatus(pool);
    assert.equal(initialStatus.ledgerExists, true);
    assert.deepEqual(initialStatus.unknownApplied, []);
    assert.deepEqual(initialStatus.pending.map(file => file.name), [migration]);
    assert.ok(initialStatus.applied.includes('088_project_child_create_receipts.sql'));
    await assert.rejects(assertCoreSchemaReady(pool), /Principal schema is not compatible/);
    assert.deepEqual(await rows("SELECT to_regclass('public.task_comment_create_receipts')::text AS name"), [{ name: null }]);

    const [actor] = await rows('SELECT id,rol,activo,session_version FROM usuarios WHERE id=91001');
    assert.equal(actor.id, 91001); assert.equal(actor.rol, 'admin'); assert.equal(actor.activo, true);
    const [task] = await rows(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES('QA211 historical populated task','QA211 historical display','pendiente','edicion',
        '{"qa211":"legacy-metadata","nested":{"preserve":true}}'::jsonb) RETURNING id`);
    await rows(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido,created_at) VALUES
      ($1,'QA211 historical author','QA211 legacy A','2026-01-02T03:04:05.123Z'),
      ($1,'QA211 historical author','QA211 legacy A','2026-01-02T03:04:05.124Z')`, [task.id]);
    const oldComments = await rows('SELECT to_jsonb(t) AS row FROM tarea_comentarios t ORDER BY id');
    assert.equal(oldComments.length, 2, 'Equal legacy text must remain two real comments, without inferred receipts');
    const tableNames = async () => (await rows("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
    const oldTables = await tableNames();
    tableCount = oldTables.length;
    assert.ok(oldTables.length > 30);
    assert.ok(oldTables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
    const oldDataTables = oldTables.filter(name => name !== '_migrations');
    const ledger = () => rows('SELECT to_jsonb(t) AS row FROM _migrations t ORDER BY id');
    async function dataSnapshot() {
      const result = {};
      // Every complete row, including accounts, goes into its hash; no secret
      // values are used in assertion output, diagnostics or logs.
      for (const name of oldDataTables) result[name] = hash(await rows(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text`));
      return result;
    }
    async function schemaSnapshot() {
      return {
        columns: await rows(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,
          character_maximum_length,numeric_precision,numeric_scale,datetime_precision,is_identity,identity_generation
          FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])
          ORDER BY table_name,ordinal_position`, [oldTables]),
        constraints: await rows(`SELECT c.conrelid::regclass::text AS table_name,c.conname,c.contype,c.convalidated,
          pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
          JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[])
          ORDER BY table_name,c.conname`, [oldTables]),
        indexes: await rows(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
          AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`, [oldTables]),
        triggers: await rows(`SELECT t.tgrelid::regclass::text AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY table_name,t.tgname`, [oldTables]),
      };
    }
    const [ledgerSequence] = await rows("SELECT pg_get_serial_sequence('public._migrations','id') AS name");
    const sequences = () => rows(`SELECT * FROM pg_sequences WHERE schemaname='public'
      AND ('public.'||sequencename)<>$1 ORDER BY sequencename`, [ledgerSequence.name]);
    const before = await dataSnapshot(), schemaBefore = await schemaSnapshot(), sequencesBefore = await sequences(), ledgerBefore = await ledger();
    const appliedLogs = [];
    async function migrateExpected(pending) {
      await guardPhysicalIdentity();
      const identity = await readMigrationIdentity(pool), status = await readMigrationStatus(pool);
      assert.deepEqual(status.pending.map(file => file.name), pending);
      assert.deepEqual(status.unknownApplied, []);
      await runMigrations(pool, { log: message => appliedLogs.push(message) }, { approval: {
        environment: 'test', expectedIdentity: identity,
        planHash: buildMigrationPlan({ environment: 'test', identity, status }), purpose: 'local-explicit',
      } });
    }
    await migrateExpected([migration]);
    assert.deepEqual(await tableNames(), [...oldTables, relation].sort());
    assert.deepEqual(await dataSnapshot(), before);
    assert.deepEqual(await schemaSnapshot(), schemaBefore);
    assert.deepEqual(await sequences(), sequencesBefore);
    assert.deepEqual(await rows('SELECT to_jsonb(t) AS row FROM tarea_comentarios t ORDER BY id'), oldComments);
    assert.deepEqual(await rows('SELECT * FROM task_comment_create_receipts'), [], 'No backfill or guessed operation IDs');
    const ledgerAfter = await ledger();
    const ledgerSequenceState = () => rows(`SELECT * FROM pg_sequences WHERE schemaname='public'
      AND ('public.'||sequencename)=$1`, [ledgerSequence.name]);
    const ledgerSequenceAfter = await ledgerSequenceState();
    assert.equal(ledgerSequenceAfter.length, 1);
    assert.deepEqual(ledgerAfter.slice(0, -1), ledgerBefore);
    assert.equal(ledgerAfter.length, ledgerBefore.length + 1);
    assert.equal(ledgerAfter.at(-1).row.nombre, migration);
    assert.ok(Number.isFinite(Date.parse(ledgerAfter.at(-1).row.aplicada_at)));
    assert.deepEqual(appliedLogs, [`Migration applied: ${migration}`]);
    await assertCoreSchemaReady(pool);

    const columns = await rows(`SELECT column_name,data_type,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [relation]);
    assert.deepEqual(columns, [ ['actor_user_id','integer'],['request_id','uuid'],['payload_hash','text'],
      ['tarea_id','integer'],['comment_id','integer'],['workspace','text'],['committed_at','timestamp with time zone'] ]
      .map(([column_name,data_type]) => ({ column_name,data_type,is_nullable:'NO' })));
    const constraints = await rows(`SELECT contype,confrelid::regclass::text AS target,confdeltype,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='public.task_comment_create_receipts'::regclass ORDER BY conname`);
    assert.equal(constraints.filter(c => c.contype === 'p').length, 1);
    assert.equal(constraints.find(c => c.contype === 'p').definition, 'PRIMARY KEY (actor_user_id, request_id)');
    const foreign = constraints.filter(c => c.contype === 'f');
    assert.equal(foreign.length, 1, 'Only actor FK; task/comment tombstones do not cascade');
    assert.equal(foreign[0].target, 'usuarios'); assert.equal(foreign[0].confdeltype, 'r');
    assert.match(foreign[0].definition, /FOREIGN KEY \(actor_user_id\) REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
    const foreignBindings = await rows(`SELECT t.tgrelid::regclass::text AS table_name,p.proname
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_constraint c ON c.oid=t.tgconstraint
      WHERE c.conrelid='public.task_comment_create_receipts'::regclass AND c.contype='f' AND t.tgisinternal
        AND t.tgenabled IN ('O','A') ORDER BY table_name,p.proname`);
    assert.deepEqual(foreignBindings, [
      { table_name:relation,proname:'RI_FKey_check_ins' },
      { table_name:relation,proname:'RI_FKey_check_upd' },
      { table_name:'usuarios',proname:'RI_FKey_noaction_upd' },
      { table_name:'usuarios',proname:'RI_FKey_restrict_del' },
    ]);
    const indexes = await rows("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [relation]);
    assert.equal(indexes.length, 2);
    assert.match(indexes.find(i => i.indexname === 'task_comment_create_receipts_comment_idx').indexdef, /USING btree \(comment_id\)/);
    const bindings = await rows(`SELECT t.tgname,t.tgtype,t.tgenabled,p.proname,n.nspname FROM pg_trigger t
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid='public.task_comment_create_receipts'::regclass AND NOT t.tgisinternal`);
    assert.deepEqual(bindings, [{ tgname:'task_comment_create_receipt_immutable',tgtype:27,tgenabled:'O',proname:'task_comment_create_receipt_immutable',nspname:'public' }]);

    await migrateExpected([]);
    assert.deepEqual(await ledger(), ledgerAfter);
    assert.deepEqual(await ledgerSequenceState(), ledgerSequenceAfter, 'No sequence consumption on real migrator rerun');
    assert.deepEqual(await dataSnapshot(), before); assert.deepEqual(await schemaSnapshot(), schemaBefore);
    assert.deepEqual(await sequences(), sequencesBefore);
    assert.deepEqual(appliedLogs, [`Migration applied: ${migration}`], 'Real migrator rerun applies nothing');

    const requestId = randomUUID(), input = { taskId:task.id,workspace:'historical',requestId,
      payload:{ autor:'QA211 current admin',contenido:'QA211 post-upgrade confirmed' } };
    const created = await createTaskComment(pool, actor, input);
    assert.equal(created.replayed, false); assert.equal(created.requestId, requestId);
    assert.equal(created.comment.tarea_id, task.id); assert.equal(created.comment.contenido, input.payload.contenido);
    const recovered = await findTaskCommentCreation(pool, actor, input);
    assert.deepEqual(recovered, { ...created.comment,creation_request_id:requestId });
    const replay = await createTaskComment(pool, actor, input);
    assert.deepEqual(replay, { ...created,replayed:true });
    assert.equal((await rows('SELECT id FROM tarea_comentarios')).length, 3);
    const receipts = await rows('SELECT actor_user_id,request_id,tarea_id,comment_id,workspace,payload_hash FROM task_comment_create_receipts');
    assert.equal(receipts.length, 1);
    const [receipt] = receipts;
    assert.deepEqual({ ...receipt,payload_hash:undefined }, { actor_user_id:actor.id,request_id:requestId,tarea_id:task.id,
      comment_id:created.comment.id,workspace:'historical',payload_hash:undefined });
    assert.match(receipt.payload_hash, /^[0-9a-f]{64}$/);
    await assert.rejects(rows('UPDATE task_comment_create_receipts SET workspace=workspace'), /Task comment creation receipts are immutable/);
    await assert.rejects(rows('DELETE FROM task_comment_create_receipts'), /Task comment creation receipts are immutable/);
    await assert.rejects(rows(`INSERT INTO task_comment_create_receipts SELECT * FROM task_comment_create_receipts`), /duplicate key/);
    // Enforce the real SQL constraints, not merely their names in the catalog.
    const insertReceipt = values => rows(`INSERT INTO task_comment_create_receipts
      (actor_user_id,request_id,payload_hash,tarea_id,comment_id,workspace) VALUES($1,$2,$3,$4,$5,$6)`, values);
    const validValues = () => [actor.id,randomUUID(),'a'.repeat(64),task.id,created.comment.id,'historical'];
    assert.deepEqual(await rows('SELECT id FROM usuarios WHERE id=2147483647'), []);
    const absentActor = validValues(); absentActor[0] = 2147483647;
    await assert.rejects(insertReceipt(absentActor), error => error.code === '23503');
    for (const [index,value] of [[0,0],[2,'not-a-sha256'],[3,0],[4,0],[5,'unknown-workspace']]) {
      const values = validValues(); values[index] = value;
      await assert.rejects(insertReceipt(values), error => error.code === '23514');
    }
    assert.deepEqual(await rows('SELECT actor_user_id,request_id,tarea_id,comment_id,workspace,payload_hash FROM task_comment_create_receipts'), receipts);
    assert.deepEqual(await ledger(), ledgerAfter);
    assert.deepEqual(await rows('SELECT to_jsonb(t) AS row FROM tarea_comentarios t WHERE id<>$1 ORDER BY id', [created.comment.id]), oldComments);
    const afterService = await dataSnapshot();
    delete afterService.tarea_comentarios;
    const { tarea_comentarios: ignored, ...unrelatedBefore } = before; void ignored;
    assert.deepEqual(afterService, unrelatedBefore, 'Actual service changes only comments and the new receipt table');
  } finally {
    try { if (pool) await pool.end(); }
    finally {
      await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic(`QA211 cleanup ENOENT: ${f.root}; tableCount=${tableCount ?? 'not-snapshotted'}`);
    }
  }
});
