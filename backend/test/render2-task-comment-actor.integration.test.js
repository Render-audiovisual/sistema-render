import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity,fixturePassword,request} from '../scripts/render2-local-test.js';

test('human task comments persist verified actor IDs without guessing historical or system authors',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
  const port=55952,f=await startLocalHarness({port});let db;
  t.after(async()=>{
    try{await db?.end();}finally{
      await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic('Owned comment actor PG55952/API stopped and removed.');
    }
  });
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=identity=>assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  guard((await f.query(identitySql))[0]);
  db=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,
    application_name:'render2_qa345_comment_actor',statement_timeout:20000,lock_timeout:18000,connectionTimeoutMillis:5000});
  await db.connect();guard((await db.query(identitySql)).rows[0]);
  const api=(path,token,method='GET',body)=>request(f.base,'/api'+path,{token,method,body});
  const checked=(result,status=200)=>{assert.equal(result.status,status,'HTTP status only; never print credentials');return result.body;};
  const login=async usuario=>checked(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const admin=await login('qa_franco'),staff=await login('qa_luciano');
  const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
    VALUES('QA345 comment history','Luciano QA','desarrollo','pendiente','{"workspace":"render_os"}'::jsonb) RETURNING id`);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[task.id]);
  const [adminTask]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
    VALUES('QA345 admin comment history','Franco QA','desarrollo','pendiente','{"workspace":"render_os"}'::jsonb) RETURNING id`);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'responsable')",[adminTask.id]);
  // Genuine identity-unknown rows: exactly the legacy/MIA insert shape. These
  // fixtures do not claim a pre092 upgrade or execution of the MIA scheduler.
  const historical=await f.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido)
    VALUES($1,'Luciano QA','QA345 historical label, identity unknown'),
      ($1,'Mía · Supervisor','QA345 synthetic system comment') RETURNING *`,[task.id]);
  const path=`/tareas/${task.id}/comentarios`,post=(body,token=staff)=>api(path+'?workspace=render_os',token,'POST',body);
  const recover=(key,token=staff)=>api(path+`/solicitudes/${key}?workspace=render_os`,token);
  const list=async()=>checked(await api(path+'?workspace=render_os',admin));
  const comments=()=>f.query('SELECT to_jsonb(c) AS row FROM tarea_comentarios c ORDER BY id');
  const receipts=()=>f.query('SELECT to_jsonb(r) AS row FROM task_comment_create_receipts r ORDER BY actor_user_id,request_id');
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){
    const hashes={};for(const table of tables.filter(name=>!excluded.includes(name)))hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`))[0].hash;
    return hashes;
  }
  const sideTables=['tarea_comentarios','task_comment_create_receipts'];
  const baseline=await snapshot(sideTables);
  const created=[];
  await t.test('new UUID comment stores retained actor despite forged body identity and free staff author',async()=>{
    const key=randomUUID(),body={request_id:key,autor:'Forged actor name',actor_usuario_id:91001,actor_id:91004,
      usuario_id:91001,contenido:'QA345 UUID verified author'};
    const result=checked(await post(body),201);created.push(result);
    assert.equal(result.actor_usuario_id,91003);assert.equal(result.autor,'Luciano QA');assert.equal(result.creation_request_id,key);
    const [stored]=await f.query('SELECT * FROM tarea_comentarios WHERE id=$1',[result.id]);
    assert.equal(stored.actor_usuario_id,91003);assert.equal(stored.autor,'Luciano QA');assert.equal(stored.contenido,body.contenido);
    const [receipt]=await f.query('SELECT actor_user_id,comment_id FROM task_comment_create_receipts WHERE request_id=$1',[key]);
    assert.deepEqual(receipt,{actor_user_id:91003,comment_id:result.id});
    assert.deepEqual(await snapshot(sideTables),baseline);
  });
  await t.test('activity without UUID stores actor with no receipt and ignores forged ID',async()=>{
    const before=await receipts();
    const result=checked(await post({autor:'Impersonated admin',actor_usuario_id:91001,contenido:'[Actividad] QA345 moved task'}),201);created.push(result);
    assert.equal(result.actor_usuario_id,91003);assert.equal(result.autor,'Luciano QA');assert.equal(Object.hasOwn(result,'creation_request_id'),false);
    assert.equal((await f.query('SELECT actor_usuario_id FROM tarea_comentarios WHERE id=$1',[result.id]))[0].actor_usuario_id,91003);
    assert.deepEqual(await receipts(),before);assert.deepEqual(await snapshot(sideTables),baseline);
  });
  await t.test('admin free historical author stays distinct from durable actor',async()=>{
    // Self-assignment prevents unrelated notification enqueueing. Do not widen
    // the domain snapshot exclusions to hide normal notification side effects.
    const result=checked(await api(`/tareas/${adminTask.id}/comentarios?workspace=render_os`,admin,'POST',
      {request_id:randomUUID(),autor:'External historical attribution',actor_usuario_id:91003,
      contenido:'QA345 administrative free author'}),201);
    assert.equal(result.autor,'External historical attribution');assert.equal(result.actor_usuario_id,91001);
    assert.equal((await f.query('SELECT actor_usuario_id FROM tarea_comentarios WHERE id=$1',[result.id]))[0].actor_usuario_id,91001);
    assert.equal(checked(await api(`/tareas/${adminTask.id}/comentarios?workspace=render_os`,admin))[0].actor_usuario_id,91001);
    assert.deepEqual(await snapshot(sideTables),baseline);
  });
  await t.test('same UUID replay/concurrency and own recovery preserve ID with no additional business writes',async()=>{
    const key=randomUUID(),body={request_id:key,autor:'Ignored staff label',contenido:'QA345 recoverable provenance'};
    const results=await Promise.all([post(body),post(body),post(body)]);
    assert.deepEqual(results.map(result=>result.status).sort(),[200,200,201]);
    const first=results[0].body;created.push(first);assert.equal(first.actor_usuario_id,91003);
    for(const result of results)assert.deepEqual(result.body,first);
    const before=await snapshot();
    assert.deepEqual(checked(await post(body)),first);assert.deepEqual(checked(await recover(key)),first);
    checked(await recover(key,admin),404);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual((await list()).find(row=>row.id===first.id),Object.fromEntries(Object.entries(first).filter(([key])=>key!=='creation_request_id')));
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(await snapshot(sideTables),baseline);
  });
  await t.test('historical and system labels remain null in SQL and real GET, even when a current name matches',async()=>{
    const before=await snapshot(),rows=await list();
    for(const original of historical){
      assert.equal(original.actor_usuario_id,null);
      const observed=rows.find(row=>row.id===original.id);assert.ok(observed);
      assert.equal(observed.actor_usuario_id,null);assert.equal(observed.autor,original.autor);assert.equal(observed.contenido,original.contenido);
      assert.deepEqual((await f.query('SELECT * FROM tarea_comentarios WHERE id=$1',[original.id]))[0],original);
    }
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('rename and deactivate do not rewrite authors/actor IDs or history; independent admin still reads',async()=>{
    const before=await snapshot(['usuarios']),beforeComments=await comments(),beforeReceipts=await receipts();
    const [actor]=await f.query('SELECT nombre,activo FROM usuarios WHERE id=91003');
    const otherUsers=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text)
      ORDER BY id)::text,'[]')) AS hash FROM usuarios u WHERE id<>91003`))[0].hash;
    try{
      await f.query("UPDATE usuarios SET nombre='QA345 renamed actor' WHERE id=91003");
      let rows=await list();for(const original of created){const row=rows.find(row=>row.id===original.id);assert.equal(row.actor_usuario_id,original.actor_usuario_id);assert.equal(row.autor,original.autor);}
      await f.query('UPDATE usuarios SET activo=false WHERE id=91003');rows=await list();
      for(const original of created){const row=rows.find(row=>row.id===original.id);assert.equal(row.actor_usuario_id,original.actor_usuario_id);assert.equal(row.autor,original.autor);}
      checked(await post({contenido:'QA345 disabled actor must not write'}),401);
      assert.deepEqual(await comments(),beforeComments);assert.deepEqual(await receipts(),beforeReceipts);
      assert.deepEqual(await snapshot(['usuarios']),before);
      assert.equal((await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text)
        ORDER BY id)::text,'[]')) AS hash FROM usuarios u WHERE id<>91003`))[0].hash,otherUsers);
    }finally{await f.query('UPDATE usuarios SET nombre=$1,activo=$2 WHERE id=91003',[actor.nombre,actor.activo]);}
  });
  await t.test('receipt failure rolls back the actor-bound comment; exact retry commits one comment and one receipt',async()=>{
    const key=randomUUID(),body={request_id:key,autor:'QA345 rollback author',contenido:'QA345 atomic actor receipt'};
    const postOwn=()=>api(`/tareas/${adminTask.id}/comentarios?workspace=render_os`,admin,'POST',body);
    // Only this owned actor/task/UUID can hit the fault. No shared or business
    // trigger is replaced, and cleanup removes this fixture-only function.
    await db.query(`CREATE FUNCTION qa345_fail_comment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.actor_user_id=91001 AND NEW.tarea_id=${adminTask.id} AND NEW.request_id='${key}'::uuid THEN
          RAISE EXCEPTION 'QA345 controlled receipt fault' USING ERRCODE='P0001';
        END IF;
        RETURN NEW;
      END $$`);
    try{
      await db.query(`CREATE TRIGGER qa345_fail_comment_receipt BEFORE INSERT ON task_comment_create_receipts
        FOR EACH ROW EXECUTE FUNCTION qa345_fail_comment_receipt()`);
      const before=await snapshot();
      checked(await postOwn(),500);
      assert.deepEqual(await snapshot(),before,'No table row, including actor-bound comment, survives failed receipt');
      assert.deepEqual(await f.query('SELECT comment_id FROM task_comment_create_receipts WHERE actor_user_id=91001 AND request_id=$1',[key]),[]);
      assert.deepEqual(await f.query('SELECT id FROM tarea_comentarios WHERE tarea_id=$1 AND contenido=$2',[adminTask.id,body.contenido]),[]);
    }finally{
      await db.query('DROP TRIGGER IF EXISTS qa345_fail_comment_receipt ON task_comment_create_receipts');
      await db.query('DROP FUNCTION qa345_fail_comment_receipt()');
    }
    const before=await snapshot(sideTables),result=checked(await postOwn(),201);
    assert.equal(result.actor_usuario_id,91001);assert.equal(result.autor,body.autor);assert.equal(result.creation_request_id,key);
    assert.deepEqual(await f.query('SELECT id,actor_usuario_id FROM tarea_comentarios WHERE tarea_id=$1 AND contenido=$2',[adminTask.id,body.contenido]),
      [{id:result.id,actor_usuario_id:91001}]);
    assert.deepEqual(await f.query('SELECT comment_id,actor_user_id FROM task_comment_create_receipts WHERE actor_user_id=91001 AND request_id=$1',[key]),
      [{comment_id:result.id,actor_user_id:91001}]);
    const committed=await snapshot();assert.deepEqual(checked(await postOwn()),result);assert.deepEqual(await snapshot(),committed);
    assert.deepEqual(await snapshot(sideTables),before);
  });
  await t.test('database rejects nonpositive and foreign actor IDs with no surviving DML',async()=>{
    const before=await snapshot();
    for(const [actorId,code] of [[0,'23514'],[-1,'23514'],[2147483647,'23503']]){
      await db.query('BEGIN');
      try{await assert.rejects(db.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido,actor_usuario_id)
        VALUES($1,'QA345 invalid','Rejected fixture-only actor',$2)`,[task.id,actorId]),error=>error.code===code);}
      finally{await db.query('ROLLBACK');}
    }
    assert.deepEqual(await snapshot(),before);
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename),tables);
});
