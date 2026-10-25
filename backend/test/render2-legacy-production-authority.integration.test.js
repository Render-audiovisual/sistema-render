import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('legacy production HTTP writers retain current actor and authorize fresh task membership', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:300000,
}, async t => {
  const port=55950,f=await startLocalHarness({port});
  const connections=new Set(),operations=new Set();
  t.after(async()=>{
    try {
      await Promise.all([...connections].map(db=>db.query('ROLLBACK').catch(()=>{})));
      await Promise.allSettled([...operations]);
      await Promise.all([...connections].map(db=>db.end()));
    } finally {
      await f.cleanup(); await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic('Owned legacy production PG55950/API stopped and removed.');
    }
  });
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=identity=>assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  guard((await f.query(identitySql))[0]);
  async function auxiliary(){
    const db=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,
      application_name:'render2_qa340_legacy',statement_timeout:20000,lock_timeout:18000,connectionTimeoutMillis:5000});
    await db.connect(); connections.add(db); guard((await db.query(identitySql)).rows[0]);
    db.pid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; return db;
  }
  async function dispose(db){try{await db.query('ROLLBACK').catch(()=>{});}finally{await db.end();connections.delete(db);}}
  function observe(promise){
    operations.add(promise); const pending={promise,settled:false};
    promise.then(()=>{pending.settled=true;},()=>{pending.settled=true;}); return pending;
  }
  const monitor=await auxiliary();
  async function edge(blocker,pending,stage,waiter){
    const deadline=Date.now()+7000;
    do {
      assert.equal(pending.settled,false,'Operation ended before required PostgreSQL blocking edge');
      const {rows}=await monitor.query(`SELECT pid,query ILIKE '%FROM usuarios%FOR SHARE%' AS actor,
        (query ILIKE '%FROM tareas%FOR UPDATE%') AS task
        FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))
        AND (($2::int IS NOT NULL AND pid=$2) OR ($2::int IS NULL AND pid<>ALL($3::int[])))`,
      [blocker,waiter??null,[...connections].map(db=>db.pid)]);
      if(rows.length){assert.equal(rows.length,1);if(stage)assert.equal(rows[0][stage],true);return rows[0].pid;}
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge not observed within seven seconds');
  }
  const actors={member:{id:91005,usuario:'qa_legacy_member',name:'QA340 Member',role:'produccion'},
    admin:{id:91006,usuario:'qa_legacy_admin',name:'QA340 Admin',role:'admin'}};
  for(const actor of Object.values(actors)){
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91003`,[actor.id,actor.usuario,actor.name,actor.role]);
    const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:actor.usuario,password:fixturePassword}});
    assert.equal(login.status,200);assert.equal(login.body.usuario.id,actor.id);assert.equal(typeof login.body.token,'string');
    actor.token=login.body.token;
  }
  async function api(path,method,body,actor){
    const response=await fetch(new URL('/api'+path,f.base),{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:`Bearer ${actor.token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA340 legacy authority',true) RETURNING id");
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){
    const result={};
    for(const table of tables.filter(name=>!excluded.includes(name)))result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash
      FROM "${table}" r`))[0].hash;
    return result;
  }
  const reset=actor=>f.query('UPDATE usuarios SET activo=true,rol=$2,session_version=1 WHERE id=$1',[actor.id,actor.role]);
  const privateHash=async actor=>(await f.query(`SELECT md5((to_jsonb(u)-'activo'-'rol'-'session_version'-'user_admin_version')::text) AS hash
    FROM usuarios u WHERE id=$1`,[actor.id]))[0].hash;
  const othersHash=async actor=>(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text)
    ORDER BY id)::text,'[]')) AS hash FROM usuarios u WHERE id<>$1`,[actor.id]))[0].hash;
  let serial=0;
  async function scenario(kind){
    const actor=kind==='confirm'?actors.admin:actors.member,recordId=randomUUID();
    const record={id:recordId,cantidad:kind==='confirm'?3:1,fecha:'2026-10-25',usuario:actors.member.name,
      usuario_id:actors.member.id,created_at:'2026-10-25T10:00:00.000Z',periodo_objetivo:'2026-10'};
    const props={workspace:'render_os',qa340:'preserve',produccion_videos_previstos:kind==='confirm'?3:10,
      produccion_registros:kind==='record'?[]:[record],edicion_responsable_id:91003};
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,subtipo,estado,
      fecha_vencimiento,material_referencia,propiedades_extra)
      VALUES($1,$2,$3,'produccion','visita',$4,'2026-10-25','https://example.invalid/qa340-material',$5::jsonb) RETURNING id`,
    [`QA340 Visita histórica ${++serial}`,actor.name,client.id,kind==='confirm'?'en_revision':kind==='correct'?'en_progreso':'pendiente',JSON.stringify(props)]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')",[row.id,actor.id]);
    assert.deepEqual(await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1',[row.id]),[],
      'Historical fixture must be genuinely unbound, not a deleted canonical visit');
    const before=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[row.id]))[0].row;
    const path=`/tareas/${row.id}/produccion/${kind==='confirm'?'confirmar':kind==='correct'?`registros/${recordId}`:'registros'}?workspace=render_os`;
    const body={expected_revision:before.revision,...(kind==='confirm'?{}:kind==='correct'?{cantidad:2}:{cantidad:1,fecha:'2026-10-25'})};
    return {actor,before,path,body,kind,recordId};
  }
  const send=s=>api(s.path,s.kind==='correct'?'PATCH':'POST',s.body,s.actor);
  async function taskOthers(id){return (await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(t),t.xmin::text,t.ctid::text)
    ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE id<>$1`,[id]))[0].hash;}
  async function positive(s,response){
    assert.equal(response.status,s.kind==='record'?201:200);
    const dto=s.kind==='confirm'?response.body.task:response.body;
    assert.equal(dto.id,s.before.id);assert.equal(dto.revision,s.before.revision+1);assert.equal(dto.asignado_a_id,s.actor.id);
    const after=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[s.before.id]))[0].row;
    assert.equal(after.propiedades_extra.qa340,'preserve');
    const changedKeys= s.kind==='record'?['produccion_registros','mia_notificacion_pendiente','workspace']:
      s.kind==='confirm'?['produccion_esperando_confirmacion','produccion_confirmada_por','produccion_confirmada_por_id','produccion_confirmada_at','mia_notificacion_pendiente','workspace']:
        ['produccion_registros','produccion_esperando_confirmacion','produccion_finalizada_at','produccion_confirmada_at','produccion_confirmada_por',
          'produccion_confirmada_por_id','revision_aprobada','revision_aprobada_por','revision_aprobada_por_id','revision_aprobada_at','finalizada_at','mia_notificacion_pendiente','workspace'];
    const expectedProps={...s.before.propiedades_extra};for(const key of changedKeys)if(Object.hasOwn(after.propiedades_extra,key))expectedProps[key]=after.propiedades_extra[key];
    // Migration066 invalidates approval on changed production records, including
    // the first legacy add. These are existing trigger effects, not new scope.
    if(s.kind!=='confirm')Object.assign(expectedProps,{revision_aprobada:false,revision_aprobada_at:null,
      revision_aprobada_por:null,revision_aprobada_por_id:null,revision_aprobada_entrega_id:null,finalizada_at:null});
    assert.deepEqual(after,{...s.before,revision:s.before.revision+1,updated_at:after.updated_at,
      estado:s.kind==='confirm'?'en_revision':'en_progreso',propiedades_extra:expectedProps});
    const props=after.propiedades_extra;
    if(s.kind==='record'){
      assert.equal(props.produccion_registros.length,1);const record=props.produccion_registros[0];
      assert.equal(record.cantidad,1);assert.equal(record.fecha,s.body.fecha);assert.equal(record.usuario_id,s.actor.id);assert.equal(record.usuario,s.actor.name);
    }else if(s.kind==='correct'){
      assert.equal(props.produccion_registros.length,1);const record=props.produccion_registros[0];
      assert.equal(record.id,s.recordId);assert.equal(record.cantidad,2);assert.equal(record.usuario_id,s.actor.id);
      assert.equal(record.corregido_por_id,s.actor.id);assert.equal(record.corregido_por,s.actor.name);
    }else{
      assert.equal(response.body.editing_task,null);assert.equal(response.body.created,false);
      assert.deepEqual(props.produccion_registros,s.before.propiedades_extra.produccion_registros);
      assert.equal(props.produccion_confirmada_por_id,s.actor.id);assert.equal(props.produccion_confirmada_por,s.actor.name);
      assert.ok(Number.isFinite(Date.parse(props.produccion_confirmada_at)));
    }
    // The employee operational DTO deliberately strips unknown metadata. The
    // private fixture sentinel must survive in SQL, not leak through HTTP.
    const {qa340: sentinel,...publicProps}=props;
    assert.equal(sentinel,'preserve');
    assert.deepEqual(dto.propiedades_extra,s.kind==='confirm'?props:publicProps);
  }
  const changes=[['inactive','activo=false'],['session','session_version=2'],['role',"rol='diseno'"]];
  for(const kind of ['record','correct','confirm']){
    for(const [name,assignment] of changes)await t.test(`${kind}: ${name} revocation wins before actor SHARE,401 and no domain DML`,async()=>{
      const s=await scenario(kind);await reset(s.actor);
      const before=await snapshot(['usuarios']),privateBefore=await privateHash(s.actor),others=await othersHash(s.actor);
      const revoker=await auxiliary();let pending;
      try{
        await revoker.query('BEGIN');await revoker.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE',[s.actor.id]);
        await revoker.query(`UPDATE usuarios SET ${assignment} WHERE id=$1`,[s.actor.id]);
        pending=observe(send(s));await edge(revoker.pid,pending,'actor');await revoker.query('COMMIT');
        const response=await pending.promise;assert.equal(response.status,401);assert.deepEqual(Object.keys(response.body),['error']);
        assert.deepEqual(await snapshot(['usuarios']),before);assert.equal(await privateHash(s.actor),privateBefore);assert.equal(await othersHash(s.actor),others);
      }finally{
        await revoker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);
        await dispose(revoker);await reset(s.actor);
      }
    });
    await t.test(`${kind}: actor-first request retains authority through commit while revoker waits`,async()=>{
      const s=await scenario(kind),before=await snapshot(['usuarios','tareas']),others=await taskOthers(s.before.id);
      const privateBefore=await privateHash(s.actor),otherUsers=await othersHash(s.actor);
      const stopper=await auxiliary(),revoker=await auxiliary();let pending,revoke;
      try{
        await stopper.query('BEGIN');await stopper.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[s.before.id]);
        pending=observe(send(s));const writer=await edge(stopper.pid,pending,'task');
        await revoker.query('BEGIN');revoke=observe(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=$1',[s.actor.id]));
        await edge(writer,revoke,null,revoker.pid);await stopper.query('COMMIT');
        const response=await pending.promise;await revoke.promise;await revoker.query('COMMIT');
        await positive(s,response);assert.deepEqual(await snapshot(['usuarios','tareas']),before);assert.equal(await taskOthers(s.before.id),others);
        assert.equal(await privateHash(s.actor),privateBefore);assert.equal(await othersHash(s.actor),otherUsers);
      }finally{
        await stopper.query('ROLLBACK').catch(()=>{});if(revoke)await Promise.allSettled([revoke.promise]);
        await revoker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);
        await dispose(stopper);await dispose(revoker);await reset(s.actor);
      }
    });
    if(kind!=='confirm')await t.test(`${kind}: membership removed under task lock yields fresh404 without task writes`,async()=>{
      const s=await scenario(kind),before=await snapshot(['tarea_asignaciones']);
      const assignments=await f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id,tipo');
      const blocker=await auxiliary();let pending;
      try{
        await blocker.query('BEGIN');await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[s.before.id]);
        await blocker.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2',[s.before.id,s.actor.id]);
        pending=observe(send(s));await edge(blocker.pid,pending,'task');await blocker.query('COMMIT');
        assert.equal((await pending.promise).status,404);assert.deepEqual(await snapshot(['tarea_asignaciones']),before);
        assert.deepEqual(await f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id,tipo'),
          assignments.filter(row=>!(row.tarea_id===s.before.id&&row.usuario_id===s.actor.id)));
      }finally{
        await blocker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);await dispose(blocker);
      }
    });
    await t.test(`${kind}: ordinary authorized historical write preserves every other domain row`,async()=>{
      const s=await scenario(kind),before=await snapshot(['tareas']),others=await taskOthers(s.before.id);
      await positive(s,await send(s));assert.deepEqual(await snapshot(['tareas']),before);assert.equal(await taskOthers(s.before.id),others);
    });
  }
  await t.test('all three aggregate writers still reject empty canonical origin with409 and zero DML',async()=>{
    const created=await api('/tareas','POST',{request_id:randomUUID(),workspace:'render_os',titulo:'QA340 Visita canónica',
      asignado_a_id:actors.admin.id,colaborador_ids:[],cliente_id:client.id,tipo_tarea:'produccion',
      fecha_vencimiento:'2026-10-25',produccion_videos_previstos:3},actors.admin);
    assert.equal(created.status,201);const task=created.body.task;
    const visits=await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1',[task.id]);assert.equal(visits.length,1);
    const before=await snapshot(),base=`/tareas/${task.id}/produccion`;
    for(const [suffix,method,body] of [
      ['/registros','POST',{cantidad:1,fecha:'2026-10-25'}],
      [`/registros/${randomUUID()}`,'PATCH',{cantidad:2}],['/confirmar','POST',{}],
    ]){
      const response=await api(base+suffix+'?workspace=render_os',method,{expected_revision:task.revision,...body},actors.admin);
      assert.equal(response.status,409);assert.deepEqual(response.body,{error:'Esta visita se registra por video en Producciones. Continuá allí para no duplicar el contenido.'});
      assert.deepEqual(await snapshot(),before);
    }
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
});
