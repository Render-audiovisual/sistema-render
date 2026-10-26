import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {access} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,request,fixturePassword} from '../scripts/render2-local-test.js';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);

test('WhatsApp correction shares web policy, exact receipt and physical late-expiry rollback',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const actor='qa-correction-owner',editorActor='qa-correction-editor',group='qa-correction-group';
  const f=await startLocalHarness({port:55987,wilson:{publicKey:publicKey.export({type:'spki',format:'pem'}),allowedWhatsappIds:`${actor},${editorActor}`,allowedWhatsappGroups:group}});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});t.diagnostic('Owned correction PG55987/HTTP removed; no production or provider.');});
  await f.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91001',[hash(actor)]);
  await f.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91003',[hash(editorActor)]);
  const signed=async(route,body,{method='POST',who=actor,groupId=''}={})=>{
    const url=new URL('/api/integraciones/wilson'+route,f.base),timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID();
    const message=['v2',timestamp,nonce,'whatsapp',who,groupId,'Untrusted display',method,url.pathname+url.search,hash(canonical(body))].join('\n');
    const response=await fetch(url,{method,signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-wilson-channel':'whatsapp','x-wilson-actor-id':who,'x-wilson-group-id':groupId,'x-wilson-actor-name':'Untrusted display','x-wilson-signature-version':'2','x-wilson-timestamp':timestamp,'x-wilson-nonce':nonce,'x-wilson-signature':crypto.sign('sha256',Buffer.from(message),privateKey).toString('base64')},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const [client]=await f.query("INSERT INTO clientes(nombre) VALUES('QA correction client') RETURNING id");
  const [piece]=await f.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,metadata) VALUES($1,'video','pendiente','2026-10-28','{}') RETURNING id",[client.id]);
  const pieceBefore=await f.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1',[piece.id]);
  const makeTask=async(extra={})=>{
    const properties={workspace:'render_os',produccion_videos_previstos:5,revision_aprobada:true,produccion_confirmada_at:'2026-10-02T12:00:00Z',finalizada_at:'2026-10-02T12:00:00Z',private_finance:12345,
      produccion_registros:[{id:'a',cantidad:3,fecha:'2026-10-01',cantidad_mes_actual:3,cantidad_adelanto:0},{id:'b',cantidad:4,fecha:'2026-10-02',cantidad_mes_actual:2,cantidad_adelanto:2,periodo_adelanto:'2026-11'}],...extra};
    const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,estado,propiedades_extra)
      VALUES('QA recorded visit','Franco QA',$1,$2,'produccion','visita','finalizada',$3::jsonb) RETURNING id,revision`,[client.id,piece.id,JSON.stringify(properties)]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'responsable')",[task.id]);return task;
  };
  const read=async id=>(await f.query('SELECT * FROM tareas WHERE id=$1',[id]))[0];
  const route=(id,record='a')=>`/tareas/${id}/produccion/registros/${record}`;
  const preview=(task,amount=1,record='a')=>signed(route(task.id,record)+'/previsualizar',{expected_revision:task.revision,cantidad:amount});
  const confirm=(task,token,amount=1,record='a')=>signed(route(task.id,record),{expected_revision:task.revision,cantidad:amount,confirmacion_token:token},{method:'PATCH'});
  await t.test('one correction redistributes later records, revokes approval and exact concurrent replay is read-only',async()=>{
    const task=await makeTask(),p=await preview(task);assert.equal(p.status,201,JSON.stringify(p.body));assert.equal(p.body.summary.previous,3);
    const responses=await Promise.all([confirm(task,p.body.confirmacion_token),confirm(task,p.body.confirmacion_token)]);
    assert.deepEqual(responses.map(r=>r.status),[200,200],JSON.stringify(responses));
    const saved=await read(task.id);assert.equal(saved.estado,'en_revision');assert.equal(saved.propiedades_extra.revision_aprobada,false);assert.equal(saved.propiedades_extra.finalizada_at,null);
    assert.equal(saved.propiedades_extra.produccion_registros[0].cantidad,1);assert.equal(saved.propiedades_extra.produccion_registros[1].cantidad_mes_actual,4);assert.equal(saved.propiedades_extra.produccion_registros[1].cantidad_adelanto,0);
    assert.equal(saved.propiedades_extra.produccion_registros[1].periodo_adelanto,null);
    for(const response of responses)assert.doesNotMatch(JSON.stringify(response.body),/private_finance|12345/);
    const physical=await f.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1',[task.id]);
    assert.equal((await confirm(task,p.body.confirmacion_token)).status,200);
    assert.deepEqual(await f.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1',[task.id]),physical);
    assert.equal((await f.query("SELECT count(*)::int n FROM integracion_auditoria WHERE accion='corregir_registro_produccion' AND tarea_id=$1",[task.id]))[0].n,1);
  });
  await t.test('web route uses the same correction and still requires observed revision',async()=>{
    const task=await makeTask();const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}});assert.equal(login.status,200);
    const result=await request(f.base,'/api'+route(task.id)+'?workspace=render_os',{method:'PATCH',token:login.body.token,body:{expected_revision:task.revision,cantidad:1}});
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal((await read(task.id)).propiedades_extra.produccion_registros[1].cantidad_adelanto,0);
    const stale=await request(f.base,'/api'+route(task.id)+'?workspace=render_os',{method:'PATCH',token:login.body.token,body:{expected_revision:task.revision,cantidad:2}});assert.equal(stale.status,409);
  });
  await t.test('record/quantity substitution, ambiguous IDs, revoked role, group and canonical visit all reject without writes',async()=>{
    const task=await makeTask(),p=await preview(task);assert.equal(p.status,201);
    assert.equal((await confirm(task,p.body.confirmacion_token,1,'b')).status,409);assert.equal((await confirm(task,p.body.confirmacion_token,2)).status,409);
    assert.equal((await signed(route(task.id)+'/previsualizar',{expected_revision:task.revision,cantidad:1},{who:editorActor})).status,403);
    assert.equal((await signed(route(task.id)+'/previsualizar',{expected_revision:task.revision,cantidad:1},{groupId:group})).status,403);
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91001");assert.equal((await confirm(task,p.body.confirmacion_token)).status,403);await f.query("UPDATE usuarios SET rol='admin' WHERE id=91001");
    assert.equal((await read(task.id)).propiedades_extra.produccion_registros[0].cantidad,3);
    const ambiguous=await makeTask({produccion_registros:[{id:'a',cantidad:1,fecha:'2026-10-01'},{id:'a',cantidad:2,fecha:'2026-10-02'}]});assert.equal((await preview(ambiguous)).status,409);
    const linked=await makeTask();await f.query("INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id) VALUES($1,$2,$3,'2026-10-01','QA linked',91001,91001)",[crypto.randomUUID(),linked.id,client.id]);assert.equal((await preview(linked)).status,409);
  });
  await t.test('expiry after an actual task lock wait rolls back token and count',async()=>{
    const task=await makeTask(),p=await preview(task);assert.equal(p.status,201);
    const blocker=new pg.Client({host:'127.0.0.1',port:55987,user:'render2_fixture',database:'render2_local_test',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:12000});await blocker.connect();let pending;
    try{
      await blocker.query('BEGIN');const pid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);pending=confirm(task,p.body.confirmacion_token);
      const deadline=Date.now()+4000;let blocked=false;while(Date.now()<deadline){if((await f.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) blocked',[pid]))[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,30));}assert.equal(blocked,true);
      await f.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1",[p.body.confirmacion_token]);await blocker.query('COMMIT');assert.equal((await pending).status,409);
      assert.equal((await read(task.id)).propiedades_extra.produccion_registros[0].cantidad,3);assert.equal((await f.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1',[p.body.confirmacion_token]))[0].used_at,null);
    }finally{await blocker.query('ROLLBACK').catch(()=>{});await blocker.end();if(pending)await pending.catch(()=>{});}
  });
  assert.deepEqual(await f.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1',[piece.id]),pieceBefore);
});
