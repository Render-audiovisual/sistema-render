import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { assertEditingProgressSchema, projectEditingProgressTask, recordEditingProgressDelivery } from '../src/editing-progress-ledger.js';

const MIGRATION = '20261027144706_editing_progress_unified_ledger.sql';
// Synthetic 051-equivalent schema + trigger ONLY. No remote financial DELETE,
// payroll import, inferred delivery backfill or replay of deployed migrations.
const OLD_DDL = `CREATE TABLE progreso_edicion_entregas (
  id BIGSERIAL PRIMARY KEY,tarea_id BIGINT NOT NULL UNIQUE,editor_clave TEXT NOT NULL,
  titulo_snapshot TEXT NOT NULL,cliente_id INTEGER,estado_actual TEXT NOT NULL CHECK (estado_actual IN ('en_revision','publicada')),
  entregada_at TIMESTAMPTZ NOT NULL,activa BOOLEAN NOT NULL DEFAULT TRUE,baja_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_progreso_edicion_editor_fecha ON progreso_edicion_entregas(editor_clave,entregada_at DESC) WHERE activa IS TRUE;
CREATE FUNCTION registrar_progreso_edicion_tarea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  editor TEXT;
  cuenta_como_entrega BOOLEAN;
  fecha_entrega TIMESTAMPTZ;
BEGIN
  editor := lower(trim(COALESCE(NEW.propiedades_extra->>'edicion_responsable', NEW.asignado_a, '')));
  cuenta_como_entrega :=
    NEW.propiedades_extra->>'workspace' = 'render_os'
    AND NEW.tipo_tarea = 'edicion'
    AND editor IN ('luciano', 'milton', 'milton luciano')
    AND NEW.estado IN ('en_revision', 'publicada');

  IF cuenta_como_entrega THEN
    fecha_entrega := CASE
      WHEN NEW.propiedades_extra->>'finalizada_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        THEN (NEW.propiedades_extra->>'finalizada_at')::timestamptz
      ELSE COALESCE(NEW.updated_at, NOW())
    END;

    INSERT INTO progreso_edicion_entregas
      (tarea_id, editor_clave, titulo_snapshot, cliente_id, estado_actual, entregada_at, activa, baja_at)
    VALUES
      (NEW.id, 'luciano', NEW.titulo, NEW.cliente_id, NEW.estado, fecha_entrega, TRUE, NULL)
    ON CONFLICT (tarea_id) DO UPDATE SET
      editor_clave = EXCLUDED.editor_clave,
      titulo_snapshot = EXCLUDED.titulo_snapshot,
      cliente_id = EXCLUDED.cliente_id,
      estado_actual = EXCLUDED.estado_actual,
      entregada_at = CASE
        WHEN progreso_edicion_entregas.activa IS FALSE THEN EXCLUDED.entregada_at
        ELSE progreso_edicion_entregas.entregada_at
      END,
      activa = TRUE,
      baja_at = NULL,
      updated_at = NOW();
  ELSE
    UPDATE progreso_edicion_entregas SET
      activa = FALSE,
      baja_at = COALESCE(baja_at, NOW()),
      updated_at = NOW()
    WHERE tarea_id = NEW.id AND activa IS TRUE;
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER progreso_edicion_tarea_cambio AFTER INSERT OR UPDATE OF estado,asignado_a,tipo_tarea,propiedades_extra
  ON tareas FOR EACH ROW EXECUTE FUNCTION registrar_progreso_edicion_tarea();`;
const LEGACY_FIELDS = ['id','tarea_id','editor_clave','titulo_snapshot','cliente_id','estado_actual','entregada_at','activa','baja_at','created_at','updated_at'];

test('actual unified-ledger SQL preserves populated historical bytes/ACL and fails atomically on malformed old schema', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  // Official filename supplied by Main. Missing SQL is a real pending dependency,
  // not a substitute migration or a successful skipped upgrade.
  const sql = await readFile(new URL(`../migrations/${MIGRATION}`, import.meta.url), 'utf8');
  const port = 55992, f = await startLocalHarness({ port, clusterOnly: true, deferEditingProgressMigration: true });
  let db;
  t.after(async () => {
    try { await db?.query('ROLLBACK').catch(() => {}); await db?.end(); }
    finally { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
      t.diagnostic('Owned editing-progress upgrade PG55992 removed ENOENT; synthetic history only, no production/provider.'); }
  });
  db = new pg.Client({ host: '127.0.0.1', port, user: 'render2_fixture', database: 'render2_local_test', password: '',
    ssl: false, statement_timeout: 20000, lock_timeout: 12000, connectionTimeoutMillis: 5000 });
  await db.connect();
  assertFixtureIdentity({ root: f.root, cwd: f.root, port, url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,
    identity: (await db.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`)).rows[0] });
  const ledgerBefore = (await db.query('SELECT nombre FROM _migrations ORDER BY nombre')).rows;
  assert.ok(ledgerBefore.some(r => r.nombre === '093_personal_list_block_create_receipts.sql'));
  assert.ok(!ledgerBefore.some(r => r.nombre === MIGRATION), 'Harness must defer ONLY the official unified-ledger migration');
  assert.equal((await db.query("SELECT to_regclass('public.progreso_edicion_entregas')::text relation")).rows[0].relation, null);

  await t.test('official fresh-install branch validates its own catalog without a historical ledger', async () => {
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await assertEditingProgressSchema(db);
      assert.equal((await db.query('SELECT count(*)::int n FROM progreso_edicion_entregas')).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='tareas'::regclass AND tgname='editing_progress_v1_task_projection' AND NOT tgisinternal")).rows[0].n, 1);
    } finally { await db.query('ROLLBACK'); }
    assert.equal((await db.query("SELECT to_regclass('public.progreso_edicion_entregas')::text relation")).rows[0].relation, null);
  });

  const clientId = (await db.query("INSERT INTO clientes(nombre) VALUES('QA upgrade ledger') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'video','pendiente','2026-11-03')", [clientId]);
  const task = async title => (await db.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
    VALUES($1,'luciano',$2,'edicion','en_revision','{"workspace":"render_os"}') RETURNING id,revision`, [title, clientId])).rows[0];
  // Seed tasks BEFORE installing the old trigger, then seed explicit history:
  // no guessed completion date, identity, payroll amount or delivery reference.
  const historical = await task('QA retained historical task'), uncredited = await task('QA uncredited state-only task');
  await db.query(OLD_DDL);
  assert.equal((await db.query("SELECT md5(prosrc) hash FROM pg_proc WHERE oid='registrar_progreso_edicion_tarea()'::regprocedure")).rows[0].hash,
    '694a50d5911f0688cd82bf43ad8fd922', 'Exact known 051 body; no remote backfill/financial DML');
  await db.query(`INSERT INTO progreso_edicion_entregas(id,tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,activa,baja_at,created_at,updated_at)
    VALUES(101,$1,'luciano','Exact old snapshot',$2,'en_revision','2026-09-30T23:59:59.123456-03',true,NULL,'2026-10-01T12:00:00.123456Z','2026-10-02T12:00:00.654321Z'),
      (102,2147483000,'luciano','Purged task historical credit',NULL,'publicada','2026-08-17T12:00:00.123456Z',true,NULL,'2026-08-17T12:00:01Z','2026-08-17T12:00:02Z'),
      (103,2147483001,'other historical key','Inactive exact history',NULL,'en_revision','2026-07-01T00:00:00Z',false,'2026-07-02T00:00:00Z','2026-07-01T00:00:00Z','2026-07-02T00:00:00Z')`, [historical.id, clientId]);
  await db.query('CREATE ROLE qa_editing_upgrade_reader_55992 NOLOGIN');
  await db.query('GRANT SELECT ON progreso_edicion_entregas TO qa_editing_upgrade_reader_55992');
  await db.query('GRANT USAGE,SELECT ON SEQUENCE progreso_edicion_entregas_id_seq TO qa_editing_upgrade_reader_55992');
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'progreso_edicion_entregas' ORDER BY tablename")).rows.map(r => r.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      result[table] = (await db.query(`SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`)).rows[0].hash;
    }
    return result;
  };
  const oldRows = () => db.query(`SELECT jsonb_build_array(${LEGACY_FIELDS.map(k => `to_jsonb(r)->'${k}'`).join(',')})::text bytes,
    xmin::text xmin,ctid::text ctid FROM progreso_edicion_entregas r ORDER BY id`).then(r => r.rows);
  const acl = () => db.query(`SELECT relname,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE oid IN ('public.progreso_edicion_entregas'::regclass,'public.progreso_edicion_entregas_id_seq'::regclass) ORDER BY relname`).then(r => r.rows);
  const before = await snapshot(), historyBefore = await oldRows(), aclBefore = await acl();

  await t.test('malformed old schema rejects installation and rollback preserves original rows, schema, trigger and ACL', async () => {
    await db.query('BEGIN');
    try {
      await db.query('ALTER TABLE progreso_edicion_entregas ALTER COLUMN tarea_id TYPE text USING tarea_id::text');
      const malformedColumns = (await db.query(`SELECT attname,format_type(atttypid,atttypmod) type FROM pg_attribute
        WHERE attrelid='progreso_edicion_entregas'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows;
      const malformedRows = await oldRows();
      await db.query('SAVEPOINT malformed_install');
      await assert.rejects(db.query(sql), 'Migration must reject incompatible old column types');
      await db.query('ROLLBACK TO SAVEPOINT malformed_install');
      assert.deepEqual((await db.query(`SELECT attname,format_type(atttypid,atttypmod) type FROM pg_attribute
        WHERE attrelid='progreso_edicion_entregas'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows, malformedColumns);
      assert.deepEqual(await oldRows(), malformedRows); assert.deepEqual(await acl(), aclBefore);
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='tareas'::regclass AND tgname='progreso_edicion_tarea_cambio' AND NOT tgisinternal")).rows[0].n, 1);
    } finally { await db.query('ROLLBACK'); }
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await oldRows(), historyBefore);
  });

  await t.test('official SQL preserves every existing row physically, all old ledger fields and ACL', async () => {
    await db.query('BEGIN');
    try { await db.query(sql); await assertEditingProgressSchema(db); await db.query('COMMIT'); }
    catch (e) { await db.query('ROLLBACK'); throw e; }
    assert.deepEqual(await snapshot(), before, 'Includes tasks, assignments, users, publications, payroll and migration history');
    assert.deepEqual(await oldRows(), historyBefore, 'Preserve microsecond dates, original IDs, xmin and ctid; no reattribution');
    assert.deepEqual(await acl(), aclBefore);
    assert.ok((await db.query('SELECT editor_user_id,origen_registro,delivery_id,task_revision FROM progreso_edicion_entregas')).rows
      .every(r => r.editor_user_id === null && r.origen_registro === null && r.delivery_id === null && r.task_revision === null));
  });

  const financeTables = tables.filter(name => /financ|sueldo|compens|contrat|abono|pago|payment|entregas_edicion/.test(name));
  const financeBefore = Object.fromEntries(financeTables.map(name => [name, before[name]]));
  await t.test('state projection updates existing historical credit without changing origin/date or inserting state-only work', async () => {
    await db.query('BEGIN');
    try {
      const updated = (await db.query("UPDATE tareas SET estado='aprobada',updated_at=clock_timestamp() WHERE id=$1 RETURNING revision", [historical.id])).rows[0];
      await projectEditingProgressTask(db, { taskId: historical.id, expectedTaskRevision: updated.revision });
      const row = (await db.query('SELECT * FROM progreso_edicion_entregas WHERE tarea_id=$1', [historical.id])).rows[0];
      assert.equal(row.estado_actual, 'aprobada'); assert.equal(row.activa, true); assert.equal(row.origen_registro, null); assert.equal(row.editor_user_id, null);
      assert.equal(row.delivery_id, null); assert.equal(row.task_revision, null);
      assert.equal((await db.query("SELECT entregada_at='2026-09-30T23:59:59.123456-03'::timestamptz exact FROM progreso_edicion_entregas WHERE tarea_id=$1", [historical.id])).rows[0].exact, true);
      const next = (await db.query("UPDATE tareas SET estado='aprobada' WHERE id=$1 RETURNING revision", [uncredited.id])).rows[0];
      await projectEditingProgressTask(db, { taskId: uncredited.id, expectedTaskRevision: next.revision });
      assert.equal((await db.query('SELECT count(*)::int n FROM progreso_edicion_entregas WHERE tarea_id=$1', [uncredited.id])).rows[0].n, 0);
      const created = await task('QA no state-inferred credit after upgrade');
      assert.equal((await db.query('SELECT count(*)::int n FROM progreso_edicion_entregas WHERE tarea_id=$1', [created.id])).rows[0].n, 0);
    } finally { await db.query('ROLLBACK'); }
  });

  await t.test('explicit canonical delivery records by ID, projects states and never merges historical attribution', async () => {
    await db.query('BEGIN');
    try {
      const fresh = await task('QA explicit canonical credit');
      await db.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [fresh.id]);
      const delivery = randomUUID();
      await db.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
        VALUES($1,$2,91001,$3,$4,$5,'https://example.invalid/upgrade-delivery','')`, [delivery, fresh.id, randomUUID(), 'a'.repeat(64), fresh.revision]);
      await recordEditingProgressDelivery(db, { taskId: fresh.id, deliveryId: delivery, expectedTaskRevision: fresh.revision });
      const row = (await db.query('SELECT * FROM progreso_edicion_entregas WHERE tarea_id=$1', [fresh.id])).rows[0];
      assert.equal(row.origen_registro, 'canonical_delivery'); assert.equal(row.editor_user_id, 91003); assert.equal(row.delivery_id, delivery);
      for (const state of ['aprobada','finalizada','en_revision']) {
        const current = (await db.query('UPDATE tareas SET estado=$2 WHERE id=$1 RETURNING revision', [fresh.id, state])).rows[0];
        await projectEditingProgressTask(db, { taskId: fresh.id, expectedTaskRevision: current.revision });
        const projected = (await db.query('SELECT * FROM progreso_edicion_entregas WHERE tarea_id=$1', [fresh.id])).rows[0];
        assert.equal(projected.estado_actual, state); assert.equal(projected.editor_user_id, 91003); assert.equal(projected.delivery_id, delivery);
        assert.equal(projected.entregada_at.toISOString(), row.entregada_at.toISOString());
      }
    } finally { await db.query('ROLLBACK'); }
  });
  await t.test('projection and delivery checks leave all finance/history/publications unchanged after rollback', async () => {
    const after = await snapshot(); assert.deepEqual(after, before);
    assert.deepEqual(Object.fromEntries(financeTables.map(name => [name, after[name]])), financeBefore);
    assert.deepEqual(await oldRows(), historyBefore); assert.deepEqual(await acl(), aclBefore);
    assert.deepEqual((await db.query('SELECT nombre FROM _migrations ORDER BY nombre')).rows, ledgerBefore,
      'This test applies exact SQL, never forges a migration receipt');
  });
});
