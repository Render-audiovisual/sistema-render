import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';
import {apiSubtasks} from '../../frontend/src/features/render-os/services/render-os-api.js';

test('actual frontend subtask reader accepts genuine role-safe PostgreSQL task hierarchy without writes',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:120000,
},async t=>{
  const port=55957,f=await startLocalHarness({port}),directFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=directFetch;await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');t.diagnostic('Owned subtask consumer PG55957/API removed.');});
  const [identity]=await f.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  const tokens={};for(const user of ['qa_franco','qa_luciano']){
    const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:user,password:fixturePassword}});
    assert.equal(login.status,200);tokens[user]=login.body.token;
  }
  async function task(title,parent=null,state='pendiente'){
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,tarea_padre_id,propiedades_extra)
      VALUES($1,'Luciano QA',$2,'desarrollo',$3,'{"workspace":"render_os"}') RETURNING id`,[title,state,parent]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[row.id]);return row;
  }
  const parent=await task('QA355 parent'),other=await task('QA355 other parent');
  const emptyTitle=await task('',parent.id,'programada'),child=await task('QA355 child',parent.id);
  const foreign=await task('QA355 foreign child',other.id),emptyParent=await task('QA355 empty parent');
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  const snapshot=async()=>{const hashes={};for(const name of tables){assert.match(name,/^[a-z_][a-z0-9_]*$/);
    hashes[name]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(t),xmin::text,ctid::text) ORDER BY to_jsonb(t)::text)::text,'[]')) hash FROM "${name}" t`))[0].hash;}return hashes;};
  const before=await snapshot();let calls=0;
  globalThis.fetch=(url,options)=>{
    assert.equal(typeof url,'string');assert.match(url,/^\/api\/tareas\/[1-9]\d*\/subtareas\?workspace=render_os$/);
    assert.equal(options.method,'GET');calls++;return directFetch(new URL(url,f.base),options);
  };
  for(const user of ['qa_franco','qa_luciano'])await t.test(`${user}: real DTO passes strict parent-bound reader and preserves historical text/state`,async()=>{
    const rows=await apiSubtasks(parent.id,{method:'GET',headers:{authorization:`Bearer ${tokens[user]}`}});
    assert.deepEqual(rows.map(row=>row.id),[emptyTitle.id,child.id]);assert.ok(!rows.some(row=>row.id===foreign.id));
    assert.ok(rows.every(row=>row.tarea_padre_id===parent.id&&row.revision===1&&row.asignado_a_id===91003));
    assert.equal(rows[0].titulo,'');assert.equal(rows[0].estado,'programada');
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('genuine empty collection is accepted without borrowing another parent',async()=>{
    assert.deepEqual(await apiSubtasks(emptyParent.id,{method:'GET',headers:{authorization:`Bearer ${tokens.qa_luciano}`}}),[]);
    assert.equal(calls,3);assert.deepEqual(await snapshot(),before);
  });
});
