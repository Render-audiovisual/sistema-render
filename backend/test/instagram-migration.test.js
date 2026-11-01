import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { inspectInstagramMigration, executeInstagramMigration, INSTAGRAM_MIGRATIONS } from '../src/instagram-migration.js';

const files = readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort();
const igNames = INSTAGRAM_MIGRATIONS.map(m => m.name);
const oldLedger = files.filter(n => !igNames.includes(n)).map((nombre, i) => ({ id: i + 1, nombre, aplicada_at: new Date(0) }));
const H = 'a'.repeat(64);
function harness(fault = {}) {
  const calls = [], releases = []; let created = 0, added = [], baseline, consumed = 0;
  const tables = () => ['_migrations', 'tareas', ...(created === 2 ? ['instagram_cuenta_seguidores','instagram_cuentas','instagram_media','instagram_media_metricas','instagram_reportes'] : [])]
    .sort().map(name => ({ name, oid: String(name === '_migrations' ? 1 : name === 'tareas' ? 2 : 10 + name.length), filtered: fault.filtered ?? false }));
  const db = { release(value) { releases.push(value); if (fault.release) throw new Error('PRIVATE DRIVER'); }, async query(sql, params = []) {
    calls.push(sql);
    if (sql.startsWith('BEGIN')) { baseline = { created, added: added.slice() }; return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      if (fault.rollback) throw new Error('PRIVATE DRIVER');
      ({ created, added } = baseline); return { rows: [] };
    }
    if (sql === 'COMMIT') { if (fault.commit && created === 2) throw new Error('PRIVATE DRIVER'); return { rows: [] }; }
    if (sql.startsWith('SET ') || sql.startsWith('LOCK TABLE') || sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('current_database() AS database')) return { rows: [{ database: 'synthetic', username: 'fixture', address: fault.remote ? '203.0.113.1' : '127.0.0.1', port: 55999 }] };
    if (sql.startsWith("SELECT to_regclass('public._migrations')")) return { rows: [{ ledger: '_migrations' }] };
    if (sql.startsWith('SELECT id,nombre,aplicada_at FROM public._migrations')) return { rows: [...oldLedger,
      ...added.map((nombre, i) => ({ id: 1000 + i, nombre, aplicada_at: new Date(0) }))] };
    if (sql.includes('row_security_active')) return { rows: tables() };
    if (sql.includes('tablename AS name FROM pg_tables')) return { rows: tables() };
    if (sql.includes('jsonb_build_array(to_jsonb(r),r.xmin')) return { rows: [{ rows: '1', hash: created === 2 && fault.data ? 'b'.repeat(64) : H }] };
    if (sql.includes("jsonb_build_object('owner'")) return { rows: [{ value: { original: params[0] } }] };
    if (sql.includes('routine_identity') && sql.includes('UNION ALL')) return { rows: tables().map(t => ({ oid: t.oid,
      schema_name: 'public', object_name: t.name, kind: 'r', routine_identity: null })) };
    if (sql.includes('SELECT rolname FROM pg_catalog.pg_roles')) return { rows: [] };
    if (sql.startsWith('ALTER TABLE ONLY') || sql.startsWith('REVOKE ')) return { rows: [] };
    if (sql.includes('CREATE TABLE instagram_cuentas')) { created++; return { rows: [] }; }
    if (sql.includes('CREATE TABLE instagram_reportes')) { if (fault.sql) throw new Error('PRIVATE SQL'); created++; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO public._migrations')) { added.push(params[0]); return { rows: [] }; }
    throw new Error('Unrecognized synthetic query');
  } };
  return { calls, releases, pool: { async connect() { return db; } }, get created() { return created; },
    get consumed() { return consumed; }, options: { environment: 'test', now: () => 1000,
      consumeApproval: async () => { consumed++; return !fault.approval; } } };
}
const approval = plan => ({ plan, expiresAt: 2000, backupSha256: H, restorationEvidenceSha256: H,
  maintenance: { writesPaused: true, jobsPaused: true, exclusiveSchema: true } });

test('Instagram is a closed two-file scope with read-only planning and fenced atomic execution', async () => {
  const h = harness(), plan = await inspectInstagramMigration(h.pool, { environment: 'test' });
  assert.deepEqual(plan.sql, INSTAGRAM_MIGRATIONS);
  assert.ok(h.calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  h.calls.length = 0;
  const result = await executeInstagramMigration(h.pool, approval(plan), h.options);
  assert.equal(result.state, 'COMMITTED'); assert.equal(result.existingDataUnchanged, true);
  assert.equal(h.created, 2); assert.equal(h.consumed, 1);
  assert.ok(h.calls.indexOf('BEGIN ISOLATION LEVEL READ COMMITTED') < h.calls.findIndex(s => s.startsWith('LOCK TABLE')));
  assert.equal(h.calls.filter(s => s === 'COMMIT').length, 1);
  assert.ok(h.calls.some(s => s.includes('ENABLE ROW LEVEL SECURITY')));
});
for (const [fault, code] of [['sql','INSTAGRAM_EXECUTION_FAILED'], ['data','INSTAGRAM_EXISTING_DATA_CHANGED'], ['approval','INSTAGRAM_APPROVAL_REJECTED']]) {
  test(`atomic rejection and rollback: ${fault}`, async () => {
    const h = harness({ [fault]: true }), plan = await inspectInstagramMigration(h.pool, { environment: 'test' });
    h.calls.length = 0;
    await assert.rejects(executeInstagramMigration(h.pool, approval(plan), h.options), { code });
    assert.ok(h.calls.includes('ROLLBACK')); assert.equal(h.calls.includes('COMMIT'), false); assert.equal(h.created, 0);
  });
}
test('uncertain commit destroys the connection and never claims rollback or retries', async () => {
  const h = harness({ commit: true }), plan = await inspectInstagramMigration(h.pool, { environment: 'test' }); h.calls.length = 0;
  await assert.rejects(executeInstagramMigration(h.pool, approval(plan), h.options), { code: 'INSTAGRAM_COMMIT_UNCERTAIN' });
  assert.equal(h.releases.at(-1), true); assert.equal(h.calls.includes('ROLLBACK'), false); assert.equal(h.consumed, 1);
});
test('rollback uncertainty destroys connection and strips driver errors', async () => {
  const h = harness({ sql: true, rollback: true }), plan = await inspectInstagramMigration(h.pool, { environment: 'test' });
  await assert.rejects(executeInstagramMigration(h.pool, approval(plan), h.options), { code: 'INSTAGRAM_ROLLBACK_UNCERTAIN' });
  assert.equal(h.releases.at(-1), true);
});
test('release failure cannot turn confirmed commit into a false failure', async () => {
  const h = harness({ release: true });
  // A lease with a failing release is injected only for the executor.
  const source = harness(), plan = await inspectInstagramMigration(source.pool, { environment: 'test' });
  assert.equal((await executeInstagramMigration(h.pool, approval(plan), h.options)).state, 'COMMITTED');
});
test('wrong plan, filtered snapshots, remote local target and expired/invalid clocks fail closed', async () => {
  const h = harness(), plan = await inspectInstagramMigration(h.pool, { environment: 'test' });
  await assert.rejects(executeInstagramMigration(h.pool, approval({ ...plan, prestateSha256: 'b'.repeat(64) }), h.options), { code: 'INSTAGRAM_PLAN_CHANGED' });
  assert.equal(h.consumed, 0);
  for (const now of [() => 3000, () => NaN])
    await assert.rejects(executeInstagramMigration(h.pool, approval(plan), { ...h.options, now }), /actualización/);
  await assert.rejects(inspectInstagramMigration(harness({ filtered: true }).pool, { environment: 'test' }), { code: 'INSTAGRAM_FILTERED_SNAPSHOT' });
  await assert.rejects(inspectInstagramMigration(harness({ remote: true }).pool, { environment: 'test' }), { code: 'INSTAGRAM_TARGET_INVALID' });
});
