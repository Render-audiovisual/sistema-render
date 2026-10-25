import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCHEMA_COLUMNS, assertCoreSchemaReady } from '../src/startup-schema.js';
const complete = () => Object.entries(CORE_SCHEMA_COLUMNS).flatMap(([table_name, columns]) =>
  Object.entries(columns).map(([column_name, data_type]) => ({ table_name, column_name, data_type })));
const response = (sql, rows) => ({ rows: sql.includes('current_schemas') ? [{ schemas: ['public'] }] : sql.includes('pg_trigger') ? [{ready:true,reference_ready:true,personal_list_receipt_ready:true,project_child_receipt_ready:true,task_comment_receipt_ready:true}] : sql.includes('pg_constraint') ? [{comment_actor_ready:true}] : rows });

test('principal compatibility inspection uses a parameterized SELECT only', async () => {
  const calls = [];
  await assertCoreSchemaReady({ async query(sql, values) { calls.push({ sql, values }); return response(sql, complete()); } });
  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /current_schemas\(false\)::text\[\]/);
  for (const call of calls) {
    assert.match(call.sql.trim(), /^SELECT /);
    assert.doesNotMatch(call.sql, /CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE/);
  }
  assert.deepEqual(calls[1].values, [Object.keys(CORE_SCHEMA_COLUMNS)]);
  assert.deepEqual(calls[2].values, ['feedback_notes_monotonic_version','moodboard_reference_advance_revision','personal_list_create_receipt_immutable','project_child_create_receipt_immutable','task_comment_create_receipt_immutable']);
});

test('comment receipt relation and enabled immutable guard are required without automatic repair', async () => {
  await assert.rejects(assertCoreSchemaReady({query:async sql=>response(sql,complete().filter(r=>r.table_name!=='task_comment_create_receipts'))}),/Principal schema is not compatible/);
  for(const ready of [false,null,undefined,'true',1]){
    const calls=[];
    await assert.rejects(assertCoreSchemaReady({query:async(sql,values)=>{
      calls.push(sql);const value=response(sql,complete());if(sql.includes('pg_trigger'))value.rows[0].task_comment_receipt_ready=ready;return value;
    }}),/task-comment receipt guard is not compatible.*No repair/);
    assert.ok(calls.every(sql=>sql.trim().startsWith('SELECT ')));
  }
});

test('durable comment actor requires its column and validated nondeferrable RESTRICT FK without repair',async()=>{
  await assert.rejects(assertCoreSchemaReady({query:async sql=>response(sql,complete().filter(row=>!(row.table_name==='tarea_comentarios'&&row.column_name==='actor_usuario_id')))}),/schema is not compatible/);
  for(const ready of [false,null,undefined,1,'true']){
    const calls=[];
    await assert.rejects(assertCoreSchemaReady({query:async sql=>{calls.push(sql);return sql.includes('pg_constraint')?{rows:[{comment_actor_ready:ready}]}:response(sql,complete());}}),/comment actor is not compatible/);
    assert.ok(calls.every(sql=>sql.trim().startsWith('SELECT ')));
    assert.match(calls.at(-1),/c\.confdeltype='r' AND NOT c\.condeferrable/);
    assert.match(calls.at(-1),/NOT a\.attnotnull AND NOT EXISTS/);
    assert.match(calls.at(-1),/pg_attrdef d WHERE d\.adrelid=a\.attrelid AND d\.adnum=a\.attnum/);
  }
});

test('missing or disabled monotonic note trigger rejects startup without installing or repairing it', async () => {
  for (const ready of [false,null,undefined,'true']) {
    await assert.rejects(assertCoreSchemaReady({query:async sql=>sql.includes('pg_trigger')?{rows:[{ready}]}:response(sql,complete())}),/note clock is not compatible/);
  }
  await assert.rejects(assertCoreSchemaReady({query:async sql=>{
    if(sql.includes('pg_trigger'))throw Error('private clock detail');return response(sql,complete());
  }}),error=>{assert.equal(error.message,'Cannot inspect principal note clock.');return true;});
});

test('missing or disabled reference revision trigger rejects startup without repair',async()=>{
  for(const reference_ready of [false,null,undefined,'true']){
    await assert.rejects(assertCoreSchemaReady({query:async sql=>sql.includes('pg_trigger')?{rows:[{ready:true,reference_ready}]}:response(sql,complete())}),/moodboard clock is not compatible/);
  }
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

test('personal creation receipt table and each confirmed087 column/type are required without repair', async () => {
  const expected = { actor_user_id: 'integer', request_id: 'uuid', payload_hash: 'text', list_id: 'bigint', committed_at: 'timestamp with time zone' };
  assert.deepEqual(CORE_SCHEMA_COLUMNS.personal_list_create_receipts, expected);
  const variants = [complete().filter(row => row.table_name !== 'personal_list_create_receipts')];
  for (const column of Object.keys(expected)) {
    variants.push(complete().filter(row => !(row.table_name === 'personal_list_create_receipts' && row.column_name === column)));
    variants.push(complete().map(row => row.table_name === 'personal_list_create_receipts' && row.column_name === column
      ? { ...row, data_type: row.data_type === 'text' ? 'jsonb' : 'text' } : row));
  }
  for (const rows of variants) {
    const calls = [];
    await assert.rejects(assertCoreSchemaReady({ query: async (sql, values) => {
      calls.push({ sql, values }); return response(sql, rows);
    } }), /Principal schema is not compatible/);
    assert.equal(calls.length, 2, 'Reject incompatible columns before inspecting bindings');
    assert.ok(calls.every(call => call.sql.trim().startsWith('SELECT ')));
  }
});

test('missing/disabled personal receipt guard fails closed; inspection checks only exact enabled before-row binding', async () => {
  for (const ready of [false, null, undefined, 'true', 1]) {
    const calls = [];
    await assert.rejects(assertCoreSchemaReady({ query: async (sql, values) => {
      calls.push({ sql, values });
      return sql.includes('pg_trigger') ? { rows: [{ ready: true, reference_ready: true, personal_list_receipt_ready: ready }] } : response(sql, complete());
    } }), /personal-list receipt guard is not compatible.*No repair/);
    const query = calls.at(-1);
    assert.match(query.sql, /t\.tgrelid='public\.personal_list_create_receipts'::regclass AND t\.tgname=\$3/);
    assert.match(query.sql, /p\.proname=\$3 AND n\.nspname='public' AND NOT t\.tgisinternal/);
    assert.match(query.sql, /t\.tgenabled IN \('O','A'\) AND t\.tgtype=27 AND t\.tgnargs=0/);
    assert.ok(calls.every(call => call.sql.trim().startsWith('SELECT ')));
    assert.doesNotMatch(calls.map(call => call.sql).join('\n'), /CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE/);
  }
});
