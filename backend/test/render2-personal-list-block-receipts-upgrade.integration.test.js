import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {assertCoreSchemaReady} from '../src/startup-schema.js';

// Actual CLI and ordinary server, generated PostgreSQL only. Never configured DB.
test('pre093 populated personal blocks upgrade additively with durable immutable receipt guards',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
  const port=55971,f=await startLocalHarness({port,clusterOnly:true,deferPersonalListBlockCreateReceiptsMigration:true});
  let db;
  t.after(async()=>{try{await db?.query('ROLLBACK').catch(()=>{});await db?.end();}finally{
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`QA384 receipt093-deferred fixture with editing-progress ledger stopped port55971; cleanup ENOENT: ${f.root}`);
  }});
  db=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',
    ssl:false,statement_timeout:20000,connectionTimeoutMillis:5000});await db.connect();
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,
    identity:(await db.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`)).rows[0]});
  const lists=await f.query(`INSERT INTO listas_personales(usuario_id,titulo,posicion)
    VALUES(91003,'QA384 pre093 private owner',0),(91001,'QA384 pre093 private admin',0) RETURNING id,usuario_id`);
  for(const list of lists) await f.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion,version)
    VALUES($1,'texto','{"texto":"Historical private content"}',0,3),
      ($1,'checklist','{"titulo":"Historical checks","items":[]}',1,2)`,[list.id]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,109,'Receipt093 deferred; editing-progress ledger included in historical table hashes');assert.equal(tables.includes('personal_list_block_create_receipts'),false);
  const snapshot=async()=>{const hashes={};for(const table of tables.filter(name=>name!=='_migrations')){
    assert.match(table,/^[a-z_][a-z0-9_]*$/);
    hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
      ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
  }return hashes;};
  const ledger=()=>f.query('SELECT to_jsonb(r) row,r.xmin::text xmin,r.ctid::text ctid FROM _migrations r ORDER BY id');
  const before=await snapshot(),oldLedger=await ledger();
  const finish=async handle=>{const result=await handle.done;
    const output=`${result.stdout}${result.stderr}`;
    assert.equal(output.includes(f.secret),false);assert.equal(/postgres(?:ql)?:\/\//i.test(output),false);return result;
  };
  const cli=async args=>finish(await f.launchActual({entry:'migrate',args}));
  let approved;
  await t.test('status sees only093; ordinary startup refuses and never repairs schema or rows',async()=>{
    const status=await cli(['status']);assert.equal(status.code,0);approved=JSON.parse(status.stdout);
    assert.deepEqual(approved.status.pending.map(r=>r.name),['093_personal_list_block_create_receipts.sql']);
    await assert.rejects(assertCoreSchemaReady(db),/schema is not compatible/);
    const server=await f.launchActual({entry:'server'});
    try{await assert.rejects(server.ready);assert.notEqual((await finish(server)).code,0);}finally{await server.stop();}
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await ledger(),oldLedger);
    assert.deepEqual(await f.query("SELECT to_regclass('public.personal_list_block_create_receipts') relation"),[{relation:null}]);
  });
  await t.test('authorized CLI apply preserves all historical tuples and creates empty receipt table',async()=>{
    assert.ok(approved?.planHash,'Status approval is required before migration');
    const result=await cli(['apply','--plan',approved.planHash,'--database','render2_local_test','--user','render2_fixture']);
    assert.equal(result.code,0);assert.deepEqual(await snapshot(),before);
    const currentLedger=await ledger();assert.equal(currentLedger.length,oldLedger.length+1);
    assert.deepEqual(currentLedger.slice(0,-1),oldLedger,'Every old ledger tuple also stays untouched');
    assert.deepEqual(await f.query('SELECT * FROM personal_list_block_create_receipts'),[]);
    assert.equal((await f.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'"))[0].n,110,'Receipt093 adds exactly one table; editing-progress ledger remains covered');
    await assertCoreSchemaReady(db);
    const status=await cli(['status']);assert.equal(status.code,0);const after=JSON.parse(status.stdout);
    assert.deepEqual(after.status.pending,[]);
    assert.deepEqual(after.status.applied,[...approved.status.applied,'093_personal_list_block_create_receipts.sql'].sort(),
      'Status lists every applied migration lexically, including the already installed timestamped ledger migration');
  });
  await t.test('actual PK, actor RESTRICT, no domain FK and immutable rows reject invalid operations',async()=>{
    const constraints=(await db.query(`SELECT contype,confdeltype,condeferrable,confrelid::regclass::text target,
      pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='personal_list_block_create_receipts'::regclass`)).rows;
    assert.deepEqual(constraints.filter(r=>r.contype==='p').map(r=>r.definition),['PRIMARY KEY (actor_user_id, request_id)']);
    const fks=constraints.filter(r=>r.contype==='f');assert.equal(fks.length,1);
    assert.equal(fks[0].target,'usuarios');assert.equal(fks[0].confdeltype,'r');assert.equal(fks[0].condeferrable,false);
    const invalid=async(sql,values,code)=>{
      await db.query('SAVEPOINT invalid_operation');
      try{await assert.rejects(db.query(sql,values),e=>e.code===code);}finally{
        await db.query('ROLLBACK TO SAVEPOINT invalid_operation');await db.query('RELEASE SAVEPOINT invalid_operation');
      }
    };
    const insert=`INSERT INTO personal_list_block_create_receipts(actor_user_id,request_id,payload_hash,list_id,block_id)
      VALUES($1,$2,$3,$4,$5)`;
    await db.query('BEGIN');
    try{
      const key=randomUUID(),hash='a'.repeat(64),args=[91003,key,hash,'9223372036854775807','9223372036854775806'];
      // Deliberately absent domain IDs prove receipt tombstones have no list/block FK.
      await db.query(insert,args);
      await invalid(insert,args,'23505');
      await invalid(insert,[2147483647,randomUUID(),hash,1,1],'23503');
      for(const patch of [[91003,randomUUID(),'bad',1,1],[91003,randomUUID(),hash,0,1],
        [91003,randomUUID(),hash,1,0]]) await invalid(insert,patch,'23514');
      await invalid('UPDATE personal_list_block_create_receipts SET block_id=block_id WHERE request_id=$1',[key],'23514');
      await invalid('DELETE FROM personal_list_block_create_receipts WHERE request_id=$1',[key],'23514');
      // A dedicated disposable actor isolates FK RESTRICT from all unrelated user references.
      const actor=(await db.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash,activo,session_version)
        SELECT 'qa384_receipt_restrict','QA384 receipt actor','edicion',password_hash,true,1
        FROM usuarios WHERE id=91003 RETURNING id`)).rows[0];
      await db.query(insert,[actor.id,randomUUID(),hash,1,1]);
      await invalid('DELETE FROM usuarios WHERE id=$1',[actor.id],'23503');
    }finally{await db.query('ROLLBACK');}
    assert.deepEqual(await f.query('SELECT * FROM personal_list_block_create_receipts'),[]);
    assert.deepEqual(await snapshot(),before);await assertCoreSchemaReady(db);
  });
  await t.test('disabled immutable trigger fails startup check without auto-repair; restoration passes',async()=>{
    await db.query('BEGIN');
    try{
      await db.query('ALTER TABLE personal_list_block_create_receipts DISABLE TRIGGER personal_list_block_create_receipt_immutable');
      await assert.rejects(assertCoreSchemaReady(db),/block receipt guard is not compatible/);
      assert.equal((await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='personal_list_block_create_receipts'::regclass
        AND tgname='personal_list_block_create_receipt_immutable'`)).rows[0].tgenabled,'D','Startup must not repair disabled guard');
    }finally{await db.query('ROLLBACK');}
    await assertCoreSchemaReady(db);assert.deepEqual(await snapshot(),before);
  });
});
