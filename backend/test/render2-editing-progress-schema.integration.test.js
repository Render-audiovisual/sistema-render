import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { EDITING_PROGRESS_SCHEMA, assertEditingProgressSchema } from '../src/editing-progress-ledger.js';

// Synthetic proposed-schema QA ONLY, on a fresh real 093 fixture. This is not
// a migration, restored-data upgrade, ledger integration or production proof.
// Intentionally independent DDL: do not normalize parentheses/casts or replace
// pg_get_constraintdef expectations when a proposed contract fails to deparse.
const CREATE_LEDGER = `CREATE TABLE public.progreso_edicion_entregas (
  id BIGSERIAL NOT NULL,
  tarea_id BIGINT NOT NULL,
  editor_clave TEXT NOT NULL,
  titulo_snapshot TEXT NOT NULL,
  cliente_id INTEGER,
  estado_actual TEXT NOT NULL,
  entregada_at TIMESTAMPTZ NOT NULL,
  activa BOOLEAN NOT NULL,
  baja_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  editor_user_id INTEGER,
  origen_registro TEXT,
  delivery_id UUID,
  task_revision INTEGER,
  CONSTRAINT editing_progress_v1_source CHECK (origen_registro IS NULL OR origen_registro = 'canonical_delivery'),
  CONSTRAINT editing_progress_v1_identity CHECK (CASE WHEN origen_registro IS NULL
    THEN editor_user_id IS NULL AND ((delivery_id IS NULL AND task_revision IS NULL)
      OR (delivery_id IS NOT NULL AND task_revision IS NOT NULL AND task_revision > 0))
    ELSE editor_user_id IS NOT NULL AND editor_user_id > 0 AND delivery_id IS NOT NULL
      AND task_revision IS NOT NULL AND task_revision > 0 END),
  CONSTRAINT editing_progress_v1_state CHECK (estado_actual IN ('pendiente','en_progreso','en_revision','aprobada','finalizada','publicada')),
  CONSTRAINT editing_progress_v1_task_unique UNIQUE (tarea_id),
  CONSTRAINT editing_progress_v1_editor_fk FOREIGN KEY (editor_user_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT editing_progress_v1_delivery_fk FOREIGN KEY (tarea_id,delivery_id)
    REFERENCES task_editing_deliveries(task_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT
)`;
const compact = text => text.replace(/\s+/g, '');

test('proposed editing-progress schema deparses strictly and enforces identity/delivery pairs on real PG', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55990, f = await startLocalHarness({ port, clusterOnly: true });
  let db;
  t.after(async () => {
    try { await db?.query('ROLLBACK').catch(() => {}); await db?.end(); }
    finally {
      await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
      t.diagnostic('Owned proposed-schema PG55990 removed ENOENT; no migration, upgrade, provider or production access.');
    }
  });
  db = new pg.Client({ host: '127.0.0.1', port, user: 'render2_fixture', database: 'render2_local_test',
    password: '', ssl: false, statement_timeout: 15000, lock_timeout: 10000, connectionTimeoutMillis: 5000 });
  await db.connect();
  const identity = (await db.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
  assertFixtureIdentity({ root: f.root, cwd: f.root, port, url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const migrationBefore = (await db.query('SELECT nombre FROM _migrations ORDER BY nombre')).rows;
  assert.ok(migrationBefore.some(row => row.nombre === '093_personal_list_block_create_receipts.sql'));
  assert.equal((await db.query("SELECT to_regclass('public.progreso_edicion_entregas')::text relation")).rows[0].relation, null,
    'Fresh baseline must not silently include the proposed ledger');

  const [client] = (await db.query("INSERT INTO clientes(nombre) VALUES('QA proposed editing schema') RETURNING id")).rows;
  await db.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,metadata)
    VALUES($1,'video','pendiente','2026-11-03','{}')`, [client.id]);
  const publications = () => db.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p ORDER BY id').then(r => r.rows);
  const publicationBefore = await publications();
  const taskIds = [];
  for (let i = 0; i < 3; i++) taskIds.push((await db.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
    VALUES($1,'QA fixture editor',$2,'edicion','en_revision','{"workspace":"render_os"}') RETURNING id`, [`QA schema task ${i}`, client.id])).rows[0].id);
  const deliveryId = randomUUID();
  await db.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
    VALUES($1,$2,91001,$3,$4,1,'https://example.invalid/schema-delivery','')`, [deliveryId, taskIds[0], randomUUID(), 'a'.repeat(64)]);

  await t.test('missing proposed schema fails closed, not empty progress', async () => {
    await assert.rejects(assertEditingProgressSchema(db), { status: 503, code: 'editing_progress_schema_unavailable' });
  });
  // Establish the explicit parent pair contract; do not assume every supported
  // PostgreSQL version rejects a composite reference backed by a unique subset.
  await db.query('ALTER TABLE task_editing_deliveries ADD CONSTRAINT qa_editing_schema_delivery_pair UNIQUE (task_id,id)');
  await db.query(CREATE_LEDGER);

  await t.test('actual catalog columns and all six validated nondeferrable definitions match export exactly', async () => {
    const columns = (await db.query(`SELECT attname AS name,format_type(atttypid,atttypmod) AS type,attnotnull AS "notNull"
      FROM pg_attribute WHERE attrelid='public.progreso_edicion_entregas'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows;
    assert.deepEqual(Object.fromEntries(columns.map(c => [c.name, [c.type, c.notNull]])), EDITING_PROGRESS_SCHEMA.columns);
    const constraints = (await db.query(`SELECT conname AS name,pg_get_constraintdef(oid) AS definition,
      convalidated AS validated,condeferrable AS deferred FROM pg_constraint
      WHERE conrelid='public.progreso_edicion_entregas'::regclass ORDER BY conname`)).rows;
    assert.equal(constraints.length, 6);
    const mismatches = constraints.filter(row => compact(row.definition) !== compact(EDITING_PROGRESS_SCHEMA.constraints[row.name] ?? ''));
    if (mismatches.length) t.diagnostic(`STRICT_DEPARSE_MISMATCH ${JSON.stringify(mismatches)}`);
    assert.deepEqual(Object.fromEntries(constraints.map(c => [c.name, compact(c.definition)])),
      Object.fromEntries(Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => [name, compact(definition)])));
    assert.ok(constraints.every(c => c.validated === true && c.deferred === false));
    await assertEditingProgressSchema(db);
  });

  const insert = async (patch = {}) => {
    const row = { task: taskIds[0], editor: null, origin: null, delivery: null, revision: null, state: 'en_revision', ...patch };
    return db.query(`INSERT INTO progreso_edicion_entregas(tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,
      entregada_at,activa,editor_user_id,origen_registro,delivery_id,task_revision)
      VALUES($1,'luciano','QA proposed ledger',$2,$3,'2026-11-03T12:00:00Z',true,$4,$5,$6,$7) RETURNING *`,
    [row.task, client.id, row.state, row.editor, row.origin, row.delivery, row.revision]);
  };
  const isolated = async work => {
    await db.query('BEGIN');
    try { await work(); } finally { await db.query('ROLLBACK'); }
  };
  const rejected = (patch, constraint, code = '23514') => isolated(async () => {
    await assert.rejects(insert(patch), { code, constraint });
  });

  await t.test('nullable historical provenance permits no pair or an exact positive delivery/revision pair', async () => {
    await isolated(async () => {
      const historical = (await insert()).rows[0];
      assert.equal(historical.editor_user_id, null); assert.equal(historical.origen_registro, null);
      assert.equal(historical.delivery_id, null); assert.equal(historical.task_revision, null);
      // Historical rows survive without a task FK; do not invent ownership.
      const orphan = (await insert({ task: 2147483000 })).rows[0]; assert.equal(orphan.editor_user_id, null);
    });
    await isolated(async () => {
      const historicalPair = (await insert({ delivery: deliveryId, revision: 1 })).rows[0];
      assert.equal(historicalPair.origen_registro, null); assert.equal(historicalPair.editor_user_id, null);
    });
  });
  await t.test('null-pair and canonical identity checks reject missing halves, bad revisions and missing editor', async () => {
    for (const patch of [{ delivery: deliveryId }, { revision: 1 }, { delivery: deliveryId, revision: 0 },
      { editor: 91001 }, { origin: 'canonical_delivery' }, { origin: 'canonical_delivery', editor: 91001 },
      { origin: 'canonical_delivery', delivery: deliveryId, revision: 1 },
      { origin: 'canonical_delivery', editor: 0, delivery: deliveryId, revision: 1 }]) await rejected(patch, 'editing_progress_v1_identity');
  });
  await t.test('unknown sources, illegal states and duplicate task credits fail their exact constraints', async () => {
    await rejected({ origin: 'unknown', editor: 91001, delivery: deliveryId, revision: 1 }, 'editing_progress_v1_source');
    await rejected({ state: 'lista' }, 'editing_progress_v1_state');
    await isolated(async () => { await insert(); await assert.rejects(insert(), { code: '23505', constraint: 'editing_progress_v1_task_unique' }); });
  });
  await t.test('canonical delivery pair must reference that exact task, not merely an existing delivery UUID', async () => {
    await rejected({ task: taskIds[1], origin: 'canonical_delivery', editor: 91001, delivery: deliveryId, revision: 1 }, 'editing_progress_v1_delivery_fk', '23503');
    await rejected({ task: taskIds[1], delivery: deliveryId, revision: 1 }, 'editing_progress_v1_delivery_fk', '23503');
    await rejected({ origin: 'canonical_delivery', editor: 2147483000, delivery: deliveryId, revision: 1 }, 'editing_progress_v1_editor_fk', '23503');
    await isolated(async () => {
      const canonical = (await insert({ origin: 'canonical_delivery', editor: 91001, delivery: deliveryId, revision: 1 })).rows[0];
      assert.equal(canonical.editor_user_id, 91001); assert.equal(canonical.delivery_id, deliveryId);
      await assertEditingProgressSchema(db);
    });
  });
  await t.test('schema guard rejects permissive/NOT VALID/deferrable/missing constraints and wrong column nullability', async () => {
    for (const change of [
      'ALTER TABLE progreso_edicion_entregas DROP CONSTRAINT editing_progress_v1_identity',
      'ALTER TABLE progreso_edicion_entregas ALTER COLUMN origen_registro SET NOT NULL',
      'ALTER TABLE progreso_edicion_entregas ALTER COLUMN task_revision TYPE bigint',
      `ALTER TABLE progreso_edicion_entregas DROP CONSTRAINT editing_progress_v1_source;
       ALTER TABLE progreso_edicion_entregas ADD CONSTRAINT editing_progress_v1_source CHECK (true)`,
      `ALTER TABLE progreso_edicion_entregas DROP CONSTRAINT editing_progress_v1_source;
       ALTER TABLE progreso_edicion_entregas ADD CONSTRAINT editing_progress_v1_source CHECK (origen_registro IS NULL OR origen_registro='canonical_delivery') NOT VALID`,
      `ALTER TABLE progreso_edicion_entregas DROP CONSTRAINT editing_progress_v1_delivery_fk;
       ALTER TABLE progreso_edicion_entregas ADD CONSTRAINT editing_progress_v1_delivery_fk FOREIGN KEY(tarea_id,delivery_id)
         REFERENCES task_editing_deliveries(task_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE`,
    ]) await isolated(async () => {
      await db.query(change);
      await assert.rejects(assertEditingProgressSchema(db), { status: 503, code: 'editing_progress_schema_unavailable' });
    });
  });
  await t.test('all synthetic schema checks preserve publication bytes/xmin/ctid and real migration ledger', async () => {
    assert.deepEqual(await publications(), publicationBefore);
    assert.deepEqual((await db.query('SELECT nombre FROM _migrations ORDER BY nombre')).rows, migrationBefore);
    assert.equal((await db.query('SELECT count(*)::int n FROM progreso_edicion_entregas')).rows[0].n, 0);
  });
});
