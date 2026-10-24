import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('goal content HTTP retains live account authority through commit', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55848}),connections=new Set();
  t.after(async()=>{
    for(const client of connections){await client.query('ROLLBACK').catch(()=>{});await client.end();}
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`Own goal content authority fixture removed: ${f.root}`);
  });
  const url='postgresql://render2_fixture@127.0.0.1:55848/render2_local_test';
  const [identity]=await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port:55848,url,identity});
  const connect=async name=>{const c=new pg.Client({connectionString:url,application_name:`qa188-${name}`,statement_timeout:15000});connections.add(c);await c.connect();return c;};
  const close=async c=>{try{await c.query('ROLLBACK');}finally{await c.end();connections.delete(c);}};
  const observer=await connect('observer');
  const waitFor=async(sql,values,message)=>{
    const until=Date.now()+6000;
    do{const result=await observer.query(sql,values);if(result.rows.length)return result.rows[0];await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<until);
    assert.fail(message);
  };
  const ok=(r,status=200)=>{assert.equal(r.status,status,'Expected HTTP status');return r.body;};
  const login=async usuario=>ok(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const api=async(path,token,method='GET',body)=>{
    const response=await fetch(new URL(`/api${path}`,f.base),{method,signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return{status:response.status,body:await response.json()};
  };
  const owner=await login('qa_agustin');
  const [client]=await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES('QA188 authority',true,1,0) RETURNING id");
  const key=`cliente-${client.id}`;
  const beforePrepare=ok(await api('/cliente-objetivos?periodo=2026-10',owner)).clientes.find(c=>c.clave===key);
  ok(await api('/cliente-objetivos/preparar',owner,'POST',{periodo:'2026-10',clave:key,responsables:[91004],
    responsables_por_formato:{video:[91004],carrusel:[]},expected_preparation_revision:beforePrepare.preparacion_revision}));
  const piece=ok(await api('/cliente-objetivos?periodo=2026-10',owner)).clientes.find(c=>c.clave===key).piezas[0];
  const endpoint=`/cliente-objetivos/piezas/${piece.id}/contenido`;
  const current=async()=>ok(await api(`/tareas/${piece.tarea_id}?workspace=render_os`,owner));
  const input=task=>({titulo:'QA188 serialized content',copy:'QA188 body',expected_updated_at:task.updated_at,expected_revision:task.revision});
  const snapshot=async()=>{const out={};for(const table of ['tareas','tarea_asignaciones','cliente_objetivo_piezas','cliente_objetivos_mensuales','cliente_objetivo_eventos','publicaciones','editorial_publicacion_eventos'])out[table]=await f.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`);return out;};
  const actors=[{id:91001,usuario:'qa_franco',rol:'admin'},{id:91004,usuario:'qa_designer',rol:'diseno'}];
  const losses=[['epoch','UPDATE usuarios SET session_version=session_version+1 WHERE id=$1'],
    ['inactive','UPDATE usuarios SET activo=false WHERE id=$1'],
    ['role',"UPDATE usuarios SET rol='community' WHERE id=$1"]];
  for(const actor of actors)for(const [loss,sql] of losses){
    await t.test(`${actor.rol}: ${loss} committed before transaction authorization denies without DML`,async()=>{
      const token=await login(actor.usuario),body=input(await current()),before=await snapshot();
      const holder=await connect('actor-holder');let pending;
      try{
        await holder.query('BEGIN');await holder.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE',[actor.id]);
        const holderPid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending=api(endpoint,token,'PATCH',body);void pending.catch(()=>{});
        await waitFor(`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND a.wait_event_type='Lock' AND a.query ILIKE '%usuarios%' AND a.query ILIKE '%FOR SHARE%'
          AND $1::int=ANY(pg_blocking_pids(a.pid))`,[holderPid],'HTTP must pass middleware then wait at transaction actor lock');
        await holder.query(sql,[actor.id]);await holder.query('COMMIT');
        ok(await pending,401);assert.deepEqual(await snapshot(),before);
      }finally{
        await holder.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending]);await close(holder);
        await f.query('UPDATE usuarios SET activo=true,rol=$2 WHERE id=$1',[actor.id,actor.rol]);
      }
    });
  }
  for(const actor of actors){
    await t.test(`${actor.rol}: acquired authority serializes revocation behind successful content commit`,async()=>{
      const token=await login(actor.usuario),body=input(await current());body.copy=`QA188 accepted ${actor.rol}`;
      const holder=await connect('task-holder'),revoker=await connect('revoker');let pending,revocation;
      try{
        await holder.query('BEGIN');await holder.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[piece.tarea_id]);
        const holderPid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending=api(endpoint,token,'PATCH',body);void pending.catch(()=>{});
        const writer=await waitFor(`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND a.wait_event_type='Lock' AND a.query ILIKE '%cliente_objetivo_piezas%'
          AND a.query ILIKE '%FOR UPDATE OF t%' AND $1::int=ANY(pg_blocking_pids(a.pid))`,[holderPid],'Content writer must reach task lock with retained actor authority');
        await revoker.query('BEGIN');const revokerPid=(await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        revocation=revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1',[actor.id]);void revocation.catch(()=>{});
        await waitFor(`SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'
          AND $2::int=ANY(pg_blocking_pids(pid))`,[revokerPid,writer.pid],'Revocation must wait on the actual content writer');
        await holder.query('COMMIT');const saved=ok(await pending);assert.ok(saved.revision>body.expected_revision);
        await revocation;await revoker.query('COMMIT');
        ok(await api('/inicio',token),401);
        const task=await current();assert.equal(task.propiedades_extra.copy_trabajo,body.copy);assert.equal(task.revision,saved.revision);
      }finally{
        await holder.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending]);
        if(revocation)await Promise.allSettled([revocation]);await close(holder);await close(revoker);
      }
    });
  }
  await t.test('same actor competing edits retain shared authority without deadlock and one CAS winner',async()=>{
    const token=await login('qa_designer'),body=input(await current());
    const before=(await f.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()'))[0].deadlocks;
    const results=await Promise.all([api(endpoint,token,'PATCH',{...body,copy:'QA188 competitor A'}),api(endpoint,token,'PATCH',{...body,copy:'QA188 competitor B'})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await current()).revision,ok(results.find(r=>r.status===200)).revision);
    assert.equal((await f.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()'))[0].deadlocks,before);
  });
  for(const [status,usuario,id] of [[409,'qa_designer',91004],[404,'qa_luciano',91003]])await t.test(`${status} rolls back and releases actor authority without publication or leaked locks`,async()=>{
    const token=await login(usuario),body=input(await current());if(status===409)body.expected_revision--;
    const before=await snapshot();ok(await api(endpoint,token,'PATCH',body),status);assert.deepEqual(await snapshot(),before);
    const revoker=await connect('rollback-revoker');
    try{await revoker.query("SET statement_timeout='1500ms'");await revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1',[id]);}
    finally{await close(revoker);}
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
  });
  await t.test('linked publication preserves synchronization and invalidates approval without publishing',async()=>{
    const [publication]=await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy,metadata)
      VALUES($1,'video','pendiente','2026-10-25','QA188 original','{}'::jsonb) RETURNING id`,[client.id]);
    await f.query('UPDATE tareas SET publicacion_id=$1 WHERE id=$2',[publication.id,piece.tarea_id]);
    // Explicitly seed both sides of the synthetic editorial link. This test
    // exercises content writes, not the separate link-creation workflow.
    await f.query('UPDATE cliente_objetivo_piezas SET publicacion_id=$1 WHERE id=$2',[publication.id,piece.id]);
    for(const estado of ['en_progreso','en_revision','aprobada']){
      const task=await current();ok(await api(`/tareas/${task.id}?workspace=render_os`,owner,'PATCH',{estado,expected_revision:task.revision}));
    }
    const held=await current();assert.equal(held.estado,'aprobada');
    const token=await login('qa_designer');ok(await api(endpoint,token,'PATCH',{...input(held),copy:'QA188 changed after linked approval'}));
    const task=await current();assert.equal(task.estado,'en_revision');assert.equal(task.propiedades_extra.revision_aprobada,false);
    const [linked]=await f.query('SELECT publicacion_id,copy,estado FROM cliente_objetivo_piezas WHERE id=$1',[piece.id]);
    assert.equal(linked.publicacion_id,publication.id);assert.equal(linked.copy,task.propiedades_extra.copy_trabajo);assert.equal(linked.estado,'en_revision');
    const [p]=await f.query('SELECT estado,fecha_publicación_real AS fecha_publicacion_real FROM publicaciones WHERE id=$1',[publication.id]);
    assert.notEqual(p.estado,'publicada');assert.equal(p.fecha_publicacion_real,null);
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
  });
});
