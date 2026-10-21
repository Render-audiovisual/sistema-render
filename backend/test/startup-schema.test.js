import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCHEMA_COLUMNS, assertCoreSchemaReady } from '../src/startup-schema.js';
const complete = () => Object.entries(CORE_SCHEMA_COLUMNS).flatMap(([table_name, columns]) =>
  Object.entries(columns).map(([column_name, data_type]) => ({ table_name, column_name, data_type })));
const response = (sql, rows) => ({ rows: sql.includes('current_schemas') ? [{ schemas: ['public'] }] : sql.includes('pg_trigger') ? [{ready:true}] : rows });

test('principal compatibility inspection uses a parameterized SELECT only', async () => {
  const calls = [];
  await assertCoreSchemaReady({ async query(sql, values) { calls.push({ sql, values }); return response(sql, complete()); } });
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /current_schemas\(false\)::text\[\]/);
  for (const call of calls) {
    assert.match(call.sql.trim(), /^SELECT /);
    assert.doesNotMatch(call.sql, /CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE/);
  }
  assert.deepEqual(calls[1].values, [Object.keys(CORE_SCHEMA_COLUMNS)]);
  assert.deepEqual(calls[2].values, ['feedback_notes_monotonic_version']);
});

test('missing or disabled monotonic note trigger rejects startup without installing or repairing it', async () => {
  for (const ready of [false,null,undefined,'true']) {
    await assert.rejects(assertCoreSchemaReady({query:async sql=>sql.includes('pg_trigger')?{rows:[{ready}]}:response(sql,complete())}),/note clock is not compatible/);
  }
  await assert.rejects(assertCoreSchemaReady({query:async sql=>{
    if(sql.includes('pg_trigger'))throw Error('private clock detail');return response(sql,complete());
  }}),error=>{assert.equal(error.message,'Cannot inspect principal note clock.');return true;});
});

test('missing principal table/column or incompatible data type rejects without repair', async () => {
  for (const rows of [[], complete().filter(row => row.column_name !== 'revision'),
    complete().map(row => row.table_name === 'usuarios' && row.column_name === 'session_version' ? { ...row, data_type: 'text' } : row)]) {
    await assert.rejects(assertCoreSchemaReady({ query: async sql => response(sql, rows) }), /not compatible/);
  }
});

test('inspection failures never return driver details or treat failures as ready', async () => {
  await assert.rejects(assertCoreSchemaReady({ query: async () => { throw new Error('private-connection-detail'); } }), error => {
    assert.doesNotMatch(error.message, /private-connection-detail/); return true;
  });
  await assert.rejects(assertCoreSchemaReady({ query: async sql => response(sql, undefined) }), /Invalid principal/);
});

test('login abuse storage is required before startup and never repaired implicitly', async () => {
  for (const rows of [complete().filter(row => row.table_name !== 'auth_login_buckets'),
    complete().map(row => row.table_name === 'auth_login_buckets' && row.column_name === 'attempts' ? { ...row, data_type: 'text' } : row)]) {
    const calls = [];
    await assert.rejects(assertCoreSchemaReady({ async query(sql) { calls.push(sql); return response(sql, rows); } }), /not compatible/);
    assert.ok(calls.every(sql => sql.trim().startsWith('SELECT ')));
  }
});

test('an ambiguous effective schema path rejects before inspecting columns', async () => {
  for (const schemas of [[], ['other', 'public'], ['private'], null]) {
    let calls = 0;
    await assert.rejects(assertCoreSchemaReady({ query: async () => { calls++; return { rows: [{ schemas }] }; } }), /Cannot inspect/);
    assert.equal(calls, 1);
  }
});

test('account observation column must exist before startup without implicit migration', async () => {
  for (const rows of [complete().filter(row=>!(row.table_name==='usuarios'&&row.column_name==='user_admin_version')),
    complete().map(row=>row.table_name==='usuarios'&&row.column_name==='user_admin_version'?{...row,data_type:'text'}:row)]) {
    await assert.rejects(assertCoreSchemaReady({query:async sql=>response(sql,rows)}),/not compatible/);
  }
});
