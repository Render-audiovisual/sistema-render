import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWilsonRouter,resolveWilsonUser} from '../src/wilson-integration.js';

const external='qa386-external',group='qa386-group',key='qa386-confirmation';
const hash=createHash('sha256').update(external).digest('hex');
const actorSql='SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE';
function fixture({change=()=>{},mutateSubject=false,failure,rollbackFails=false,reporter=external,assigned=7,
  branch='success',claimEmpty=false,clockSelect=false,scopeProperties,mixed=false}={}) {
  const calls=[],notifications=[],errors=[],audits=[];
  const live={id:7,usuario:'qa386',nombre:'QA386 current name',rol:'admin',activo:true,
    whatsapp_id_hash:null,whatsapp_habilitado:true};
  let mapping={actor_hash:hash,usuario_id:7,enabled:true},matches=[{id:7}],state={written:false,used:false},pending;
  let req,releaseArg;
  const primary=new Error('QA386 primary failure'),rollbackError=new Error('QA386 rollback failure');
  const task={id:101,titulo:'QA386 task',tipo_tarea:'edicion',subtipo:'video',estado:'en_progreso',
    asignado_a:'QA386 assigned',material_referencia:'https://example.invalid/qa386',cliente_id:1,
    updated_at:'2026-10-25T12:00:00.000Z',propiedades_extra:{workspace:'render_os'}};
  const {id,titulo,asignado_a,estado,updated_at}=task;
  const ids=mixed?[101,102]:[101];
  const client={release(error){releaseArg=error;calls.push({sql:'RELEASE'});},async query(raw,params=[]){
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,params:structuredClone(params)});
    if(/^BEGIN(?: ISOLATION LEVEL READ COMMITTED)?$/.test(sql)){pending=structuredClone(state);return {rows:[]};}
    if(sql==='ROLLBACK'){pending=undefined;if(rollbackFails)throw rollbackError;return {rows:[]};}
    if(sql==='COMMIT'){if(failure==='commit')throw primary;state=pending;pending=undefined;return {rows:[]};}
    if(sql===actorSql){assert.deepEqual(params,[7],'Actor ID must be captured before lease');return {rows:[structuredClone(live)]};}
    if(sql==='SELECT actor_hash,usuario_id,enabled FROM mia_whatsapp_identities WHERE actor_hash=$1 FOR SHARE'){
      assert.deepEqual(params,[hash]);return {rows:mapping?[structuredClone(mapping)]:[]};
    }
    if(sql.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE')){
      assert.match(sql,/ORDER BY u.id FOR SHARE OF u$/);assert.deepEqual(params,[hash]);return {rows:structuredClone(matches)};
    }
    if(sql==='SELECT pg_advisory_xact_lock(hashtextextended($1,0))'){
      assert.deepEqual(params,[JSON.stringify(['wilson-review-batch-v1','wilson','whatsapp',reporter,group])]);return {rows:[]};
    }
    if(sql.includes('FROM integracion_confirmaciones')){
      assert.deepEqual(params,[key,group],'Token/group must retain original subject');
      if(clockSelect)assert.match(sql,/expires_at\s*>\s*clock_timestamp\(\)/);
      return {rows:[{token:key,actor_id:reporter,grupo_id:group,integracion:'wilson',canal:'whatsapp',operacion:'revisar_lote',
        informante_actor_id:reporter,informante_actor_nombre:'Original reporter',
        payload:{tasks:ids.map(id=>({id,titulo,asignado_a,estado,updated_at}))}}]};
    }
    if(sql.includes('FROM tareas WHERE id=ANY')){
      assert.match(sql,/ORDER BY id FOR UPDATE$/);
      assert.deepEqual(params,[ids]);const current=structuredClone(task);
      if(branch==='conflict')current.updated_at='2026-10-25T13:00:00.000Z';
      if(branch==='validation')Object.assign(current,{tipo_tarea:'produccion',subtipo:'visita',
        propiedades_extra:{workspace:'render_os',videos_planificados:2}});
      if(scopeProperties!==undefined)current.propiedades_extra=structuredClone(scopeProperties);
      return {rows:mixed?[structuredClone(task),{...current,id:102}]:[current]};
    }
    if(sql.includes('SELECT tarea_id, usuario_id, tipo'))return {rows:ids.map(tarea_id=>({tarea_id,usuario_id:assigned,tipo:'responsable'}))};
    if(sql.startsWith("UPDATE tareas SET estado='en_revision'")){
      if(failure==='write')throw primary;pending.written=true;return {rows:[]};
    }
    if(sql.startsWith('UPDATE integracion_confirmaciones')){
      if(sql.includes('clock_timestamp()')){
        assert.match(sql,/SET used_at\s*=\s*clock_timestamp\(\)/);
        assert.match(sql,/used_at IS NULL/);assert.match(sql,/expires_at\s*>\s*clock_timestamp\(\)/);
        assert.match(sql,/RETURNING /);assert.match(sql,/integracion\s*=\s*'wilson'/);
        assert.match(sql,/canal\s*=\s*'whatsapp'/);assert.match(sql,/operacion\s*=\s*'revisar_lote'/);
        assert.ok(params.includes(key)&&params.includes(group));
        if(claimEmpty)return {rows:[],rowCount:0};
        pending.used=true;return {rows:[{claimed:1}],rowCount:1};
      }
      pending.used=true;return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO integracion_auditoria')){
      if(failure==='audit')throw primary;audits.push(structuredClone(params));return {rows:[]};
    }
    assert.fail(`Unexpected SQL in authority double: ${sql}`);
  }};
  const pool={async query(sql){
    assert.match(sql,/SELECT u.id,u.usuario,u.nombre,u.rol,u.activo FROM usuarios u/);
    calls.push({sql:'AUTH_RESOLVE'});return {rows:[{...live,nombre:'QA386 stale name'}]};
  },async connect(){
    if(failure==='connect')throw primary;
    change({live,setMapping:value=>{mapping=value;},setMatches:value=>{matches=value;}});
    if(mutateSubject){Object.assign(req.wilson,{userId:99,actorId:'mutated',actorName:'Mutated name',
      actorRole:'diseno',groupId:'mutated-group',channel:'telegram',systemActor:true});req.body.confirmacion_token='mutated-token';}
    return client;
  }};
  const router=createWilsonRouter({pool,env:{NODE_ENV:'test'},notifyAssignment:value=>{
    assert.equal(pending,undefined);assert.equal(state.written,true);notifications.push(value);
  }});
  const handler=router.stack.find(l=>l.route?.path==='/lotes/revision/confirmar'&&l.route.methods.post).route.stack[0].handle;
  return {calls,notifications,errors,audits,primary,rollbackError,get releaseArg(){return releaseArg;},get state(){return state;},
    async run(){
      req={method:'POST',path:'/lotes/revision/confirmar',body:{confirmacion_token:key},
        wilson:{channel:'whatsapp',actorId:external,groupId:group}};
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
      let authenticated=false;
      await resolveWilsonUser(pool,{NODE_ENV:'test'})(req,res,error=>{if(error)throw error;authenticated=true;});
      assert.equal(authenticated,true,'Real identity middleware establishes the initial actor');
      await handler(req,res,error=>errors.push(error));return res;
    }};
}

for(const [label,scopeProperties] of [
  ['other workspace',{workspace:'another_workspace'}],['missing workspace',{}],
  ['boolean archived',{workspace:'render_os',archivada_render_os:true}],
  ['legacy string archived',{workspace:'render_os',archivada_render_os:'true'}],
  ['boolean trashed',{workspace:'render_os',papelera_render_os:true}],
  ['legacy string trashed',{workspace:'render_os',papelera_render_os:'true'}],
])test(`current locked ${label} rejects404 before claim even with unchanged preview timestamp`,async()=>{
  const f=fixture({scopeProperties}),res=await f.run();
  assert.equal(f.errors[0]?.status??res.statusCode,404);assert.deepEqual(dml(f),[]);
  assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.audits,[]);assert.deepEqual(f.notifications,[]);
  assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
  assert.ok(f.calls.some(c=>c.sql.includes('FROM tareas WHERE id=ANY')&&c.sql.endsWith('FOR UPDATE')));
});
test('one hidden current row rejects an entire mixed batch atomically before token claim',async()=>{
  const f=fixture({mixed:true,scopeProperties:{workspace:'render_os',papelera_render_os:true}}),res=await f.run();
  assert.equal(f.errors[0]?.status??res.statusCode,404);assert.deepEqual(dml(f),[]);
  assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.audits,[]);assert.deepEqual(f.notifications,[]);
  assert.deepEqual(f.calls.find(c=>c.sql.includes('FROM tareas WHERE id=ANY')).params,[[101,102]]);
  assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
});
for(const value of [false,'false'])test(`explicit hidden flags ${JSON.stringify(value)} allow a valid current workspace`,async()=>{
  const f=fixture({scopeProperties:{workspace:'render_os',archivada_render_os:value,papelera_render_os:value}}),res=await f.run();
  assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,200);assert.equal(res.body.updated,true);
  assert.deepEqual(f.state,{written:true,used:true});assert.equal(f.notifications.length,1);
});
const dml=f=>f.calls.filter(c=>/^(UPDATE|INSERT|DELETE) /.test(c.sql));
function denied(f,res){
  const status=f.errors[0]?.status??res.statusCode;assert.equal(status,403);
  assert.deepEqual(dml(f),[]);assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.notifications,[]);
  assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(f.releaseArg,undefined);
}
for(const [name,change] of [
  ['inactive',({live})=>{live.activo=false;}],
  ['unrecognized role',({live})=>{live.rol='unknown';}],
  ['WhatsApp disabled',({live})=>{live.whatsapp_habilitado=false;}],
  ['mapping disabled',({setMapping})=>setMapping({actor_hash:hash,usuario_id:7,enabled:false})],
  ['mapping changed account',({setMapping})=>setMapping({actor_hash:hash,usuario_id:99,enabled:true})],
  ['ambiguous account',({setMatches})=>setMatches([{id:7},{id:99}])],
])test(`batch authority rejects ${name} at lease before domain locks or DML`,async()=>{
  const f=fixture({change}),res=await f.run();denied(f,res);
  assert.equal(f.calls.some(c=>c.sql.includes('FROM integracion_confirmaciones')),false);
});
test('fresh demotion removes cached admin bypass for another reporter and assignee',async()=>{
  const f=fixture({reporter:'another-reporter',assigned:99,change:({live})=>{live.rol='edicion';}});
  denied(f,await f.run());
});
test('retained current actor labels, IDs and actor-before-token/task locks on positive confirmation',async()=>{
  const f=fixture(),res=await f.run();assert.equal(res.statusCode,200);assert.equal(res.body.updated,true);assert.deepEqual(f.errors,[]);
  assert.equal(f.calls.find(c=>c.sql.startsWith('BEGIN')).sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
  const actor=f.calls.findIndex(c=>c.sql===actorSql),hint=f.calls.findIndex(c=>c.sql.includes('FROM integracion_confirmaciones'));
  const gate=f.calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'));
  const token=f.calls.findIndex(c=>c.sql.includes('FROM integracion_confirmaciones')&&c.sql.endsWith('FOR UPDATE'));
  const task=f.calls.findIndex(c=>c.sql.includes('FROM tareas WHERE id=ANY'));
  assert.ok(actor>=0&&actor<hint&&hint<gate&&gate<token&&token<task);assert.equal(f.notifications.length,1);
  assert.equal(f.notifications[0].actorId,7);assert.equal(f.notifications[0].actor,'QA386 current name');
  assert.equal(f.audits.length,1);assert.deepEqual(f.audits[0].slice(0,4),['whatsapp',external,'QA386 current name',group]);
  const update=f.calls.find(c=>c.sql.startsWith("UPDATE tareas SET estado='en_revision'"));
  assert.equal(JSON.parse(update.params[1]).mia_revision_confirmada_por,'QA386 current name');
  assert.match(res.body.text,/QA386 current name/);
});
test('fresh demotion still allows the original reporter to confirm their own assigned task',async()=>{
  const f=fixture({change:({live})=>{live.rol='edicion';}}),res=await f.run();
  assert.deepEqual(f.errors,[]);assert.equal(res.statusCode,200);assert.equal(res.body.updated,true);
  assert.deepEqual(f.state,{written:true,used:true});assert.equal(f.notifications[0].actorId,7);
});
test('pool connect failure reaches next unchanged without transaction, release or side effects',async()=>{
  const f=fixture({failure:'connect'});await f.run();assert.deepEqual(f.errors,[f.primary]);
  assert.deepEqual(f.calls.map(c=>c.sql),['AUTH_RESOLVE']);
  assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.notifications,[]);
  assert.deepEqual(f.audits,[]);assert.equal(f.releaseArg,undefined);
});
test('mutation of original request during pool lease cannot rebind actor, token, group or audit labels',async()=>{
  const f=fixture({mutateSubject:true}),res=await f.run();assert.deepEqual(f.errors,[]);
  assert.equal(res.statusCode,200);assert.equal(res.body.updated,true);
  assert.equal(f.notifications[0].actorId,7);assert.equal(f.notifications[0].actor,'QA386 current name');
  assert.deepEqual(f.audits[0].slice(0,4),['whatsapp',external,'QA386 current name',group]);
});
for(const failure of ['write','audit','commit'])for(const rollbackFails of [false,true])
  test(`batch ${failure} preserves primary error; rollback failure=${rollbackFails} discards lease`,async()=>{
    const f=fixture({failure,rollbackFails});await f.run();assert.equal(f.errors[0],f.primary);
    assert.equal(f.errors.length,1);assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.notifications,[]);
    assert.equal(f.releaseArg,rollbackFails?f.rollbackError:undefined);
    assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);
  });

for(const branch of ['success','conflict','validation']){
  test(`wall-clock claim precedes all ${branch} task/audit writes and consumes once`,async()=>{
    const f=fixture({branch,clockSelect:true}),res=await f.run();assert.deepEqual(f.errors,[]);
    assert.equal(res.statusCode,branch==='success'?200:409);
    const writes=dml(f),claims=writes.filter(c=>c.sql.startsWith('UPDATE integracion_confirmaciones'));
    assert.equal(claims.length,1);assert.match(claims[0].sql,/expires_at\s*>\s*clock_timestamp\(\)/);
    assert.equal(writes[0],claims[0],'No task or cancellation-audit write before conditional claim');
    assert.deepEqual(f.state,{written:branch==='success',used:true});assert.equal(f.audits.length,1);
    assert.equal(f.notifications.length,branch==='success'?1:0);
    if(branch!=='success')assert.equal(f.audits[0][6],branch==='conflict'?'conflicto':'validacion');
  });
  test(`empty wall-clock claim after locks rejects ${branch} with409, rollback and no domain effects`,async()=>{
    const f=fixture({branch,claimEmpty:true}),res=await f.run();
    assert.equal(f.errors[0]?.status??res.statusCode,409);
    const writes=dml(f);assert.equal(writes.length,1,'Only the zero-row conditional token UPDATE is attempted');
    assert.match(writes[0].sql,/^UPDATE integracion_confirmaciones.*expires_at\s*>\s*clock_timestamp\(\).*RETURNING /);
    assert.deepEqual(f.state,{written:false,used:false});assert.deepEqual(f.audits,[]);assert.deepEqual(f.notifications,[]);
    assert.deepEqual(f.calls.slice(-2).map(c=>c.sql),['ROLLBACK','RELEASE']);assert.equal(f.releaseArg,undefined);
    assert.ok(f.calls.findIndex(c=>c.sql.includes('FROM tareas WHERE id=ANY'))<f.calls.indexOf(writes[0]));
  });
}
