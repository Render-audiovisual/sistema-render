import assert from 'node:assert/strict';
import {access,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {startLocalHarness,assertFixtureIdentity,cleanEnvironment,request,fixturePassword} from './render2-local-test.js';

const repo=fileURLToPath(new URL('../..',import.meta.url)).replace(/\/$/,'');
const dist=repo+'/frontend/dist',pgPort=55886,httpPort=52841,origin=`http://127.0.0.1:${httpPort}`;
const identitySql=`SELECT current_database() AS database,current_user AS username,
  host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
const assetNamePattern=/^Projects-[A-Za-z0-9_-]+\.js$/;
async function httpChild(){
  const env=process.env;
  const identityGuard={root:env.RENDER2_FIXTURE_ROOT,cwd:process.cwd(),port:env.RENDER2_FIXTURE_PORT,url:env.DATABASE_URL};
  assertFixtureIdentity(identityGuard);
  assert.equal(env.RENDER2_FIXTURE_PORT,String(pgPort));assert.equal(env.DOTENV_CONFIG_PATH,'/dev/null');
  assert.equal(env.RENDER_DISABLE_SERVER_START,'true');assert.equal(env.RENDER_BROWSER_ORIGIN,origin);
  assert.equal(env.RENDER_BROWSER_SESSIONS,'true');assert.equal(env.RENDER_BROWSER_ALLOW_LOCAL_HTTP,'true');
  assert.equal(env.NODE_ENV,'test');assert.match(env.QA248_PROJECT_ASSET,assetNamePattern);
  globalThis.fetch=async()=>{throw Error('External fetch disabled in QA248 fixture');};
  const {pool}=await import(repo+'/backend/src/db.js');
  let server,closing=false,faultEnabled=true,faults=0,passes=0,disableCount=0;
  const send=value=>process.send?.(value);
  const shutdown=async()=>{
    if(closing)return;closing=true;
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await pool.end();send({type:'stopped',faults,passes,disableCount});process.disconnect?.();
  };
  try{
    assertFixtureIdentity({...identityGuard,identity:(await pool.query(identitySql)).rows[0]});
    const {app}=await import(repo+'/backend/src/server.js');
    const {default:express}=await import(repo+'/backend/node_modules/express/index.js');
    const outer=express(),assetPath='/assets/'+env.QA248_PROJECT_ASSET;
    await access(dist+assetPath);
    outer.use((req,res,next)=>{
      if(req.method==='GET'&&req.path===assetPath){
        if(faultEnabled){
          faults++;send({type:'asset-fault',count:faults});
          res.set('Cache-Control','no-store');res.type('application/javascript');
          return res.send('throw new Error("QA248_SYNTHETIC_LAZY_FAILURE_DO_NOT_RENDER");');
        }
        passes++;send({type:'asset-pass',count:passes});
      }
      next();
    });
    // All index/assets except one exact Projects module, and every API/auth
    // request, are handled unchanged by the actual principal application.
    outer.use(app);server=outer.listen(httpPort,'127.0.0.1');await once(server,'listening');
    process.on('message',message=>{
      if(message?.type==='disable-fault'&&disableCount===0){faultEnabled=false;disableCount=1;send({type:'fault-disabled'});}
      if(message?.type==='stop')void shutdown();
    });
    process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
    process.once('disconnect',()=>void shutdown());send({type:'ready'});
  }catch(error){await shutdown();throw error;}
}

async function parent(){
  const f=await startLocalHarness({port:pgPort,clusterOnly:true});
  let child,onDisable,childExited,exitInfo,stoppedMessage;
  let stop;const stopped=new Promise(resolve=>{stop=resolve;});
  const onStop=()=>stop();process.once('SIGTERM',onStop);process.once('SIGINT',onStop);
  let faults=0,passes=0,disabled=false,disableRequested=false;
  async function stopChild(){
    if(!child||exitInfo)return;
    if(child.connected)child.send({type:'stop'});else child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{await childExited;}finally{clearTimeout(timer);}
  }
  try{
    const url=`postgresql://render2_fixture@127.0.0.1:${pgPort}/render2_local_test`;
    assertFixtureIdentity({root:f.root,cwd:f.root,port:pgPort,url,identity:(await f.query(identitySql))[0]});
    const projectAssets=(await readdir(dist+'/assets')).filter(name=>assetNamePattern.test(name));
    assert.equal(projectAssets.length,1,'Require one exact built Projects JS module');const asset=projectAssets[0];
    const index=await readFile(dist+'/index.html','utf8');
    const entry=index.match(/<script\b[^>]*\bsrc="(\/assets\/[^"/]+\.js)"/);
    assert.ok(entry,'Actual build entry exists');
    assert.ok((await readFile(dist+entry[1],'utf8')).includes(asset),'Actual entry references the selected Projects chunk');
    const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
    const staticPaths=[dist+'/index.html',dist+entry[1],dist+'/assets/'+asset];
    const staticHashes=await Promise.all(staticPaths.map(hash));
    child=fork(fileURLToPath(import.meta.url),['--http-child'],{cwd:f.root,execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{
      ...cleanEnvironment(),DATABASE_URL:url,JWT_SECRET:f.secret,RENDER2_FIXTURE_ROOT:f.root,RENDER2_FIXTURE_PORT:String(pgPort),
      PGHOST:'127.0.0.1',PGPORT:String(pgPort),PGUSER:'render2_fixture',PGDATABASE:'render2_local_test',PGOPTIONS:'-c statement_timeout=15000',
      RENDER_DB_ENVIRONMENT:'test',RENDER_DISABLE_SERVER_START:'true',RENDER_BACKGROUND_JOBS:'',RENDER_ALLOW_BACKGROUND_WRITES:'false',
      SETUP_DEMO_DATA:'false',MIA_SUPERVISOR_ENABLED:'false',TASK_COMPLETED_CLEANUP_ENABLED:'false',
      RENDER_BROWSER_SESSIONS:'true',RENDER_BROWSER_ORIGIN:origin,RENDER_BROWSER_ALLOW_LOCAL_HTTP:'true',QA248_PROJECT_ASSET:asset,
    }});
    childExited=new Promise(resolve=>child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();stop();}));
    const ready=new Promise((resolve,reject)=>{
      child.on('message',message=>{
        if(message?.type==='ready')resolve();
        if(message?.type==='failed')reject(Error('Own HTTP child failed: '+message.code));
        if(message?.type==='asset-fault'){faults=message.count;console.log('PROJECT_ASSET_FAULT',faults);}
        if(message?.type==='asset-pass'){passes=message.count;console.log('PROJECT_ASSET_PASSTHROUGH',passes);}
        if(message?.type==='fault-disabled'){disabled=true;console.log('FAULT_DISABLED');}
        if(message?.type==='stopped')stoppedMessage=message;
      });
      child.once('error',()=>reject(Error('Own HTTP child could not start')));
      child.once('exit',()=>reject(Error('Own HTTP child exited before readiness')));
    });
    const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
    try{await ready;}finally{clearTimeout(timer);}
    const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected fixture HTTP status');return response.body;};
    const login=checked(await request(origin,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}}));
    const task=checked(await request(origin,'/api/tareas',{token:login.token,method:'POST',body:{
      titulo:'QA248 tarea original',aclaraciones:'QA248 brief original',asignado_a_id:91003,tipo_tarea:'edicion',
      workspace:'render_os',estado:'pendiente',fecha_vencimiento:'2026-10-28',colaborador_ids:[],
    }}),201);
    assert.equal(task.asignado_a_id,91003);assert.equal(task.revision,1);assert.deepEqual(task.colaborador_ids,[]);
    const deadline=Date.now()+5000;let settled=false;
    do{
      const rows=await f.query('SELECT tarea_id,motivo,detalles FROM mia_private_task_notifications ORDER BY id');
      assert.ok(rows.length<=1,'Unexpected setup notice count');
      if(rows.length===1){assert.deepEqual(rows.map(row=>({taskId:Number(row.tarea_id),reason:row.motivo,recipientId:row.detalles.destinatario_usuario_id,actorId:row.detalles.actor_usuario_id})),
        [{taskId:task.id,reason:'creada',recipientId:91003,actorId:91001}]);settled=true;break;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<deadline);
    assert.equal(settled,true,'Setup enqueue must settle within 5 seconds');
    const tableNames=async()=>(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
      .map(row=>row.tablename).filter(name=>!/^auth_|^browser_session/.test(name));
    const tables=await tableNames();assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
    assert.ok(tables.includes('usuarios'));assert.ok(tables.includes('mia_private_task_notifications'));
    async function snapshot(){const result={};for(const table of tables){
      result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
    }return result;}
    const before=await snapshot();
    onDisable=()=>{if(disableRequested)return;disableRequested=true;if(child.connected)child.send({type:'disable-fault'});};
    process.on('SIGUSR1',onDisable);
    console.log(JSON.stringify({ready:true,pid:process.pid,httpPid:child.pid,root:f.root,base:origin,
      url:`${origin}/workspace/tareas?task=${task.id}`,failedUrl:origin+'/proyectos',taskId:task.id,
      projectAsset:asset,tableCount:tables.length,scope:'actual App/principal cookie API; one transport-level Projects module fault only'}));
    await stopped;await stopChild();
    assert.equal(exitInfo.code,0,'HTTP child must stop cleanly');assert.ok(stoppedMessage,'Child must acknowledge resource cleanup');
    assert.ok(faults>=1,'QA must request the controlled failing Projects module');
    assert.equal(disabled,true,'QA must disable the transport fault with one SIGUSR1');
    assert.equal(stoppedMessage.disableCount,1);assert.ok(passes>=1,'QA must reload and request the real Projects module after disable');
    assert.deepEqual(await tableNames(),tables);
    const after=await snapshot();assert.deepEqual(tables.filter(name=>after[name]!==before[name]),[],
      'Navigation/failure/recovery must not change business tables, including task, users and setup notification');
    assert.deepEqual(await Promise.all(staticPaths.map(hash)),staticHashes,'Canonical dist files must remain unchanged');
    console.log('ALL_PUBLIC_HASHES_STABLE; DIST_HASHES_UNCHANGED',tables.length);
    console.log('ASSET_COUNTS',JSON.stringify({faults,passes,disabled}));
    // CUA owns visual/guard/focus assertions. SQL proves no extra DML, not that
    // Keep/Discard or unsaved text preservation was exercised by the browser.
  }finally{
    if(onDisable)process.removeListener('SIGUSR1',onDisable);
    process.removeListener('SIGTERM',onStop);process.removeListener('SIGINT',onStop);
    await stopChild();await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    console.log('FIXTURE_CLEANUP_ENOENT',f.root);
  }
}
// Importing the command never provisions a fixture or opens a listener.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--http-child')){
    console.error('Usage: RENDER2_RUN_LOCAL_INTEGRATION=true node backend/scripts/render2-shell-recovery-qa.js');
    process.exitCode=2;
  }else if(args[0]==='--http-child'){
    // Private fork entry: exact fresh-root/URL/origin guards run before db import.
    if(typeof process.send!=='function'||!process.connected){
      console.error('Private fixture child requires an IPC owner; no fixture started.');process.exitCode=2;
    }else await httpChild().catch(error=>{if(process.connected)process.send?.({type:'failed',code:error.code||error.name});process.exitCode=1;});
  }else if(process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true'){
    console.error('Requires RENDER2_RUN_LOCAL_INTEGRATION=true; no fixture started.');
    process.exitCode=2;
  }else await parent();
}
