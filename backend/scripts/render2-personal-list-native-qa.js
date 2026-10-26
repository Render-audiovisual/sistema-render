// Manual native-browser QA only. Build the canonical frontend first, then run
// RENDER2_RUN_LOCAL_INTEGRATION=true node scripts/render2-personal-list-native-qa.js
// Follow READY commands after native login; finish/abort removes only this fixture.
// Never accepts a configured database URL, credentials, target URL or arguments.
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {startLocalHarness,assertFixtureIdentity,cleanEnvironment} from './render2-local-test.js';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const port=55985,httpPort=52903,origin=`http://127.0.0.1:${httpPort}`;
const title='QA402 Página recuperada',text='QA402 Texto después de recuperar el guardado';
const identitySql=`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
 inet_server_port() port,current_setting('data_directory') directory`;
async function childMain(){
 assert.ok(process.connected);const env=process.env;
 const guard={root:env.RENDER2_FIXTURE_ROOT,cwd:process.cwd(),port,url:env.DATABASE_URL};
 assertFixtureIdentity(guard);assert.equal(env.RENDER2_FIXTURE_PORT,String(port));
 assert.equal(env.DOTENV_CONFIG_PATH,'/dev/null');assert.equal(env.NODE_ENV,'test');
 assert.equal(env.RENDER_DISABLE_SERVER_START,'true');assert.equal(env.RENDER_BROWSER_ORIGIN,origin);
 globalThis.fetch=async()=>{throw Error('No external fetch in own QA402 child');};
 const {pool}=await import(repo+'/backend/src/db.js');let server,closing;
 const stats={pagePosts:0,page201:0,dropped:0,recoveryGets:0};
 const stop=()=>closing||=(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await pool.end();process.disconnect?.();})();
 try{
  assertFixtureIdentity({...guard,identity:(await pool.query(identitySql)).rows[0]});
  const {app}=await import(repo+'/backend/src/server.js');
  server=createServer((req,res)=>{
   const route=req.url.split('?')[0],create=req.method==='POST'&&route==='/api/listas-personales';
   if(create)stats.pagePosts++;
   if(req.method==='GET'&&/^\/api\/listas-personales\/creaciones\/[0-9a-f-]+$/.test(route))stats.recoveryGets++;
   const end=res.end;
   res.end=function(...args){
    if(create&&res.statusCode===201){stats.page201++;
     if(stats.dropped===0){stats.dropped++;process.send?.({type:'drop',stats:{...stats}});req.socket.destroy();return res;}}
    return end.apply(this,args);
   };app(req,res);
  });server.listen(httpPort,'127.0.0.1');await once(server,'listening');
  process.on('message',m=>{if(m?.type==='stats')process.send?.({type:'stats',id:m.id,stats:{...stats}});if(m?.type==='stop')void stop();});
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());process.once('disconnect',()=>void stop());
  process.send?.({type:'ready'});
 }catch(error){await stop();throw error;}
}
async function main(){
 let f,child,exited,exitInfo,input,timer,closed=false,chain=Promise.resolve(),baseline,privateBefore,tables,first,verified=false,blockChecked=false;
 let entry,staticBefore;const allowed=new Set(['listas_personales','lista_secciones','lista_bloques','personal_list_create_receipts','personal_list_block_create_receipts']);
 const paths=()=>[repo+'/frontend/dist/index.html',repo+'/frontend/dist'+entry];
 const staticHash=()=>Promise.all(paths().map(async p=>createHash('sha256').update(await readFile(p)).digest('hex')));
 const stats=()=>new Promise((resolve,reject)=>{const id=Date.now();const timeout=setTimeout(()=>{child.off('message',on);reject(Error('Own stats deadline'));},5000);
  const on=m=>{if(m?.type==='stats'&&m.id===id){clearTimeout(timeout);child.off('message',on);resolve(m.stats);}};child.on('message',on);child.send({type:'stats',id});});
 const snapshot=async()=>{const hashes={};for(const table of tables){assert.match(table,/^[a-z_][a-z0-9_]*$/);
  hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
   ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;}return hashes;};
 const others=async()=>{
  const rows={};for(const [table,scope] of [['listas_personales','r.usuario_id<>91003'],
   ['lista_bloques','NOT EXISTS(SELECT 1 FROM listas_personales l WHERE l.id=r.lista_id AND l.usuario_id=91003)'],
   ['lista_secciones','NOT EXISTS(SELECT 1 FROM listas_personales l WHERE l.id=r.lista_id AND l.usuario_id=91003)'],
   ['personal_list_create_receipts','r.actor_user_id<>91003'],['personal_list_block_create_receipts','r.actor_user_id<>91003']])
    rows[table]=await f.query(`SELECT to_jsonb(r) row,r.xmin::text xmin,r.ctid::text ctid FROM ${table} r WHERE ${scope} ORDER BY to_jsonb(r)::text`);
  return rows;};
 const invariant=async()=>{assert.ok(baseline);const now=await snapshot();for(const table of tables)if(!allowed.has(table))assert.equal(now[table],baseline[table],table);
  assert.deepEqual(await others(),privateBefore);assert.deepEqual(await staticHash(),staticBefore);};
 const own=async()=>{const lists=await f.query('SELECT * FROM listas_personales WHERE usuario_id=91003 ORDER BY id');assert.equal(lists.length,1);
  const receipts=await f.query('SELECT * FROM personal_list_create_receipts WHERE actor_user_id=91003');assert.equal(receipts.length,1);assert.equal(receipts[0].list_id,lists[0].id);
  const sections=await f.query('SELECT titulo FROM lista_secciones WHERE lista_id=$1',[lists[0].id]);assert.deepEqual(sections,[{titulo:'Pendientes'}]);
  return {list:lists[0],receipt:receipts[0]};};
 const checkBlock=async()=>{assert.equal(verified,true);await invariant();const row=await own();assert.equal(row.list.id,first.list.id);assert.equal(row.receipt.request_id,first.receipt.request_id);
  assert.equal(row.list.titulo,title);const blocks=await f.query('SELECT * FROM lista_bloques WHERE lista_id=$1',[row.list.id]);assert.equal(blocks.length,1);
  assert.equal(blocks[0].tipo,'texto');assert.deepEqual(blocks[0].contenido,{texto:text});
  const receipts=await f.query('SELECT list_id,block_id FROM personal_list_block_create_receipts WHERE actor_user_id=91003');assert.deepEqual(receipts,[{list_id:row.list.id,block_id:blocks[0].id}]);
  const s=await stats();assert.equal(s.pagePosts,1);assert.equal(s.page201,1);assert.equal(s.dropped,1);assert.ok(s.recoveryGets>=1);blockChecked=true;
  console.log('QA402_BLOCK_OK',JSON.stringify({listId:row.list.id,blockId:blocks[0].id,stats:s,unrelatedTables:tables.length-allowed.size}));};
 const finish=async(abort=false)=>{if(closed)return;closed=true;clearTimeout(timer);let accepted=false;
  try{
   if(abort)console.log('QA402_ABORTED_NO_ACCEPTANCE');else{assert.equal(blockChecked,true);await checkBlock();}
   accepted=!abort;
  }catch(e){process.exitCode=1;console.error('QA402_FINAL_FAILED',e.message);}
  finally{try{
   if(child&&!exitInfo){const kill=setTimeout(()=>child.kill('SIGKILL'),5000);let sendError;
    try{try{if(child.connected)child.send({type:'stop'});else child.kill('SIGTERM');}
     catch(error){sendError=error;child.kill('SIGTERM');}
     await exited;if(sendError)throw sendError;
    }finally{clearTimeout(kill);}}
   if(child){assert.equal(exitInfo?.code,0,'Own HTTP child must stop cleanly');assert.equal(exitInfo?.signal,null);}
  }catch(error){accepted=false;process.exitCode=1;console.error('QA402_FINAL_FAILED',error.message);}
  finally{try{if(f){await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');console.log('QA402_CLEANUP_ENOENT',f.root);}}
   catch(error){accepted=false;process.exitCode=1;console.error('QA402_FINAL_FAILED',error.message);}
   finally{input?.close();process.stdin.pause();}}}
  if(accepted)console.log('QA402_FINAL_OK');};
 try{
  const html=await readFile(repo+'/frontend/dist/index.html','utf8');entry=html.match(/<script\b[^>]*\bsrc="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1];assert.ok(entry);staticBefore=await staticHash();
  f=await startLocalHarness({port,clusterOnly:true});const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await f.query(identitySql))[0]});
  const [sentinel]=await f.query("INSERT INTO listas_personales(usuario_id,titulo,posicion) VALUES(91004,'QA402 Private sentinel',0) RETURNING id");
  await f.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion) VALUES($1,'texto','{"texto":"Other user unchanged"}',0)`,[sentinel.id]);
  child=fork(fileURLToPath(import.meta.url),['--child'],{cwd:f.root,execArgv:[],stdio:['ignore','inherit','inherit','ipc'],env:{...cleanEnvironment(),
   DATABASE_URL:url,JWT_SECRET:f.secret,RENDER2_FIXTURE_ROOT:f.root,RENDER2_FIXTURE_PORT:String(port),RENDER_DB_ENVIRONMENT:'test',
   PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'render2_fixture',PGDATABASE:'render2_local_test',PGOPTIONS:'-c statement_timeout=15000',
   RENDER_BACKGROUND_JOBS:'',RENDER_ALLOW_BACKGROUND_WRITES:'false',SETUP_DEMO_DATA:'false',MIA_SUPERVISOR_ENABLED:'false',TASK_COMPLETED_CLEANUP_ENABLED:'false',
   RENDER_BROWSER_SESSIONS:'true',RENDER_BROWSER_ORIGIN:origin,RENDER_BROWSER_ALLOW_LOCAL_HTTP:'true'}});
  exited=new Promise(resolve=>child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();}));
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Own child startup deadline')),20000);
   child.on('error',()=>{clearTimeout(timeout);reject(Error('Own HTTP child error'));});
   child.on('message',m=>{if(m?.type==='ready'){clearTimeout(timeout);resolve();}if(m?.type==='drop')console.log('QA402_201_DROPPED_AFTER_COMMIT',JSON.stringify(m.stats));});
   child.once('exit',()=>{clearTimeout(timeout);reject(Error('Own child exited'));});});
  tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);assert.equal(tables.length,109);
  timer=setTimeout(()=>{process.exitCode=1;void finish(true);},900000);process.once('SIGTERM',()=>void finish(true));process.once('SIGINT',()=>void finish(true));
  input=readline.createInterface({input:process.stdin});console.log('QA402_READY',JSON.stringify({root:f.root,url:origin+'/lista',build:entry,actor:'qa_luciano',title,text,
   commands:['baseline','checkdropped','checkverified','checkblock','finish','abort']}));
  input.on('line',line=>{chain=chain.then(async()=>{if(closed)return;const command=line.trim();
   if(command==='baseline'){assert.equal(baseline,undefined);assert.deepEqual(await f.query('SELECT id FROM listas_personales WHERE usuario_id=91003'),[]);
    privateBefore=await others();baseline=await snapshot();console.log('QA402_BASELINE_POSTLOGIN');}
   else if(command==='checkdropped'){await invariant();const s=await stats();assert.deepEqual(s,{pagePosts:1,page201:1,dropped:1,recoveryGets:0});first=await own();
    assert.equal(first.list.titulo,'Sin título');assert.equal(first.list.version,1);assert.deepEqual(await f.query('SELECT id FROM lista_bloques WHERE lista_id=$1',[first.list.id]),[]);
    console.log('QA402_DROPPED_COMMITTED',JSON.stringify({listId:first.list.id,requestId:first.receipt.request_id,stats:s}));}
   else if(command==='checkverified'){assert.ok(first);await invariant();assert.deepEqual(await own(),first);const s=await stats();assert.equal(s.pagePosts,1);assert.ok(s.recoveryGets>=1);verified=true;console.log('QA402_VERIFIED_NO_REPOST',JSON.stringify(s));}
   else if(command==='checkblock')await checkBlock();else if(command==='finish')await finish();else if(command==='abort')await finish(true);else throw Error('Unknown QA402 command');
  }).catch(async e=>{process.exitCode=1;console.error('QA402_COMMAND_FAILED',e.message);await finish(true);});});
 }catch(e){process.exitCode=1;console.error('QA402_STARTUP_FAILED',e.message);await finish(true);}
}
if(process.argv[2]==='--child')await childMain();
else if(process.argv.length===2&&process.env.RENDER2_RUN_LOCAL_INTEGRATION==='true')await main();
else{console.error('Explicit integration opt-in required');process.exitCode=2;}
