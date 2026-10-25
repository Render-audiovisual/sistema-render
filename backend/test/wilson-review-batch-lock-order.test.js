import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWilsonRouter,resolveWilsonUser} from '../src/wilson-integration.js';

// Real callbacks and identity middleware. Logical ordering only, not a physical
// PostgreSQL deadlock test; no listener, providers or configured database.
const reporter='qa390-reporter',admin='qa390-admin',token='qa390-token',group='qa390-group';
const actorSql='SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE';
function fixture({mode='confirm',actor=reporter,role='edicion',groupId=group,emptyHint=false,
  changedScope,missingLocked=false,claimEmpty=false,hidden=false,inactive=false,informant=reporter}={}){
  const hash=createHash('sha256').update(actor).digest('hex');
  const calls=[],errors=[],notifications=[];
  const user={id:7,usuario:'qa390',nombre:'QA390 retained',rol:role,activo:true,
    whatsapp_id_hash:hash,whatsapp_habilitado:true};
  const ids=[102,101];
  const tasks=[101,102].map(id=>({id,revision:1,titulo:`QA390 task ${id}`,asignado_a:'QA390 worker',
    estado:'en_progreso',tipo_tarea:'edicion',subtipo:'video',material_referencia:'https://example.invalid/qa390',
    cliente_id:1,cliente_nombre:'QA390 client',fecha_vencimiento:'2026-10-30',
    propiedades_extra:{workspace:'render_os'},updated_at:'2026-10-25T12:00:00.000Z'}));
  const snapshots=ids.map(id=>{const {titulo,asignado_a,estado,updated_at}=tasks.find(t=>t.id===id);return {id,titulo,asignado_a,estado,updated_at};});
  const original={token,integracion:'wilson',canal:'whatsapp',operacion:'revisar_lote',actor_id:reporter,
    grupo_id:groupId,informante_actor_id:informant,informante_actor_nombre:'QA390 reporter',
    used_at:null,expires_at:'2099-01-01T00:00:00.000Z',payload:{tasks:snapshots}};
  let state={written:false,used:false,audits:0,inserted:null},pending;
  const client={release(){calls.push({sql:'RELEASE'});},async query(raw,params=[]){
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,params:structuredClone(params)});
    if(sql==='BEGIN ISOLATION LEVEL READ COMMITTED'){pending=structuredClone(state);return {rows:[]};}
    if(sql==='ROLLBACK'){pending=undefined;return {rows:[]};}
    if(sql==='COMMIT'){state=pending;pending=undefined;return {rows:[]};}
    if(sql===actorSql){assert.deepEqual(params,[7]);return {rows:[{...user,activo:!inactive}]};}
    if(sql==='SELECT actor_hash,usuario_id,enabled FROM mia_whatsapp_identities WHERE actor_hash=$1 FOR SHARE'){
      assert.deepEqual(params,[hash]);return {rows:[]};
    }
    if(sql.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE')){
      assert.match(sql,/ORDER BY u.id FOR SHARE OF u$/);assert.deepEqual(params,[hash]);return {rows:[{id:7}]};
    }
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('FROM integracion_confirmaciones')){
      assert.deepEqual(params,[token,groupId]);
      const locked=/FOR UPDATE\b/.test(sql);
      return {rows:locked?(missingLocked?[]:[{...structuredClone(original),...changedScope}])
        :(emptyHint?[]:[structuredClone(original)])};
    }
    if(sql.includes('FROM tareas')){
      assert.deepEqual([...params[0]].sort((a,b)=>a-b),[101,102]);
      const rows=structuredClone(tasks);if(hidden)rows[0].propiedades_extra.papelera_render_os=true;
      // Simulate database row ordering from the actual submitted SQL. This
      // makes JS presentation restoration observable after sorted SQL locks.
      return {rows:/ORDER BY (?:t\.)?id(?: ASC)? FOR UPDATE/.test(sql)?rows:ids.map(id=>rows.find(t=>t.id===id))};
    }
    if(sql.includes('SELECT tarea_id, usuario_id, tipo'))return {rows:tasks.map(t=>({tarea_id:t.id,usuario_id:7,tipo:'responsable'}))};
    if(sql.startsWith('UPDATE integracion_confirmaciones')){
      if(mode==='confirm'){
        assert.deepEqual(params,[token,groupId]);assert.match(sql,/expires_at>clock_timestamp\(\)/);
        if(claimEmpty)return {rows:[]};
      }else assert.deepEqual(params,[actor,groupId]);
      pending.used=true;return {rows:[{claimed:1}]};
    }
    if(sql.startsWith('INSERT INTO integracion_confirmaciones')){pending.inserted=structuredClone(params);return {rows:[]};}
    if(sql.startsWith('UPDATE tareas')){pending.written=true;return {rows:[]};}
    if(sql.startsWith('INSERT INTO integracion_auditoria')){pending.audits++;return {rows:[]};}
    assert.fail(`Unexpected SQL in lock-order double: ${sql}`);
  }};
  const pool={async query(sql){assert.match(sql,/FROM usuarios u/);calls.push({sql:'AUTH_RESOLVE'});return {rows:[{...user}]};},
    async connect(){return client;}};
  const router=createWilsonRouter({pool,env:{NODE_ENV:'test'},notifyAssignment:v=>notifications.push(v)});
  const path=mode==='preview'?'/lotes/revision/previsualizar':'/lotes/revision/confirmar';
  const handler=router.stack.find(l=>l.route?.path===path&&l.route.methods.post).route.stack[0].handle;
  return {calls,errors,notifications,get state(){return state;},async run(){
    const req={method:'POST',path,body:mode==='preview'?{task_ids:[...ids]}:{confirmacion_token:token},
      wilson:{channel:'whatsapp',actorId:actor,groupId}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    let authenticated=false;await resolveWilsonUser(pool,{NODE_ENV:'test'})(req,res,e=>{if(e)throw e;authenticated=true;});assert.equal(authenticated,true);
    await handler(req,res,e=>errors.push(e));return res;
  }};
}
const advisory=f=>f.calls.filter(c=>c.sql.includes('pg_advisory_xact_lock'));
const dml=f=>f.calls.filter(c=>/^(UPDATE|INSERT|DELETE) /.test(c.sql));
function scopeKey(f,expectedReporter=reporter,expectedGroup=group){
  const keys=advisory(f);assert.equal(keys.length,1,'Exactly one scope key, never switch or invent a scope');
  assert.deepEqual(keys[0].params,[JSON.stringify(['wilson-review-batch-v1','wilson','whatsapp',expectedReporter,expectedGroup])]);
  return f.calls.indexOf(keys[0]);
}
test('preview locks actor then original reporter scope then sorted tasks; restores original display and snapshot order',async()=>{
  const f=fixture({mode:'preview'}),res=await f.run();assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,201);
  const a=f.calls.findIndex(c=>c.sql===actorSql),gate=scopeKey(f),tasks=f.calls.findIndex(c=>c.sql.includes('FROM tareas'));
  assert.ok(a<gate&&gate<tasks);assert.match(f.calls[tasks].sql,/ORDER BY t.id(?: ASC)? FOR UPDATE OF t$/);
  assert.deepEqual(res.body.task_ids,[102,101]);assert.deepEqual(res.body.tasks.map(t=>t.id),[102,101]);
  assert.deepEqual(JSON.parse(f.state.inserted[5]).tasks.map(t=>t.id),[102,101]);
  assert.deepEqual(f.state.inserted.slice(1,3),[reporter,group]);
  assert.ok(res.body.text.indexOf('task 102')<res.body.text.indexOf('task 101'));
});
for(const actor of [reporter,admin])test(`confirmation uses reporter token hint scope, not confirmer (${actor})`,async()=>{
  const f=fixture({actor,role:actor===admin?'admin':'edicion'}),res=await f.run();assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,200);
  const gate=scopeKey(f),reads=f.calls.map((c,i)=>({...c,i})).filter(c=>c.sql.includes('FROM integracion_confirmaciones'));
  assert.equal(reads.length,2);assert.doesNotMatch(reads[0].sql,/FOR (?:UPDATE|SHARE)/);assert.match(reads[1].sql,/FOR UPDATE$/);
  const a=f.calls.findIndex(c=>c.sql===actorSql),tasks=f.calls.findIndex(c=>c.sql.includes('FROM tareas'));
  assert.ok(a<reads[0].i&&reads[0].i<gate&&gate<reads[1].i&&reads[1].i<tasks);
  assert.match(f.calls[tasks].sql,/ORDER BY (?:t\.)?id(?: ASC)? FOR UPDATE(?: OF t)?$/);
  assert.equal(f.state.written,true);assert.equal(f.state.used,true);
});
test('absent token hint returns409 without invented advisory key or task access',async()=>{
  const f=fixture({emptyHint:true}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,409);
  assert.deepEqual(advisory(f),[]);assert.deepEqual(dml(f),[]);assert.equal(f.calls.some(c=>c.sql.includes('FROM tareas')),false);
});
for(const [field,value] of Object.entries({token:'changed-token',integracion:'other',canal:'telegram',
  operacion:'other',actor_id:'changed-reporter',grupo_id:'changed-group',informante_actor_id:'changed-informant'}))
  test(`locked reread changed ${field} rejects409 without second scope or writes`,async()=>{
    const f=fixture({actor:admin,role:'admin',changedScope:{[field]:value}}),res=await f.run();
    assert.equal(f.errors[0]?.status??res.statusCode,409);scopeKey(f);
    assert.deepEqual(dml(f),[]);assert.equal(f.calls.some(c=>c.sql.includes('FROM tareas')),false);
    assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
  });
test('token removed or consumed while waiting on scope cannot authorize via stale hint',async()=>{
  const f=fixture({missingLocked:true}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,409);
  scopeKey(f);assert.deepEqual(dml(f),[]);assert.deepEqual(f.notifications,[]);
});
test('empty captured group remains exact scope component',async()=>{
  const f=fixture({groupId:''}),res=await f.run();assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,200);scopeKey(f,reporter,'');
});
test('NULL reread group is not interchangeable with captured empty group',async()=>{
  const f=fixture({groupId:'',changedScope:{grupo_id:null}}),res=await f.run();
  assert.equal(f.errors[0]?.status??res.statusCode,409);scopeKey(f,reporter,'');assert.deepEqual(dml(f),[]);
});
test('admin can confirm historical unchanged NULL informant using token reporter scope',async()=>{
  const f=fixture({actor:admin,role:'admin',informant:null}),res=await f.run();
  assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,200);scopeKey(f);
  assert.equal(f.state.written,true);assert.equal(f.state.used,true);
});
test('nonadmin hint does not authorize another reporter despite matching task membership',async()=>{
  const f=fixture({actor:admin,role:'edicion'}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,403);
  assert.deepEqual(dml(f),[]);assert.deepEqual(f.notifications,[]);
});
test('sorted ordering preserves final TTL claim denial with no domain writes',async()=>{
  const f=fixture({claimEmpty:true}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,409);
  scopeKey(f);assert.equal(dml(f).length,1);assert.match(dml(f)[0].sql,/^UPDATE integracion_confirmaciones/);
  assert.deepEqual(f.state,{written:false,used:false,audits:0,inserted:null});assert.deepEqual(f.notifications,[]);
});
test('sorted ordering preserves current hidden404 before token claim',async()=>{
  const f=fixture({hidden:true}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,404);
  scopeKey(f);assert.deepEqual(dml(f),[]);assert.deepEqual(f.notifications,[]);
});
test('inactive actor fails before hint, advisory or task locks',async()=>{
  const f=fixture({inactive:true}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,403);
  assert.deepEqual(advisory(f),[]);assert.equal(f.calls.some(c=>c.sql.includes('FROM integracion_confirmaciones')),false);
  assert.deepEqual(dml(f),[]);
});
