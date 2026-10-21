import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,request,fixturePassword} from '../scripts/render2-local-test.js';

test('077 preserves existing populated goals and task history before explicit quota review',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55728,deferGoalQuotaReviewMigration:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});});
  const [client]=await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES('QA100 populated upgrade',true,3,0) RETURNING id");
  const [objective]=await f.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,cuentas,reels,carruseles,preparado_por)
    VALUES($1,'2026-10-01',$2,'QA100 historical prepared',$3::jsonb,2,0,'Preserved historical author') RETURNING id`,
  [`cliente-${client.id}`,client.id,JSON.stringify([{id:client.id,nombre:'QA100 populated upgrade'}])]);
  const taskIds=[];
  for(let n=1;n<=2;n++){
    const [task]=await f.query(`INSERT INTO tareas(titulo,estado,cliente_id,tipo_tarea,subtipo,asignado_a,propiedades_extra)
      VALUES($1,'pendiente',$2,'edicion','reel','QA100 historical display',$3::jsonb) RETURNING id`,
    [`QA100 preserved reel ${n}`,client.id,JSON.stringify({workspace:'render_os',objetivo_periodo:'2026-10',copy_trabajo:`Keep script ${n}`})]);
    taskIds.push(task.id);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[task.id]);
    await f.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,titulo,copy,responsables)
      VALUES($1,'video',$2,$3,$4,$5,'["Preserved name"]'::jsonb)`,[objective.id,n,task.id,`QA100 preserved ${n}`,`Keep script ${n}`]);
  }
  const snapshot=async()=>{
    const result={};
    for(const table of ['clientes','tareas','tarea_asignaciones','publicaciones','historias','cliente_objetivos_mensuales','cliente_objetivo_piezas','cliente_objetivo_eventos'])
      result[table]=await f.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const before=await snapshot();
  assert.equal((await f.query("SELECT nombre FROM _migrations WHERE nombre='077_goal_quota_reviews.sql'")).length,0);
  await f.query(await readFile(new URL('../migrations/077_goal_quota_reviews.sql',import.meta.url),'utf8'));
  assert.deepEqual(await snapshot(),before,'Additive audit migration must not reinterpret existing goals or work');
  assert.deepEqual(await f.query('SELECT * FROM cliente_objetivo_cuota_revisiones'),[]);
  await f.query("INSERT INTO _migrations(nombre) VALUES('077_goal_quota_reviews.sql')");
  const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
  const token=ok(await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}})).token;
  const get=async()=>ok(await request(f.base,'/api/cliente-objetivos?periodo=2026-10',{token})).clientes.find(row=>row.id===objective.id);
  const observed=await get();
  assert.equal(observed.cuota_desactualizada,true);assert.deepEqual(observed.cuota_actual,{reels:3,carruseles:0});
  assert.deepEqual(await snapshot(),before,'Review read does not reconcile automatically');
  const result=ok(await request(f.base,'/api/cliente-objetivos/reconciliar',{token,method:'POST',body:{periodo:'2026-10',clave:`cliente-${client.id}`,
    responsables:[91003],responsables_por_formato:{video:[91003],carrusel:[91003]},expected_quota_revision:observed.cuota_revision}}));
  assert.equal(result.creadas,1);assert.equal(result.objetivo_id,objective.id);
  const after=await snapshot(),current=await get();
  for(const table of ['clientes','publicaciones','historias','cliente_objetivo_eventos'])assert.deepEqual(after[table],before[table]);
  assert.deepEqual(after.tareas.filter(row=>taskIds.includes(row.id)),before.tareas);
  assert.deepEqual(after.cliente_objetivo_piezas.filter(row=>before.cliente_objetivo_piezas.some(old=>old.id===row.id)),before.cliente_objetivo_piezas);
  assert.equal(current.reels,3);assert.equal(current.piezas.length,3);assert.equal(current.cuota_desactualizada,false);
  const audit=await f.query('SELECT objetivo_id,actor_user_id,reels_antes,reels_despues FROM cliente_objetivo_cuota_revisiones');
  assert.deepEqual(audit,[{objetivo_id:objective.id,actor_user_id:91001,reels_antes:2,reels_despues:3}]);
  await t.test('a task edit committed while quota review waits is reread after locking and rejects the stale confirmation',async()=>{
    await f.query('UPDATE clientes SET cuota_reels=4 WHERE id=$1',[client.id]);
    const review=await get();assert.equal(review.cuota_actual.reels,4);
    const db=new pg.Client({connectionString:'postgresql://render2_fixture@127.0.0.1:55728/render2_local_test'});
    await db.connect();let pending;
    try{
      const identity=(await db.query("SELECT current_database() database,current_setting('data_directory') directory")).rows[0];
      assert.equal(identity.database,'render2_local_test');assert.equal(identity.directory,`${f.root}/data`);
      await db.query('BEGIN');
      const blocker=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await db.query('UPDATE tareas SET titulo=$2,updated_at=now() WHERE id=$1',[taskIds[0],'QA100 edit committed after review observation']);
      pending=request(f.base,'/api/cliente-objetivos/reconciliar',{token,method:'POST',body:{periodo:'2026-10',clave:`cliente-${client.id}`,
        responsables:[91003],responsables_por_formato:{video:[91003],carrusel:[91003]},expected_quota_revision:review.cuota_revision}});
      let blocked=false;
      for(let n=0;n<75;n++){
        const rows=await f.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND $1::int=ANY(pg_blocking_pids(pid)) AND position('SELECT id FROM tareas WHERE id=ANY' in query)>0`,[blocker]);
        if(rows.length){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'The real HTTP writer must wait for the observed task lock before comparing its fingerprint');
      await db.query('COMMIT');
      assert.equal((await pending).status,409);pending=null;
      const latest=await get();assert.equal(latest.reels,3);assert.equal(latest.cuota_desactualizada,true);
      assert.equal(latest.piezas.length,3);
      assert.equal((await f.query('SELECT count(*)::int count FROM cliente_objetivo_cuota_revisiones'))[0].count,1);
      assert.equal((await f.query('SELECT titulo FROM tareas WHERE id=$1',[taskIds[0]]))[0].titulo,'QA100 edit committed after review observation');
    }finally{
      await db.query('ROLLBACK').catch(()=>{});await db.end();if(pending)await pending.catch(()=>{});
    }
  });
});
