import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { registerWilsonFinalizationRoutes } from '../src/wilson-finalization.js';

// Main owns the signed HTTP parity test on 55993. This independent core fixture tests
// actual PostgreSQL waits and transaction faults through registered callbacks;
// it deliberately does not claim to verify transport signature cryptography.
test('private finalization expires after physical locks and rolls back token/domain/audit/receipt faults', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true',timeout:240000,
}, async t => {
  const port=55996, f=await startLocalHarness({port,clusterOnly:true});
  const config={host:'127.0.0.1',port,user:'render2_fixture',database:'render2_local_test',password:'',ssl:false,
    statement_timeout:15000,lock_timeout:12000,connectionTimeoutMillis:5000,application_name:'wilson_finalization_owned_physical'};
  const pool=new pg.Pool({...config,max:5}), blocker=new pg.Client(config), observer=new pg.Client(config);
  const operations=new Set();
  t.after(async () => {
    try {
      await blocker.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([...operations]);
      await Promise.allSettled([blocker.end(),observer.end(),pool.end()]);
    } finally {
      await f.cleanup();await assert.rejects(access(f.root),error => error.code==='ENOENT');
      t.diagnostic('Owned PG55996 removed ENOENT; no configured DB, HTTP/provider or production access.');
    }
  });
  await blocker.connect();await observer.connect();
  const identity=(await observer.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const actorId='owned-physical-finalizer',hash=createHash('sha256').update(actorId).digest('hex'),privateScope=`private:${hash.slice(0,16)}`;
  await observer.query('UPDATE usuarios SET whatsapp_habilitado=true,whatsapp_id_hash=$1 WHERE id=91001',[hash]);
  const clientId=(await observer.query("INSERT INTO clientes(nombre) VALUES('Finalization owned fixture') RETURNING id")).rows[0].id;
  let leasedPid, failure;
  const routes=new Map();
  registerWilsonFinalizationRoutes({post(path,handler) {routes.set(path,handler);}}, {pool:{async connect() {
    const db=await pool.connect();leasedPid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    return {release:discard => db.release(discard),async query(sql,values) {
      if(failure==='audit' && sql.includes('INSERT INTO integracion_auditoria'))throw Error('Owned injected audit failure');
      if(failure==='receipt' && sql.includes('SET payload=jsonb_set'))throw Error('Owned injected receipt failure');
      return db.query(sql,values);
    }};
  }}});
  async function call(path,body) {
    const req={headers:{'x-wilson-signature-version':'2'},wilson:{channel:'whatsapp',actorId,groupId:privateScope,
      privateChat:true,userId:91001,systemActor:false},body};
    const res={statusCode:200,status(code) {this.statusCode=code;return this;},json(value) {this.body=value;return this;}};
    await routes.get(path)(req,res,error => {res.error=error;res.statusCode=error.status || 500;});return res;
  }
  async function prepare(production=false) {
    const ids=[];
    for(let i=0;i<2;i++) {
      const row=(await observer.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,cliente_id,propiedades_extra)
        VALUES($1,'Synthetic fixture label',$2,$3,$4,$5::jsonb) RETURNING id`,[production?'Visita own fixture':'Approved own fixture',
      production?'en_progreso':'aprobada',production?'produccion':'edicion',clientId,
      JSON.stringify({workspace:'render_os',...(production?{produccion_videos_previstos:1}:{})})])).rows[0];
      ids.push(row.id);await observer.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'responsable')",[row.id]);
    }
    const visits=[];
    if(production)for(const id of ids) {
      const visit=randomUUID();visits.push(visit);
      await observer.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
        VALUES($1,$2,$3,'2026-10-26','Owned visit',91001,91001)`,[visit,id,clientId]);
      await observer.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
        VALUES($1,$2,'Owned video','grabado',91001,91001)`,[randomUUID(),visit]);
    }
    const preview=await call('/lotes/finalizacion/previsualizar',{task_ids:ids});assert.equal(preview.statusCode,201,preview.error?.message);
    return {ids,visits,token:preview.body.confirmacion_token};
  }
  const tables=['tareas','integracion_confirmaciones','integracion_auditoria','publicaciones','historias','produccion_visitas','produccion_videos'];
  async function snapshot() {
    const hashes={};
    for(const table of tables)hashes[table]=(await observer.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`)).rows[0].hash;
    return hashes;
  }
  async function eventually(predicate,message) {
    const deadline=Date.now()+8000;
    while(Date.now()<deadline) {if(await predicate())return;await new Promise(resolve => setTimeout(resolve,20));}
    assert.fail(message);
  }
  for(const wait of ['scope','token','tasks','visit'])await t.test(`clock expiry after actual ${wait} lock`,async () => {
    const prepared=await prepare(wait==='visit');
    const expiry=(await observer.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE token=$1 RETURNING expires_at",[prepared.token])).rows[0].expires_at;
    const before=await snapshot();
    await blocker.query('BEGIN');
    if(wait==='scope')await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [JSON.stringify(['wilson-private-finalization-v1',actorId,privateScope])]);
    if(wait==='token')await blocker.query('SELECT token FROM integracion_confirmaciones WHERE token=$1 FOR UPDATE',[prepared.token]);
    if(wait==='tasks')await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[prepared.ids[0]]);
    if(wait==='visit')await blocker.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR UPDATE',[prepared.visits[0]]);
    leasedPid=undefined;
    const pending=call('/lotes/finalizacion/confirmar',{confirmacion_token:prepared.token});operations.add(pending);
    try {
      await eventually(async () => leasedPid && (await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[blockerPid,leasedPid])).rows[0].blocked,
        'Confirmation did not reach the owned PostgreSQL lock');
      await eventually(async () => (await observer.query('SELECT clock_timestamp()>$1::timestamptz expired',[expiry])).rows[0].expired,
        'Owned confirmation did not reach wall-clock expiry');
    } finally {await blocker.query('ROLLBACK');}
    const result=await pending;operations.delete(pending);assert.equal(result.statusCode,409,result.error?.message);
    assert.deepEqual(await snapshot(),before,'Expiry must not consume token, rewrite a row, create an audit or publish');
  });
  for(const fault of ['audit','receipt'])await t.test(`actual rollback after ${fault} fault`,async () => {
    const prepared=await prepare(),before=await snapshot();failure=fault;
    try {assert.equal((await call('/lotes/finalizacion/confirmar',{confirmacion_token:prepared.token})).statusCode,500);}
    finally {failure=undefined;}
    assert.deepEqual(await snapshot(),before);
    const retry=await call('/lotes/finalizacion/confirmar',{confirmacion_token:prepared.token});assert.equal(retry.statusCode,200,retry.error?.message);
    const committed=await snapshot();const replay=await call('/lotes/finalizacion/confirmar',{confirmacion_token:prepared.token});
    assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);assert.deepEqual(await snapshot(),committed);
  });
});
