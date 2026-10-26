import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {readMigrationIdentity,readMigrationStatus,buildMigrationPlan,runMigrations} from '../src/migrations.js';

test('forward migrations close Supabase-style default grants before commit without changing old records or ACL',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
 const port=55883,f=await startLocalHarness({port,clusterOnly:true,deferLoginAbuseMigration:true,deferPersonalListBlockCreateReceiptsMigration:true});
 const pool=new pg.Pool({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,max:2});
 t.after(async()=>{await pool.end();await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});});
 const identity=await readMigrationIdentity(pool),directory=(await pool.query("SELECT current_setting('data_directory') directory")).rows[0].directory;
 assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity:{...identity,directory}});
 await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN');
 await pool.query('GRANT USAGE ON SCHEMA public TO anon,authenticated');
 await pool.query('ALTER DEFAULT PRIVILEGES FOR ROLE render2_fixture IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated');
 await pool.query('ALTER DEFAULT PRIVILEGES FOR ROLE render2_fixture IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated');
 await pool.query('ALTER DEFAULT PRIVILEGES FOR ROLE render2_fixture IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated');
 // A pre-existing unrelated relation/row/policy must not be rewritten by the
 // new-object guard. A real deployment must audit existing access separately.
 await pool.query("CREATE TABLE release_existing_probe(id integer PRIMARY KEY,content text); INSERT INTO release_existing_probe VALUES(1,'QA preserved'); ALTER TABLE release_existing_probe ENABLE ROW LEVEL SECURITY");
 const oldNames=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
 const snapshot=async()=>{const rows={};for(const name of oldNames){assert.match(name,/^[a-z_][a-z0-9_]*$/);
  if(name==='_migrations')continue;
  rows[name]=(await pool.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(t),t.xmin::text,t.ctid::text) ORDER BY to_jsonb(t)::text,t.ctid::text)::text,'[]')) hash FROM "${name}" t`)).rows[0].hash;
 }return rows;};
 const before=await snapshot();
 const oldAcl=(await pool.query("SELECT relrowsecurity,relacl::text FROM pg_class WHERE oid='public.release_existing_probe'::regclass")).rows;
 const status=await readMigrationStatus(pool);assert.deepEqual(status.pending.map(p=>p.name),['067_auth_login_buckets.sql','093_personal_list_block_create_receipts.sql']);
 let checkedBeforeCommit=0;const wrapped={async connect(){const db=await pool.connect();return{release:flag=>db.release(flag),async query(sql,params){
  if(sql==='COMMIT'){
   const rows=(await db.query("SELECT c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'INSERT') AS member_write FROM pg_class c WHERE c.oid=ANY(ARRAY[to_regclass('public.auth_login_buckets'),to_regclass('public.personal_list_block_create_receipts')])")).rows;
   assert.ok(rows.length);assert.ok(rows.every(r=>r.relrowsecurity&&!r.anon_read&&!r.member_write));checkedBeforeCommit++;
  }
  return db.query(sql,params);
 }};}};
 await runMigrations(wrapped,{log(){}},{approval:{environment:'test',expectedIdentity:identity,purpose:'local-explicit',planHash:buildMigrationPlan({environment:'test',identity,status})}});
 assert.equal(checkedBeforeCommit,2);assert.deepEqual(await snapshot(),before);
 assert.deepEqual((await pool.query("SELECT relrowsecurity,relacl::text FROM pg_class WHERE oid='public.release_existing_probe'::regclass")).rows,oldAcl);
 const routine=(await pool.query("SELECT has_function_privilege('anon','public.personal_list_block_create_receipt_immutable()','EXECUTE') AS anon_execute,has_function_privilege('authenticated','public.personal_list_block_create_receipt_immutable()','EXECUTE') AS member_execute")).rows[0];
 assert.deepEqual(routine,{anon_execute:false,member_execute:false});
 await pool.query("INSERT INTO auth_login_buckets VALUES(repeat('a',64),1,now(),now()+interval '1 minute')");
 const db=await pool.connect();try{for(const role of ['anon','authenticated']){
  await db.query('BEGIN');await db.query('SET LOCAL ROLE '+role);
  await assert.rejects(db.query('SELECT * FROM public.auth_login_buckets'),e=>e.code==='42501');await db.query('ROLLBACK');
  await db.query('BEGIN');await db.query('SET LOCAL ROLE '+role);
  await assert.rejects(db.query("INSERT INTO public.auth_login_buckets VALUES(repeat('b',64),1,now(),now()+interval '1 minute')"),e=>e.code==='42501');await db.query('ROLLBACK');
 }}finally{db.release();}
 assert.equal((await pool.query('SELECT count(*)::int n FROM auth_login_buckets')).rows[0].n,1,'application owner retains working access');
});
