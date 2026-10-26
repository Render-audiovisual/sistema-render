import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readApplicationObjectInventory, protectNewApplicationObjects,
  securityPolicyFingerprint } from '../src/application-object-security.js';

const object = (oid, object_name, kind = 'r', routine_identity = null) => ({
  oid: String(oid), schema_name: 'public', object_name, kind, routine_identity,
});
function mock(snapshots, roles = ['anon', 'authenticated']) {
  const queries = [];
  let index = 0;
  return { queries, async query(sql) {
    queries.push(sql);
    if (sql.includes('FROM pg_catalog.pg_class c')) return { rows: snapshots[index++] };
    if (sql.includes('FROM pg_catalog.pg_roles')) return { rows: roles.map(rolname => ({ rolname })) };
    return { rows: [] };
  } };
}
const writes = db => db.queries.filter(sql => /^(ALTER|REVOKE)/.test(sql));

test('inventory reads only closed public catalog targets, excluding extension membership in both catalogs', async () => {
  const rows = [object(1, 'old'), object(2, 'partitioned', 'p'), object(3, 'seq', 'S'),
    object(4, 'fn', 'f', 'public.fn(integer)'), object(5, 'proc', 'p', 'public.proc()')];
  const db = mock([rows]);
  const result = await readApplicationObjectInventory(db);
  assert.deepEqual(result.tables.map(r => r.oid), ['1', '2']);
  assert.deepEqual(result.sequences.map(r => r.oid), ['3']);
  assert.deepEqual(result.routines.map(r => r.oid), ['4', '5']);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.tables) && Object.isFrozen(result.tables[0]));
  const sql = db.queries[0];
  assert.equal((sql.match(/n.nspname = 'public'/g) || []).length, 2);
  assert.match(sql, /c.relkind IN \('r', 'p', 'S'\)/);
  assert.match(sql, /p.prokind IN \('f', 'p'\)/);
  assert.equal((sql.match(/d.deptype = 'e'/g) || []).length, 2);
  assert.equal((sql.match(/pg_catalog.pg_extension/g) || []).length, 2);
  assert.match(sql, /d.classid = 'pg_catalog.pg_class'/);
  assert.match(sql, /d.classid = 'pg_catalog.pg_proc'/);
  assert.match(sql, /pg_catalog.format\('%I.%I\(%s\)'/);
  assert.match(sql, /pg_catalog.pg_get_function_identity_arguments\(p.oid\)/);
  assert.doesNotMatch(sql, /SELECT \*|prosrc|probin|relacl|FROM public\.|auth\.|storage\./i);
  assert.deepEqual(writes(db), []);
});

test('OID diff closes new tables, sequences and exact overloaded functions/procedures only', async () => {
  const old = [object(1, 'existing'), object(2, 'old_seq', 'S'), object(3, 'fn', 'f', 'public.fn()')];
  const fresh = [object(4, 'browser_sessions'), object(5, 'finance', 'p'), object(6, 'seq', 'S'),
    object(7, 'fn', 'f', 'public.fn(integer)'), object(8, 'proc', 'p', 'public.proc(IN x public.custom_type)')];
  const db = mock([old, [...old, ...fresh]]);
  const before = await readApplicationObjectInventory(db);
  const added = await protectNewApplicationObjects(db, before);
  assert.equal(added.tables.length, 2);
  assert.deepEqual(writes(db), [
    'ALTER TABLE ONLY "public"."browser_sessions" ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE "public"."browser_sessions" FROM PUBLIC, "anon", "authenticated"',
    'ALTER TABLE ONLY "public"."finance" ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE "public"."finance" FROM PUBLIC, "anon", "authenticated"',
    'REVOKE ALL ON SEQUENCE "public"."seq" FROM PUBLIC, "anon", "authenticated"',
    'REVOKE EXECUTE ON FUNCTION public.fn(integer) FROM PUBLIC, "anon", "authenticated"',
    'REVOKE EXECUTE ON PROCEDURE public.proc(IN x public.custom_type) FROM PUBLIC, "anon", "authenticated"',
  ]);
  assert.doesNotMatch(writes(db).join('\n'), /existing|old_seq|fn\(\)/);
});

test('drop/recreate same name with new OID is new; rename same OID and dropped objects are untouched', async () => {
  const db = mock([[object(1, 'same'), object(2, 'renamed'), object(3, 'dropped')],
    [object(4, 'same'), object(2, 'new_name')]]);
  await protectNewApplicationObjects(db, await readApplicationObjectInventory(db));
  assert.equal(writes(db).length, 2);
  assert.ok(writes(db).every(sql => sql.includes('"same"')));
});

for (const roles of [[], ['anon'], ['authenticated']]) {
  test(`missing roles are not referenced or created: ${roles.join(',') || 'none'}`, async () => {
    const db = mock([[], [object(1, 't')]], roles);
    await protectNewApplicationObjects(db, await readApplicationObjectInventory(db));
    assert.equal(writes(db)[1], `REVOKE ALL ON TABLE "public"."t" FROM PUBLIC${roles.map(r => `, "${r}"`).join('')}`);
    assert.ok(!db.queries.some(sql => /CREATE ROLE/i.test(sql)));
  });
}

test('catalog identifiers with quotes and SQL-looking names remain quoted single targets', async () => {
  const name = 'x"; DROP TABLE old; --';
  const db = mock([[], [object(1, name), object(2, name, 'S'),
    object(3, name, 'f', 'public."x""; DROP TABLE old; --"("arg" public."type with spaces")')]]);
  await protectNewApplicationObjects(db, await readApplicationObjectInventory(db));
  assert.equal(writes(db)[0], 'ALTER TABLE ONLY "public"."x""; DROP TABLE old; --" ENABLE ROW LEVEL SECURITY');
  assert.equal(writes(db)[2], 'REVOKE ALL ON SEQUENCE "public"."x""; DROP TABLE old; --" FROM PUBLIC, "anon", "authenticated"');
  assert.match(writes(db)[3], /ON FUNCTION public\."x""; DROP TABLE old; --"\("arg" public\."type with spaces"\)/);
});

test('empty/no-new inventories produce no writes, including extension-only catalog differences', async () => {
  // Extension objects are filtered in SQL, so never appear in these snapshots.
  const old = [object(1, 'old')];
  for (const rows of [[], old]) {
    const db = mock([rows, rows]);
    await protectNewApplicationObjects(db, await readApplicationObjectInventory(db));
    assert.deepEqual(writes(db), []);
  }
});

test('reject invalid snapshots and non-public catalog results before mutation', async () => {
  for (const row of [{ ...object(1, 't'), schema_name: 'auth' },
    { ...object(1, 't'), schema_name: 'storage' }, object(1, 'v', 'v'),
    object('1; DROP TABLE t', 't'), object(4294967296, 't'), object(1, 'bad\0name')]) {
    const db = mock([[], [row]]);
    await assert.rejects(protectNewApplicationObjects(db, await readApplicationObjectInventory(db)), /Invalid/);
    assert.deepEqual(writes(db), []);
  }
  const db = mock([]);
  await assert.rejects(protectNewApplicationObjects(db, null), /Missing before/);
  assert.deepEqual(db.queries, []);
});

test('no transaction control, policies, default privileges, schemas or application data operations', async () => {
  const db = mock([[], [object(1, 't'), object(2, 's', 'S'), object(3, 'f', 'f', 'public.f()')]]);
  await protectNewApplicationObjects(db, await readApplicationObjectInventory(db));
  for (const sql of db.queries) {
    assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|FORCE|POLICY|INSERT|UPDATE|DELETE|TRUNCATE|CREATE)\b/i);
    assert.doesNotMatch(sql, /ALTER DEFAULT|ON SCHEMA|ALL TABLES|ALL SEQUENCES|ALL FUNCTIONS|ALL PROCEDURES/i);
  }
});

test('DDL failure propagates without committing, rolling back, or continuing', async () => {
  const db = mock([[], [object(1, 't'), object(2, 's', 'S')]]);
  const before = await readApplicationObjectInventory(db);
  const query = db.query.bind(db);
  db.query = async sql => {
    if (sql.startsWith('ALTER TABLE')) throw new Error('denied');
    return query(sql);
  };
  await assert.rejects(protectNewApplicationObjects(db, before), /denied/);
  assert.deepEqual(writes(db), []);
});

test('fingerprint is SHA256 of actual policy file bytes and changes on content changes', () => {
  const bytes = readFileSync(new URL('../src/application-object-security.js', import.meta.url));
  assert.equal(securityPolicyFingerprint, createHash('sha256').update(bytes).digest('hex'));
  assert.match(securityPolicyFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(securityPolicyFingerprint, createHash('sha256').update(bytes).update('\n').digest('hex'));
});
