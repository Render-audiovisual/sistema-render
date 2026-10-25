import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('a video edit queued before closure invalidates the observed visit without closing or publishing', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true', timeout:180000,
}, async t => {
  const port=55937, f=await startLocalHarness({port}), connections=new Set();
  t.after(async()=>{
    for(const c of connections)await c.query('ROLLBACK').catch(()=>{});
    await Promise.all([...connections].map(c=>c.end()));
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Owned edit/closure race fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const guard=db=>assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:db});
  guard((await f.query(identitySql))[0]);
  async function auxiliary(){
    const c=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,
      application_name:'render2_qa317_edit_close',statement_timeout:15000,lock_timeout:12000,connectionTimeoutMillis:5000});
    await c.connect();connections.add(c);guard((await c.query(identitySql)).rows[0]);
    c.pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return c;
  }
  const monitor=await auxiliary(),blocker=await auxiliary();
  const logged=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}});
  assert.equal(logged.status,200);
  const api=async(path,method='GET',body)=>{
    const response=await fetch(new URL('/api'+path,f.base),{method,signal:AbortSignal.timeout(20000),
      headers:{authorization:`Bearer ${logged.body.token}`,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA317 edit closure',true) RETURNING id");
  const created=await api('/tareas','POST',{request_id:randomUUID(),workspace:'render_os',titulo:'QA317 Visita concurrente',
    asignado_a_id:91001,colaborador_ids:[],cliente_id:client.id,tipo_tarea:'produccion',fecha_vencimiento:'2026-10-29',produccion_videos_previstos:3});
  assert.equal(created.status,201);const task=created.body.task;
  let visit=(await f.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1',[task.id]))[0];
  for(let i=1;i<=3;i++){
    const added=await api(`/producciones/${visit.id}/videos`,'POST',{expected_revision:visit.revision,titulo:`QA317 Video ${i}`,estado:'grabado',guion:'Original'});
    assert.equal(added.status,201);visit=added.body.visita;
  }
  const video=visit.videos[0];
  const context=await api(`/producciones/tareas/${task.id}`);assert.equal(context.status,200);
  assert.equal(context.body.vinculo.finalizacion.habilitada,true);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){
    const result={};for(const table of tables.filter(name=>!excluded.includes(name))){
      const [row]=await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`);result[table]=row.hash;
    }return result;
  }
  const before=await snapshot(['produccion_videos','produccion_visitas']);
  const observe=promise=>{const state={promise,settled:false};promise.then(value=>{state.value=value;state.settled=true;},error=>{state.error=error;state.settled=true;});return state;};
  async function waitEdge(blockingPid,pattern,pending){
    const until=Date.now()+5000;
    do{
      assert.equal(pending.settled,false,'Operation completed before the required PostgreSQL wait');
      const result=await monitor.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE $2`,[blockingPid,pattern]);
      if(result.rows.length===1)return result.rows[0].pid;
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<until);
    assert.fail('Required PostgreSQL blocking edge was not observed');
  }
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);
  const edit=observe(api(`/producciones/${visit.id}/videos/${video.id}`,'PATCH',{expected_revision:visit.revision,guion:'Updated while still recorded'}));
  const editorPid=await waitEdge(blocker.pid,'SELECT id FROM tareas WHERE id=ANY%',edit);
  const close=observe(api(`/tareas/${task.id}?workspace=render_os`,'PATCH',{estado:'finalizada',expected_revision:task.revision,
    expected_production_visit:{id:visit.id,revision:visit.revision}}));
  await waitEdge(editorPid,'UPDATE tareas AS t SET%',close);
  await blocker.query('COMMIT');
  const [edited,closed]=await Promise.all([edit.promise,close.promise]);
  assert.equal(edited.status,200);assert.equal(edited.body.visita.revision,visit.revision+1);
  assert.ok(edited.body.visita.videos.every(item=>item.estado==='grabado'));
  assert.equal(closed.status,409);assert.deepEqual(Object.keys(closed.body),['error']);
  assert.deepEqual(await snapshot(['produccion_videos','produccion_visitas']),before);
  const [persisted]=await f.query('SELECT estado,revision FROM tareas WHERE id=$1',[task.id]);
  assert.deepEqual(persisted,{estado:'pendiente',revision:task.revision});
  const refreshed=await api(`/producciones/tareas/${task.id}`);
  assert.equal(refreshed.body.vinculo.revision,visit.revision+1);assert.equal(refreshed.body.vinculo.finalizacion.habilitada,true);
  t.diagnostic('Observed edit→blocker and close→editor lock edges; stale closure409; no other domain DML.');
});
