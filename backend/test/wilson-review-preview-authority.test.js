import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWilsonRouter,resolveWilsonUser,buildWilsonConfirmationHash} from '../src/wilson-integration.js';

// Real middleware + registered callback; no HTTP listener, DB or providers.
const external='qa389-external',group='qa389-group';
const hash=createHash('sha256').update(external).digest('hex');
const actorSql='SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE';
function fixture({change=()=>{},assigned=7,mutate=false,failure,rollbackFails=false}={}){
  const calls=[],errors=[],notifications=[];
  const live={id:7,usuario:'qa389',nombre:'QA389 current name',rol:'admin',activo:true,
    whatsapp_id_hash:null,whatsapp_habilitado:true};
  let mapping={actor_hash:hash,usuario_id:7,enabled:true},matches=[{id:7}];
  let state={replaced:false,inserted:null},pending,request,releaseArg,released=false,escaped;
  const primary=new Error('QA389 primary'),rollbackError=new Error('QA389 rollback');
  const task={id:101,revision:2,titulo:'QA389 review',asignado_a:'QA389 assigned',estado:'en_progreso',
    tipo_tarea:'edicion',subtipo:'video',material_referencia:'https://example.invalid/qa389',
    propiedades_extra:{workspace:'render_os'},updated_at:'2026-10-25T12:00:00.000Z',
    fecha_vencimiento:'2026-10-30',cliente_nombre:'QA389 client'};
  const client={release(error){released=true;releaseArg=error;calls.push({sql:'RELEASE'});},async query(raw,params=[]){
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,params:structuredClone(params)});
    if(/^BEGIN(?: ISOLATION LEVEL READ COMMITTED)?$/.test(sql)){pending=structuredClone(state);return {rows:[]};}
    if(sql==='ROLLBACK'){pending=undefined;if(rollbackFails)throw rollbackError;return {rows:[]};}
    if(sql==='COMMIT'){if(failure==='commit')throw primary;state=pending;pending=undefined;return {rows:[]};}
    if(sql===actorSql){assert.deepEqual(params,[7]);return {rows:[structuredClone(live)]};}
    if(sql==='SELECT actor_hash,usuario_id,enabled FROM mia_whatsapp_identities WHERE actor_hash=$1 FOR SHARE'){
      assert.deepEqual(params,[hash]);return {rows:mapping?[structuredClone(mapping)]:[]};
    }
    if(sql.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE')){
      assert.match(sql,/ORDER BY u.id FOR SHARE OF u$/);assert.deepEqual(params,[hash]);return {rows:structuredClone(matches)};
    }
    if(sql.includes('FROM tareas t LEFT JOIN clientes')){
      assert.deepEqual(params,[[101]],'Normalized task selection is captured before lease');
      assert.match(sql,/FOR UPDATE OF t$/);return {rows:[structuredClone(task)]};
    }
    if(sql.includes('SELECT tarea_id, usuario_id, tipo'))return {rows:[{tarea_id:101,usuario_id:assigned,tipo:'responsable'}]};
    if(sql.startsWith('UPDATE integracion_confirmaciones')){
      assert.deepEqual(params,[external,group],'Replacement stays bound to original subject');
      pending.replaced=true;return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO integracion_confirmaciones')){
      if(failure==='insert')throw primary;pending.inserted=structuredClone(params);return {rows:[]};
    }
    assert.fail(`Unexpected SQL in preview authority double: ${sql}`);
  }};
  const pool={async query(sql){
    assert.match(sql,/SELECT u.id,u.usuario,u.nombre,u.rol,u.activo FROM usuarios u/);
    calls.push({sql:'AUTH_RESOLVE'});return {rows:[{...live,nombre:'QA389 stale name'}]};
  },async connect(){
    if(failure==='connect')throw primary;
    change({live,setMapping:v=>{mapping=v;},setMatches:v=>{matches=v;}});
    if(mutate){Object.assign(request.wilson,{userId:99,actorId:'changed',groupId:'changed-group',
      actorName:'Changed label',actorRole:'diseno',channel:'telegram',systemActor:true});request.body.task_ids.splice(0,1,999);}
    return client;
  }};
  const router=createWilsonRouter({pool,env:{NODE_ENV:'test'},notifyAssignment:v=>notifications.push(v)});
  const handler=router.stack.find(l=>l.route?.path==='/lotes/revision/previsualizar'&&l.route.methods.post).route.stack[0].handle;
  return {calls,errors,notifications,primary,rollbackError,get escaped(){return escaped;},get state(){return state;},get released(){return released;},get releaseArg(){return releaseArg;},async run(){
    request={method:'POST',path:'/lotes/revision/previsualizar',body:{task_ids:['101']},
      wilson:{channel:'whatsapp',actorId:external,groupId:group}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    let authenticated=false;await resolveWilsonUser(pool,{NODE_ENV:'test'})(request,res,e=>{if(e)throw e;authenticated=true;});
    assert.equal(authenticated,true);
    try{await handler(request,res,e=>errors.push(e));}catch(e){escaped=e;}
    return res;
  }};
}
for(const [label,change] of [
  ['inactive',({live})=>{live.activo=false;}],
  ['disabled WhatsApp',({live})=>{live.whatsapp_habilitado=false;}],
  ['disabled mapping',({setMapping})=>setMapping({actor_hash:hash,usuario_id:7,enabled:false})],
  ['changed mapping account',({setMapping})=>setMapping({actor_hash:hash,usuario_id:99,enabled:true})],
  ['ambiguous mapping',({setMatches})=>setMatches([{id:7},{id:99}])],
])test(`preview rejects ${label} at lease without replacing or issuing tokens`,async()=>{
  const f=fixture({change}),res=await f.run();assert.equal(f.errors[0]?.status??res.statusCode,403);
  assert.deepEqual(f.state,{replaced:false,inserted:null});assert.deepEqual(f.notifications,[]);
  assert.equal(f.calls.some(c=>/^(UPDATE|INSERT|DELETE) /.test(c.sql)),false);
  assert.equal(f.calls.some(c=>c.sql.includes('FROM tareas t')),false);
  assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
});
test('preview fresh demotion removes cached admin authority over foreign tasks',async()=>{
  const f=fixture({assigned:99,change:({live})=>{live.rol='edicion';}}),res=await f.run();
  assert.equal(f.errors[0]?.status??res.statusCode,403);assert.deepEqual(f.state,{replaced:false,inserted:null});
  assert.equal(f.calls.some(c=>/^(UPDATE|INSERT|DELETE) /.test(c.sql)),false);
});
for(const mutate of [false,true])test(`preview retains original subject/IDs and current renamed actor; mutation=${mutate}`,async()=>{
  const f=fixture({mutate,change:({live})=>{live.rol='edicion';}}),res=await f.run();
  assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,201);assert.deepEqual(res.body.task_ids,[101]);
  assert.equal(f.calls.find(c=>c.sql.startsWith('BEGIN')).sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
  const a=f.calls.findIndex(c=>c.sql===actorSql),tasks=f.calls.findIndex(c=>c.sql.includes('FROM tareas t'));
  assert.ok(a>=0&&a<tasks);assert.equal(f.state.replaced,true);
  const params=f.state.inserted;assert.equal(params[0],res.body.confirmacion_token);
  assert.deepEqual(params.slice(1,3),[external,group]);assert.equal(params[6],'QA389 current name');
  assert.equal(params[3],buildWilsonConfirmationHash({operation:'revisar_lote',payload:{task_ids:[101]}}));
  assert.deepEqual(JSON.parse(params[5]).tasks.map(t=>t.id),[101]);
  assert.equal(res.body.tasks.length,1);assert.deepEqual(f.notifications,[]);assert.equal(f.released,true);
});
test('preview connect failure goes through next with no transaction or release',async()=>{
  const f=fixture({failure:'connect'});await f.run();assert.equal(f.escaped,undefined);assert.deepEqual(f.errors,[f.primary]);
  assert.deepEqual(f.calls.map(c=>c.sql),['AUTH_RESOLVE']);assert.equal(f.released,false);
});
for(const failure of ['insert','commit'])for(const rollbackFails of [false,true])
  test(`preview ${failure} failure rolls back tokens; failed rollback=${rollbackFails} discards lease`,async()=>{
    const f=fixture({failure,rollbackFails});await f.run();assert.deepEqual(f.errors,[f.primary]);
    assert.deepEqual(f.state,{replaced:false,inserted:null});assert.deepEqual(f.notifications,[]);
    assert.equal(f.releaseArg,rollbackFails?f.rollbackError:undefined);
    assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
  });
