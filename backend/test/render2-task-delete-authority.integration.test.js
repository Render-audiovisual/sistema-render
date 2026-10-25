import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity,fixturePassword,request} from '../scripts/render2-local-test.js';

test('task DELETE retains current admin authority through commit and preserves linked history',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
  const port=55955,f=await startLocalHarness({port});
  const connections=new Set(),operations=new Set();
  t.after(async()=>{
    try{
      await Promise.all([...connections].map(db=>db.query('ROLLBACK').catch(()=>{})));
      await Promise.allSettled([...operations]);await Promise.all([...connections].map(db=>db.end()));
    }finally{
      await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic('Owned DELETE PG55955/API stopped and removed.');
    }
  });
  const identitySql=`SELECT current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,
    inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=identity=>assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  guard((await f.query(identitySql))[0]);
  async function auxiliary(){
    const db=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,
      application_name:'render2_qa347_delete',statement_timeout:20000,lock_timeout:18000,connectionTimeoutMillis:5000});
    await db.connect();connections.add(db);guard((await db.query(identitySql)).rows[0]);
    db.pid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return db;
  }
  async function dispose(db){try{await db.query('ROLLBACK').catch(()=>{});}finally{await db.end();connections.delete(db);}}
  function observe(promise){operations.add(promise);const pending={promise,settled:false};
    promise.then(()=>{pending.settled=true;},()=>{pending.settled=true;});return pending;}
  const monitor=await auxiliary();
  async function edge(blocker,pending,stage,waiter){
    const deadline=Date.now()+7000;
    do{
      assert.equal(pending.settled,false,'Request ended before required PostgreSQL blocking edge');
      const {rows}=await monitor.query(`SELECT pid,query ILIKE '%FROM usuarios%FOR SHARE%' AS actor,
        query ILIKE '%DELETE FROM tareas%' AS deletion
        FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))
        AND (($2::int IS NOT NULL AND pid=$2) OR ($2::int IS NULL AND pid<>ALL($3::int[])))`,
      [blocker,waiter??null,[...connections].map(db=>db.pid)]);
      if(rows.length){assert.equal(rows.length,1);if(stage)assert.equal(rows[0][stage],true);return rows[0].pid;}
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge not observed within seven seconds');
  }
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 91005,'qa_delete_admin','QA347 Admin','admin',password_hash,true,1 FROM usuarios WHERE id=91003`);
  async function login(usuario,id){
    const response=await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}});
    assert.equal(response.status,200,'Login status only; no credentials in assertions');assert.equal(response.body.usuario.id,id);
    assert.equal(typeof response.body.token,'string');return response.body.token;
  }
  const admin=await login('qa_delete_admin',91005),member=await login('qa_luciano',91003);
  const reset=()=>f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=91005");
  async function remove(id,{token=admin,workspace=true}={}){
    const response=await fetch(new URL(`/api/tareas/${id}${workspace?'?workspace=render_os':''}`,f.base),{
      method:'DELETE',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`}});
    return {status:response.status,body:await response.json()};
  }
  let serial=0;
  async function task(workspace='render_os'){
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
      VALUES($1,'QA347 Admin','desarrollo','pendiente',$2::jsonb) RETURNING id`,
    [`QA347 disposable ${++serial}`,JSON.stringify(workspace===null?{qa347:'preserve'}:{workspace,qa347:'preserve'})]);return row;
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){
    const hashes={};for(const table of tables.filter(name=>!excluded.includes(name)))hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`))[0].hash;
    return hashes;
  }
  const otherTasks=async id=>(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
    ORDER BY id)::text,'[]')) AS hash FROM tareas r WHERE id<>$1`,[id]))[0].hash;
  const privateActor=async()=>(await f.query(`SELECT md5((to_jsonb(u)-'activo'-'rol'-'session_version'-'user_admin_version')::text) AS hash
    FROM usuarios u WHERE id=91005`))[0].hash;
  const otherUsers=async()=>(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text)
    ORDER BY id)::text,'[]')) AS hash FROM usuarios u WHERE id<>91005`))[0].hash;
  await t.test('ordinary authenticated member cannot delete even an assigned task',async()=>{
    const row=await task();await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[row.id]);
    const before=await snapshot();assert.equal((await remove(row.id,{token:member})).status,403);assert.deepEqual(await snapshot(),before);
  });
  await t.test('current admin deletes one disposable task and no other domain rows',async()=>{
    const row=await task(),before=await snapshot(['tareas']),others=await otherTasks(row.id);
    const result=await remove(row.id);assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true});
    assert.deepEqual(await f.query('SELECT id FROM tareas WHERE id=$1',[row.id]),[]);
    assert.equal(await otherTasks(row.id),others);assert.deepEqual(await snapshot(['tareas']),before);
  });
  await t.test('ambiguous numeric identifiers are400 without deleting their numeric aliases',async()=>{
    const row=await task(),before=await snapshot();
    for(const id of [`${row.id}e0`,`0x${row.id.toString(16)}`,`${row.id}.0`,`0${row.id}`,0,-1,2147483648])
      assert.equal((await remove(id)).status,400);
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('repeated workspace cannot silently broaden a render_os deletion',async()=>{
    const row=await task(null),before=await snapshot();
    const response=await fetch(new URL(`/api/tareas/${row.id}?workspace=render_os&workspace=render_os`,f.base),{
      method:'DELETE',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${admin}`}});
    assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'Contexto de tarea inválido.'});
    assert.deepEqual(await snapshot(),before);
  });
  for(const [name,change] of [['inactive','activo=false'],['session','session_version=2'],['role',"rol='produccion'"]]){
    await t.test(`committed ${name} revocation wins before retained actor read with no DELETE or cascading DML`,async()=>{
      await reset();const row=await task(),before=await snapshot(['usuarios']),privateBefore=await privateActor(),others=await otherUsers();
      const revoker=await auxiliary();let pending;
      try{
        await revoker.query('BEGIN');await revoker.query('SELECT id FROM usuarios WHERE id=91005 FOR UPDATE');
        await revoker.query(`UPDATE usuarios SET ${change} WHERE id=91005`);
        pending=observe(remove(row.id));await edge(revoker.pid,pending,'actor');await revoker.query('COMMIT');
        const result=await pending.promise;assert.ok([401,403].includes(result.status));assert.deepEqual(Object.keys(result.body),['error']);
        assert.deepEqual(await snapshot(['usuarios']),before);assert.equal(await privateActor(),privateBefore);assert.equal(await otherUsers(),others);
      }finally{
        await revoker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);await dispose(revoker);await reset();
      }
    });
  }
  await t.test('retained admin SHARE makes revocation wait until DELETE commits',async()=>{
    const row=await task(),before=await snapshot(['usuarios','tareas']),others=await otherTasks(row.id);
    const privateBefore=await privateActor(),otherUsersBefore=await otherUsers();
    const stopper=await auxiliary(),revoker=await auxiliary();let pending,revoke;
    try{
      await stopper.query('BEGIN');await stopper.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[row.id]);
      pending=observe(remove(row.id));const writer=await edge(stopper.pid,pending,'deletion');
      await revoker.query('BEGIN');revoke=observe(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=91005'));
      await edge(writer,revoke,null,revoker.pid);await stopper.query('COMMIT');
      const result=await pending.promise;await revoke.promise;await revoker.query('COMMIT');
      assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true});assert.deepEqual(await f.query('SELECT id FROM tareas WHERE id=$1',[row.id]),[]);
      assert.deepEqual(await snapshot(['usuarios','tareas']),before);assert.equal(await otherTasks(row.id),others);
      assert.equal(await privateActor(),privateBefore);assert.equal(await otherUsers(),otherUsersBefore);
      assert.equal((await f.query('SELECT session_version FROM usuarios WHERE id=91005'))[0].session_version,2);
    }finally{
      await stopper.query('ROLLBACK').catch(()=>{});if(revoke)await Promise.allSettled([revoke.promise]);
      await revoker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);
      await dispose(stopper);await dispose(revoker);await reset();
    }
  });
  await t.test('render_os mismatch and absent ID are404 without writes; no-query historical admin semantics remain',async()=>{
    const historical=await task(null),before=await snapshot();
    assert.equal((await remove(historical.id)).status,404);assert.equal((await remove(2147483647)).status,404);
    assert.deepEqual(await snapshot(),before);
    const others=await otherTasks(historical.id),side=await snapshot(['tareas']);
    assert.equal((await remove(historical.id,{workspace:false})).status,200);
    assert.deepEqual(await f.query('SELECT id FROM tareas WHERE id=$1',[historical.id]),[]);
    assert.equal(await otherTasks(historical.id),others);assert.deepEqual(await snapshot(['tareas']),side);
  });
  await t.test('canonical origin FK returns409 and rolls back any attempted task/assignment/comment deletion',async()=>{
    const row=await task();
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[row.id]);
    await f.query("INSERT INTO tarea_comentarios(tarea_id,autor,contenido,actor_usuario_id) VALUES($1,'QA347 history','Must survive rejected DELETE',91003)",[row.id]);
    const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA347 linked history',true) RETURNING id");
    await f.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
      VALUES($1,$2,$3,'2026-10-25','QA347 retained visit',91005,91005)`,[randomUUID(),row.id,client.id]);
    const before=await snapshot(),result=await remove(row.id);
    assert.equal(result.status,409);assert.deepEqual(result.body,{error:'La tarea tiene registros vinculados. Conservá su historial; no se puede eliminar.'});
    assert.deepEqual(await snapshot(),before);
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
});
