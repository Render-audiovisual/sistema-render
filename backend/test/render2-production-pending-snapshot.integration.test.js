import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';
import {createProductionRegistryRouter} from '../src/production-registry.js';
import {withProductionReadSnapshot} from '../src/production-read-snapshot.js';

const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
test('actual pending router reads videos and photos from one physical RR read-only snapshot',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55884,f=await startLocalHarness({port});
  let pool,server,external;
  const entered=deferred(),resume=deferred();
  t.after(async()=>{
    resume.resolve();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(external){await external.query('ROLLBACK').catch(()=>{});external.release();}
    await pool?.end();await f.cleanup();
    await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own pending snapshot fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=identity=>assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity});
  guard((await f.query(identitySql))[0]);
  pool=new pg.Pool({connectionString:url,max:3,statement_timeout:15000,connectionTimeoutMillis:5000});
  external=await pool.connect();guard((await external.query(identitySql)).rows[0]);
  const actor=(await external.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=91003')).rows[0];
  assert.equal(actor.activo,true);assert.equal(actor.rol,'edicion');
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA245 snapshot bank',true) RETURNING id");
  const visitId=randomUUID(),videoId=randomUUID(),photoId=randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'2026-10-20','QA245 visit',91001,91001)`,[visitId,client.id]);
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA245 video','pendiente',91001,91001)`,[videoId,visitId]);
  await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,estado,creado_por_id,actualizado_por_id)
    VALUES($1,$2,'QA245 photo','pendiente',91001,91001)`,[photoId,visitId]);
  const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_luciano',password:fixturePassword}});
  assert.equal(login.status,200,'Principal fixture login succeeds without printing credentials');
  const principalBank=()=>request(f.base,`/api/producciones/pendientes?cliente_id=${client.id}`,{token:login.body.token});
  const original=await principalBank();
  assert.equal(original.status,200);
  assert.deepEqual(original.body.videos.map(row=>row.id),[videoId]);
  assert.deepEqual(original.body.fotos.map(row=>row.id),[photoId]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function hashes(){const result={};for(const table of tables){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const before=await hashes();
  const oldVideos=await f.query('SELECT * FROM produccion_videos ORDER BY id');
  const oldPhotos=await f.query('SELECT * FROM produccion_fotos ORDER BY id');
  const trace=[];let arm=true,leases=0;
  const wrappedPool={query(){assert.fail('Router read escaped leased snapshot');},async connect(){
    leases++;const db=await pool.connect();
    return{async query(sql,values){
      trace.push(sql.replace(/\s+/g,' ').trim());
      const result=await db.query(sql,values);
      if(arm&&sql.includes('FROM produccion_videos pv')&&sql.includes('NOT EXISTS')){
        arm=false;
        const settings=(await db.query(`SELECT current_setting('transaction_isolation') AS isolation,
          current_setting('transaction_read_only') AS readonly,pg_backend_pid() AS pid`)).rows[0];
        entered.resolve(settings);await resume.promise;
      }
      return result;
    },release:error=>db.release(error)};
  }};
  const app=express();
  // Deliberately bypass HTTP authentication only: actor is a real verified
  // fixture row, and the actual router/helper independently revalidate it.
  app.use((req,res,next)=>{req.auth={...actor};next();});
  app.use('/api/producciones',createProductionRegistryRouter({express,pool:wrappedPool}));
  app.use((error,req,res,next)=>{res.status(error.status||500).json({error:'synthetic fixture request failed'});});
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint=`http://127.0.0.1:${server.address().port}/api/producciones/pendientes?cliente_id=${client.id}`;
  const pending=fetch(endpoint,{signal:AbortSignal.timeout(20000)}).then(async response=>({status:response.status,body:await response.json()}));
  void pending.catch(()=>{});
  const settings=await Promise.race([entered.promise,pending.then(()=>{throw Error('Request ended before video barrier');}),
    new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Video barrier timed out')),10000);timer.unref();entered.promise.then(()=>clearTimeout(timer));})]);
  assert.equal(settings.isolation,'repeatable read');assert.equal(settings.readonly,'on');
  assert.notEqual(settings.pid,(await external.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  try{
    await external.query('BEGIN');
    await external.query("UPDATE produccion_videos SET estado='grabado' WHERE id=$1",[videoId]);
    await external.query("UPDATE produccion_fotos SET estado='realizada' WHERE id=$1",[photoId]);
    await external.query('COMMIT');
  }catch(error){await external.query('ROLLBACK');throw error;}
  resume.resolve();const observed=await pending;
  assert.equal(observed.status,200);assert.deepEqual(Object.keys(observed.body).sort(),['fotos','videos']);
  assert.deepEqual(observed.body.videos.map(row=>[row.id,row.estado,row.cliente_id]),[[videoId,'pendiente',client.id]]);
  assert.deepEqual(observed.body.fotos.map(row=>[row.id,row.estado,row.cliente_id]),[[photoId,'pendiente',client.id]]);
  assert.equal(leases,1);assert.equal(trace[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(trace[1],/FROM usuarios WHERE id=\$1$/);assert.equal(trace.at(-1),'COMMIT');
  const after=await hashes();
  assert.deepEqual(tables.filter(name=>before[name]!==after[name]).sort(),['produccion_fotos','produccion_videos']);
  assert.deepEqual(await f.query('SELECT * FROM produccion_videos ORDER BY id'),oldVideos.map(row=>row.id===videoId?{...row,estado:'grabado'}:row));
  assert.deepEqual(await f.query('SELECT * FROM produccion_fotos ORDER BY id'),oldPhotos.map(row=>row.id===photoId?{...row,estado:'realizada'}:row));
  const fresh=await fetch(endpoint,{signal:AbortSignal.timeout(15000)});
  assert.equal(fresh.status,200);assert.deepEqual(await fresh.json(),{videos:[],fotos:[]});
  const principalFresh=await principalBank();
  assert.equal(principalFresh.status,200);assert.deepEqual(principalFresh.body,{videos:[],fotos:[]});
  await assert.rejects(withProductionReadSnapshot(pool,actor,db=>db.query("UPDATE produccion_fotos SET estado='pendiente' WHERE id=$1",[photoId])),error=>error.code==='25006');
  assert.deepEqual(await hashes(),after,'Fresh reads and rejected mutation must leave all public tables unchanged');
  t.diagnostic(`All ${tables.length} public table hashes checked; only exact synthetic video/photo state mutations allowed. Principal bearer employee reads plus wrapped-router physical concurrency; no browser/provider or business write workflow proof.`);
});
