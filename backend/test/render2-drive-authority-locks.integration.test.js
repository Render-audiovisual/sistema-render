import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {startDriveHttpFixture} from './helpers/drive-http-fixture.js';
import {assertFixtureIdentity} from '../scripts/render2-local-test.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve};};
test('Drive authority locks linearize actual actor/assignment revocation around one simulated chunk',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  let chunks=0,serial=0,chunkGate=null,chunkEntered=null,providerPid=null;
  const sessions=new Map(),parentId='qa104-folder-0001';
  const providerFactory=async({db})=>({
    status:async()=>({configured:true,connected:true,reconnectRequired:false}),
    listChildren:async()=>({files:[]}),
    startUpload:async({name,mimeType,size,parentId:parent})=>{
      const id=`qa104-file-${++serial}`,uploadUrl=`https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`;
      sessions.set(uploadUrl,{id,name,mimeType,size:String(size),parents:[parent],webViewLink:`https://drive.google.com/file/d/${id}/view`});
      return{uploadUrl};
    },
    uploadChunk:async({uploadUrl})=>{providerPid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;chunks++;if(chunkEntered){chunkEntered.entered=true;chunkEntered.resolve();}if(chunkGate)await chunkGate.promise;return{status:200,file:sessions.get(uploadUrl)};},
    trashFile:async()=>assert.fail('This task upload must never trash a file'),
  });
  const f=await startDriveHttpFixture({port:55739,driveRouterOptions:{providerFactory}});
  t.after(()=>f.cleanup());
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA104 authority fixture',true) RETURNING id");
  const seed=async()=>{
    const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
      VALUES('QA104 own task','Luciano QA',$1,'edicion','pendiente','{"workspace":"render_os"}'::jsonb) RETURNING id`,[client.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[task.id]);return task;
  };
  const start=async task=>{
    const token=await f.tokenFor(91003),r=await f.api('/uploads',{token,method:'POST',body:{name:'synthetic.bin',mimeType:'application/octet-stream',size:1,parentId,taskId:task.id,duplicateAction:''}});
    assert.equal(r.status,201,'Owner must obtain a bound upload intent');assert.equal(typeof r.body.token,'string');return{token,intent:r.body.token};
  };
  const chunk=session=>f.api(`/uploads/${encodeURIComponent(session.intent)}`,{token:session.token,method:'PUT',body:Buffer.from([1]),raw:true,range:'bytes 0-0/1'});
  const barrier=async()=>{
    const url='postgresql://render2_fixture@127.0.0.1:55739/render2_local_test',connection=new pg.Client({connectionString:url});
    await connection.connect();const identity=(await connection.query(`SELECT current_database() database,current_user username,
      host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
    assertFixtureIdentity({root:f.root,cwd:f.root,port:55739,url,identity});return connection;
  };
  const waitFor=async predicate=>{const deadline=Date.now()+2500;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}assert.fail('Expected real PostgreSQL lock wait not observed');};
  const snapshot=async id=>(await f.query('SELECT revision,material_referencia,propiedades_extra FROM tareas WHERE id=$1',[id]))[0];

  await t.test('epoch revocation committed before waiting actor lock prevents any provider chunk or attachment',async()=>{
    const task=await seed(),session=await start(task),before=await snapshot(task.id),count=chunks,b=await barrier();let pending;
    try{
      await b.query('BEGIN');const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await b.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');pending=chunk(session);
      await waitFor(async()=>(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%usuarios%' AND datname='render2_local_test'",[pid])).rowCount>0);
      await b.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');await b.query('COMMIT');
      assert.equal((await pending).status,401);assert.equal(chunks,count);assert.deepEqual(await snapshot(task.id),before);
    }finally{await b.query('ROLLBACK').catch(()=>{});await Promise.allSettled([pending].filter(Boolean));await b.end();}
  });
  await t.test('assignment removal committed before waiting task lock prevents any provider chunk or attachment',async()=>{
    const task=await seed(),session=await start(task),before=await snapshot(task.id),count=chunks,b=await barrier();let pending;
    try{
      await b.query('BEGIN');const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await b.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);pending=chunk(session);
      await waitFor(async()=>(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR UPDATE OF t%' AND datname='render2_local_test'",[pid])).rowCount>0);
      await b.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[task.id]);await b.query('COMMIT');
      assert.equal((await pending).status,403);assert.equal(chunks,count);assert.deepEqual(await snapshot(task.id),before);
    }finally{await b.query('ROLLBACK').catch(()=>{});await Promise.allSettled([pending].filter(Boolean));await b.end();}
  });
  await t.test('an already authorized bounded chunk holds assignment through commit; later chunks lose authority',async()=>{
    const task=await seed(),session=await start(task),b=await barrier();let pending,removal;
    chunkGate=deferred();chunkEntered=deferred();
    try{
      let ended=false;pending=chunk(session).finally(()=>{ended=true;});
      await waitFor(async()=>{if(ended)assert.fail('HTTP ended before reaching simulated provider');return chunkEntered.entered===true;});
      await b.query('BEGIN');const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      removal=b.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[task.id]);
      await waitFor(async()=>(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND $2::int=ANY(pg_blocking_pids(pid)) AND datname='render2_local_test'",[pid,providerPid])).rowCount>0);
      chunkGate.resolve();assert.equal((await pending).status,200);await removal;await b.query('COMMIT');
      const saved=await snapshot(task.id);assert.equal(saved.propiedades_extra.drive_archivos.length,1);
      const count=chunks;assert.equal((await chunk(session)).status,403);assert.equal(chunks,count);assert.deepEqual(await snapshot(task.id),saved);
    }finally{chunkGate?.resolve();await Promise.allSettled([pending,removal].filter(Boolean));await b.query('ROLLBACK').catch(()=>{});await b.end();chunkGate=null;chunkEntered=null;}
  });
  await t.test('an authorized chunk holds the actual actor until attachment commits; a waiting revocation then wins',async()=>{
    const task=await seed(),session=await start(task),b=await barrier();let pending,revocation;
    chunkGate=deferred();chunkEntered=deferred();
    try{
      let ended=false;pending=chunk(session).finally(()=>{ended=true;});
      await waitFor(async()=>{if(ended)assert.fail('HTTP ended before reaching simulated provider');return chunkEntered.entered===true;});
      await b.query('BEGIN');const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      revocation=b.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
      await waitFor(async()=>(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND $2::int=ANY(pg_blocking_pids(pid)) AND datname='render2_local_test'",[pid,providerPid])).rowCount>0);
      chunkGate.resolve();assert.equal((await pending).status,200);await revocation;await b.query('COMMIT');
      const saved=await snapshot(task.id);assert.equal(saved.propiedades_extra.drive_archivos.length,1);
      const count=chunks;assert.equal((await chunk(session)).status,401);assert.equal(chunks,count);assert.deepEqual(await snapshot(task.id),saved);
    }finally{chunkGate?.resolve();await Promise.allSettled([pending,revocation].filter(Boolean));await b.query('ROLLBACK').catch(()=>{});await b.end();chunkGate=null;chunkEntered=null;}
  });
});
