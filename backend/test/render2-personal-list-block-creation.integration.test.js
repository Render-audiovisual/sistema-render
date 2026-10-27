import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness, fixturePassword, assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {loginProductionCookieSession, productionCookieRequest} from './helpers/production-cookie-session.js';
import {createPersonalListBlockCreation} from '../../frontend/src/pages/personalListBlockCreation.js';

// Opt-in, generated PostgreSQL only; no configured DB, providers or native browser.
test('block creation: private cookie HTTP receipts and real frontend lost-ACK recovery', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55970, f = await startLocalHarness({port, browserSessions: true});
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA384 own fixture stopped; port55970; cleanup ENOENT: ${f.root}`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55970/render2_local_test',identity});
  const owner = await loginProductionCookieSession(f.base, 'qa_luciano', fixturePassword);
  const admin = await loginProductionCookieSession(f.base, 'qa_franco', fixturePassword);
  assert.equal(owner.user.id, 91003); assert.equal(admin.user.id, 91001);
  assert.equal(admin.user.rol, 'admin'); assert.notEqual(owner.cookie, admin.cookie);
  const api = (path, method='GET', body, session=owner) => productionCookieRequest(f.base,
    `/api${path}`, {session,method,body});
  const ok = (r, status=200) => {assert.equal(r.status,status,'Expected cookie HTTP status'); return r.body;};
  const page = async (title, session=owner) => {
    const row = ok(await api('/listas-personales','POST',{
      request_id:randomUUID(),titulo:title,emoji:'📝',bloques:[],
    },session),201);
    assert.deepEqual(row.bloques,[]); return row;
  };
  const own = await page('QA384 private owner'), second = await page('QA384 second owner');
  const foreign = await page('QA384 private admin',admin);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,110,'Explicit current public-table coverage including the editing-progress ledger');
  async function snapshot() {
    const hashes = {};
    for (const table of tables) {
      assert.match(table,/^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table]=row.hash;
    }
    return hashes;
  }
  const body = (text='QA384 block') => ({request_id:randomUUID(),tipo:'texto',contenido:{texto:text}});
  const post = (value,list=own,session=owner) => api(`/listas-personales/${list.id}/bloques`,'POST',value,session);
  const lookup = (key,list=own,session=owner) => api(`/listas-personales/${list.id}/bloques/creaciones/${key}`,'GET',undefined,session);
  const row = (block,key,list=own) => {
    assert.equal(block.creation_request_id,key); assert.equal(String(block.lista_id),String(list.id));
    assert.match(String(block.id),/^[1-9]\d*$/); assert.equal(block.tipo,'texto');
    assert.equal(typeof block.contenido.texto,'string'); assert.equal(block.version,1);
    assert.ok(Number.isInteger(block.posicion)&&block.posicion>=0);
    for(const field of ['created_at','updated_at']) assert.ok(Number.isFinite(Date.parse(block[field])));
    assert.equal(Object.hasOwn(block,'block'),false,'HTTP returns the raw block, not module envelope');
    return block;
  };
  const counts = async key => {
    const [value] = await f.query(`SELECT
      (SELECT count(*)::int FROM personal_list_block_create_receipts WHERE actor_user_id=$1 AND request_id=$2) AS receipts,
      (SELECT count(*)::int FROM lista_bloques b JOIN personal_list_block_create_receipts r ON r.block_id=b.id
        WHERE r.actor_user_id=$1 AND r.request_id=$2 AND b.lista_id=r.list_id) AS blocks`,[owner.user.id,key]);
    return value;
  };
  await t.test('fresh201, normalized replay200 and lookup200 preserve every table on reads',async()=>{
    const intent=body('  QA384 normalized  '), created=row(ok(await post(intent),201),intent.request_id);
    assert.equal(created.contenido.texto,'QA384 normalized');
    const before=await snapshot();
    assert.deepEqual(row(ok(await post({...intent,contenido:{texto:'QA384 normalized'}})),intent.request_id),created);
    assert.deepEqual(row(ok(await lookup(intent.request_id)),intent.request_id),created);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(await counts(intent.request_id),{receipts:1,blocks:1});
  });
  await t.test('changed payload/list409, foreign admin404 and request validation have zero DML',async()=>{
    const intent=body(), created=ok(await post(intent),201), before=await snapshot();
    ok(await post({...intent,contenido:{texto:'changed'}}),409);
    ok(await post(intent,second),409);
    ok(await post(intent,own,admin),404); ok(await lookup(intent.request_id,own,admin),404);
    ok(await post(body(),foreign),404); ok(await lookup(intent.request_id,foreign),404);
    const missing=body(); delete missing.request_id; ok(await post(missing),428);
    for(const request_id of [null,'bad',1,{},`${randomUUID()}\n`]) ok(await post({...body(),request_id}),400);
    ok(await lookup(randomUUID()),404); ok(await lookup('bad'),400);
    assert.deepEqual(await snapshot(),before); assert.ok(created.id);
  });
  await t.test('simultaneous identical intents commit exactly one block and one receipt',async()=>{
    const intent=body(), [before]=await f.query('SELECT count(*)::int AS n FROM lista_bloques WHERE lista_id=$1',[own.id]);
    const results=await Promise.all([post(intent),post(intent)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
    assert.deepEqual(results[0].body,results[1].body); row(results[0].body,intent.request_id);
    const [after]=await f.query('SELECT count(*)::int AS n FROM lista_bloques WHERE lista_id=$1',[own.id]);
    assert.equal(after.n,before.n+1); assert.deepEqual(await counts(intent.request_id),{receipts:1,blocks:1});
  });
  await t.test('deleted block retains immutable tombstone; GET/retry409 never resurrect',async()=>{
    const intent=body(), created=ok(await post(intent),201);
    ok(await api(`/listas-personales/bloques/${created.id}`,'DELETE'));
    const before=await snapshot(); ok(await lookup(intent.request_id),409); ok(await post(intent),409);
    assert.deepEqual(await snapshot(),before); assert.deepEqual(await counts(intent.request_id),{receipts:1,blocks:0});
    await assert.rejects(f.query('UPDATE personal_list_block_create_receipts SET block_id=block_id WHERE actor_user_id=$1 AND request_id=$2',
      [owner.user.id,intent.request_id]),/immutable/i);
    await assert.rejects(f.query('DELETE FROM personal_list_block_create_receipts WHERE actor_user_id=$1 AND request_id=$2',
      [owner.user.id,intent.request_id]),/immutable/i);
    assert.deepEqual(await snapshot(),before);
  });
  const transport = async (path,options) => {
    const result=await productionCookieRequest(f.base,path,{session:owner,method:options.method,
      ...(options.body===undefined?{}:{body:JSON.parse(options.body)})});
    if(result.status>=400) throw Object.assign(new Error('Expected fixture HTTP rejection'),{status:result.status});
    return result.body;
  };
  await t.test('real frontend lost observed ACK recovers by GET with exactly one POST',async()=>{
    const key=randomUUID(), calls=[], accepted=[];
    const model=createPersonalListBlockCreation({createRequestId:()=>key,isCurrent:()=>true,onCreated:r=>accepted.push(r),
      request:async(path,options)=>{
        calls.push({path,method:options.method});
        const result=await transport(path,options);
        if(options.method==='POST') throw new Error('Synthetic lost ACK after real HTTP commit');
        return result;
      }});
    try {
      assert.equal(await model.create(own.id,{tipo:'texto',contenido:{texto:'QA384 lost ACK'}}),false);
      assert.equal(model.snapshot().phase,'uncertain'); assert.deepEqual(await counts(key),{receipts:1,blocks:1});
      const before=await snapshot(); assert.equal(await model.verify(),true);
      assert.equal(model.snapshot().phase,'confirmed'); assert.equal(accepted.length,1); row(accepted[0],key);
      assert.deepEqual(calls.map(c=>c.method),['POST','GET']);
      assert.equal(calls[1].path,`/api/listas-personales/${own.id}/bloques/creaciones/${key}`);
      assert.deepEqual(await snapshot(),before); assert.deepEqual(await counts(key),{receipts:1,blocks:1});
    } finally {model.dispose();}
  });
  await t.test('GET404 permits only explicit retry with identical captured body and UUID',async()=>{
    const key=randomUUID(), posts=[], accepted=[]; let dropped=false;
    const model=createPersonalListBlockCreation({createRequestId:()=>key,isCurrent:()=>true,onCreated:r=>accepted.push(r),
      request:async(path,options)=>{
        if(options.method==='POST') {
          posts.push(options.body);
          if(!dropped){dropped=true; throw new Error('Synthetic transport failure before send');}
        }
        return transport(path,options);
      }});
    try {
      assert.equal(await model.create(own.id,{tipo:'texto',contenido:{texto:'QA384 explicit retry'}}),false);
      const before=await snapshot(); assert.equal(await model.verify(),false);
      assert.equal(model.snapshot().phase,'missing'); assert.equal(model.snapshot().canRetry,true);
      assert.equal(posts.length,1); assert.deepEqual(await counts(key),{receipts:0,blocks:0});
      assert.deepEqual(await snapshot(),before);
      assert.equal(await model.retry(),true); assert.equal(model.snapshot().phase,'confirmed');
      assert.equal(posts.length,2); assert.equal(posts[0],posts[1]); assert.equal(JSON.parse(posts[1]).request_id,key);
      assert.equal(accepted.length,1); row(accepted[0],key); assert.deepEqual(await counts(key),{receipts:1,blocks:1});
    } finally {model.dispose();}
  });
});
