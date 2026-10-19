import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCHEMA_COLUMNS, assertCoreSchemaReady } from '../src/startup-schema.js';
const complete = () => Object.entries(CORE_SCHEMA_COLUMNS).flatMap(([table_name, columns]) =>
  Object.entries(columns).map(([column_name, data_type]) => ({ table_name, column_name, data_type })));
const response = (sql, rows) => ({ rows: sql.includes('current_schemas') ? [{ schemas: ['public'] }] : rows });

test('principal compatibility inspection uses a parameterized SELECT only', async () => {
  const calls = [];
  await assertCoreSchemaReady({ async query(sql, values) { calls.push({ sql, values }); return response(sql, complete()); } });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /current_schemas\(false\)::text\[\]/);
  for (const call of calls) {
    assert.match(call.sql.trim(), /^SELECT /);
    assert.doesNotMatch(call.sql, /CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE/);
  }
  assert.deepEqual(calls[1].values, [Object.keys(CORE_SCHEMA_COLUMNS)]);
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

test('an ambiguous effective schema path rejects before inspecting columns', async () => {
  for (const schemas of [[], ['other', 'public'], ['private'], null]) {
    let calls = 0;
    await assert.rejects(assertCoreSchemaReady({ query: async () => { calls++; return { rows: [{ schemas }] }; } }), /Cannot inspect/);
    assert.equal(calls, 1);
  }
});
