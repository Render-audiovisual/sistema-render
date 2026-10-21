import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTaskAccessClause } from '../src/task-access.js';
import { buildMoodboardTaskReadPredicate, moodboardTaskId, mutateMoodboardTaskLink } from '../src/moodboard-task-access.js';
import { createMoodboardsRouter } from '../src/moodboards.js';

const auth = changes => ({ id: 7, rol: 'admin', activo: true, session_version: 2, ...changes });
test('predicate role matrix uses canonical legacy ID ACL and shared render_os, with stable-ID fail closed', () => {
  for (const rol of ['edicion','diseno','produccion','community','programacion','unknown']) {
    const observed = auth({rol}), canonical = buildTaskAccessClause(observed,'task','$4');
    const result = buildMoodboardTaskReadPredicate(observed,'task','$4');
    assert.equal(result.value,7); assert.ok(result.sql.includes(canonical.sql));
    assert.match(result.sql, /task\.propiedades_extra->>'workspace' = 'render_os'/);
    assert.match(result.sql, /OR \(task\.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os' AND EXISTS/);
    assert.match(result.sql, /ta\.tarea_id = task.id AND ta.usuario_id = \$4::integer/);
    assert.doesNotMatch(result.sql,/nombre|asignado_a\s*=|colaboradores/);
  }
  assert.deepEqual(buildMoodboardTaskReadPredicate(auth()),{sql:'TRUE',value:null});
  for (const id of [undefined,null,0,-1,'7',7.5,NaN,2147483648,{},[]])
    assert.deepEqual(buildMoodboardTaskReadPredicate(auth({id})),{sql:'FALSE',value:null});
  assert.deepEqual(buildMoodboardTaskReadPredicate(auth({activo:false})),{sql:'FALSE',value:null});
  for(const [alias,placeholder] of [['t; DROP TABLE tareas','$2'],['t\n','$2'],['t','$2 OR TRUE'],['t','$2\n']])
    assert.throws(()=>buildMoodboardTaskReadPredicate(auth(),alias,placeholder),TypeError);
});

test('IDs reject ambiguous/coercible/overflow forms including final newline before SQL', () => {
  assert.equal(moodboardTaskId('2147483647'),2147483647); assert.equal(moodboardTaskId(7),7);
  for(const id of [null,undefined,'','0','01','-1','1.0','1e1',' 7','7 ','7\n',0,-1,1.1,2147483648,[],{},true])
    assert.throws(()=>moodboardTaskId(id),{status:400});
});

function fixture({ role='edicion', workspace=null, member=true, boardMember=true, missing=null,
  inactive=false, version=2, failAt=null, failRollback=false } = {}) {
  const calls=[],links=new Set(['1:12']);let baseline;
  const failure=new Error('Synthetic storage failure'),rollbackError=new Error('Synthetic rollback failure');
  const task={id:12,cliente_id:91,workspace};
  const db={release(error){calls.push({stage:'release',error});},async query(sql,values=[]){
    let stage;
    if(sql.startsWith('BEGIN'))stage='begin';
    else if(sql==='COMMIT')stage='commit';
    else if(sql==='ROLLBACK')stage='rollback';
    else if(sql.startsWith('SELECT id,rol,activo,session_version'))stage='actor';
    else if(sql.startsWith('SELECT id,board_id'))stage='reference';
    else if(sql.startsWith('SELECT t.id,t.cliente_id'))stage='task';
    else if(sql.includes('FROM moodboard_board_clients'))stage='board';
    else if(sql.startsWith('SELECT t.id FROM tareas'))stage='permission';
    else if(sql.startsWith('INSERT INTO moodboard_reference_tasks'))stage='insert';
    else if(sql.startsWith('DELETE FROM moodboard_reference_tasks'))stage='delete';
    else assert.fail(`Unexpected SQL: ${sql}`);
    calls.push({stage,sql,values:[...values]});
    if(stage===failAt)throw failure;
    if(stage==='begin'){baseline=new Set(links);return{rows:[]};}
    if(stage==='rollback'){
      if(failRollback)throw rollbackError;
      if(baseline){links.clear();for(const link of baseline)links.add(link);}return{rows:[]};
    }
    if(stage==='commit')return{rows:[]};
    if(stage==='actor')return{rows:missing==='actor'?[]:[{id:values[0],rol:role,activo:!inactive,session_version:version}]};
    if(stage==='reference')return{rows:missing==='reference'?[]:[{id:1,board_id:90}]};
    if(stage==='task')return{rows:missing==='task'?[]:[task]};
    if(stage==='board')return{rows:boardMember?[{board_id:90,cliente_id:91}]:[]};
    if(stage==='permission'){
      // SQL-protocol adapter only; canonical clause structure is asserted above.
      const allowed=sql.endsWith('AND TRUE') || workspace==='render_os' || member && sql.includes('tarea_asignaciones');
      return{rows:allowed?[{id:12}]:[]};
    }
    if(stage==='insert')links.add(`${values[0]}:${values[1]}`);
    if(stage==='delete')links.delete(`${values[0]}:${values[1]}`);
    return{rows:[]};
  }};
  return{calls,links,failure,rollbackError,pool:{connect:async()=>db},
    run:(remove=false,actor=auth())=>mutateMoodboardTaskLink({connect:async()=>db},actor,'1','12',{remove})};
}

for(const remove of [false,true])test(`${remove?'DELETE':'POST'} link uses current actor then reference/task/board share locks and only relation mutation`,async()=>{
  const f=fixture();
  assert.deepEqual(await f.run(remove),{ok:true});
  assert.deepEqual(f.calls.map(call=>call.stage),['begin','actor','reference','task','board','permission',remove?'delete':'insert','commit','release']);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
  for(const stage of ['actor','reference','task','board'])assert.match(f.calls.find(call=>call.stage===stage).sql,/FOR SHARE/);
  assert.deepEqual(f.calls.find(call=>call.stage==='board').values,[90,91]);
  assert.equal(f.links.has('1:12'),!remove);
  assert.equal(f.calls.filter(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql||'')).length,1);
  assert.ok(f.calls.filter(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql||'')).every(call=>call.sql.includes('moodboard_reference_tasks')));
  assert.equal(f.calls.some(call=>/advisory|nombre/.test(call.sql||'')),false);
});

for(const workspace of [null,'','historical','private','unexpected'])for(const member of [false,true])
  test(`historical marker ${JSON.stringify(workspace)} membership=${member} follows canonical read ACL`,async()=>{
    const f=fixture({workspace,member});
    if(member)assert.deepEqual(await f.run(),{ok:true});
    else{await assert.rejects(f.run(),{status:404});assert.equal(f.calls.some(call=>call.stage==='insert'),false);}
  });

test('shared render_os read authorization permits linking even when employee cannot mutate task',async()=>{
  const f=fixture({workspace:'render_os',member:false});await f.run();
  const permission=f.calls.find(call=>call.stage==='permission');
  assert.deepEqual(permission.values,[12,7]);assert.ok(permission.sql.includes("= 'render_os'"));
  assert.equal(f.calls.some(call=>/UPDATE tareas/.test(call.sql||'')),false);
});

test('current DB admin can link historical tasks; cached admin role never bypasses current membership',async()=>{
  const admin=fixture({role:'admin',member:false,workspace:'unexpected'});await admin.run(false,auth({rol:'edicion'}));
  assert.ok(admin.calls.find(call=>call.stage==='permission').sql.endsWith('AND TRUE'));
  const downgraded=fixture({role:'diseno',member:false});
  await assert.rejects(downgraded.run(false,auth({rol:'admin'})),{status:404});
  assert.equal(downgraded.calls.some(call=>call.stage==='insert'),false);
});

for(const remove of [false,true])test(`${remove?'unlink':'link'} wrong client, missing or unauthorized objects all deny generically without purging rows`,async()=>{
  const messages=[];
  for(const options of [{boardMember:false},{missing:'reference'},{missing:'task'},{member:false}]){
    const f=fixture(options),before=[...f.links];
    await assert.rejects(f.run(remove),error=>{assert.equal(error.status,404);messages.push(error.message);return true});
    assert.deepEqual([...f.links],before);assert.equal(f.calls.some(call=>['insert','delete'].includes(call.stage)),false);
    assert.equal(f.calls.at(-2).stage,'rollback');assert.equal(f.calls.at(-1).stage,'release');
  }
  assert.equal(new Set(messages).size,1);
});

test('inactive, revoked and missing actor deny before any domain read; malformed observations acquire no client',async()=>{
  for(const options of [{inactive:true},{version:3},{missing:'actor'}]){
    const f=fixture(options);await assert.rejects(f.run(),{status:401});
    assert.deepEqual(f.calls.map(call=>call.stage),['begin','actor','rollback','release']);
  }
  const pool={connect:()=>assert.fail('must not acquire')};
  for(const observed of [null,auth({id:'7'}),auth({id:0}),auth({session_version:'2'}),auth({session_version:0})])
    await assert.rejects(mutateMoodboardTaskLink(pool,observed,'1','12'),{status:401});
  await assert.rejects(mutateMoodboardTaskLink(pool,auth(),'1\n','12'),{status:400});
});

for(const stage of ['begin','actor','reference','task','board','permission','insert','delete','commit'])test(`${stage} failure rolls back/releases and never returns success`,async()=>{
  const f=fixture({failAt:stage}),before=[...f.links];
  await assert.rejects(f.run(stage==='delete'),error=>error===f.failure);
  assert.deepEqual([...f.links],before);
  assert.equal(f.calls.at(-2).stage,'rollback');assert.equal(f.calls.at(-1).stage,'release');
});

test('rollback failure discards client while preserving original storage error',async()=>{
  const f=fixture({failAt:'permission',failRollback:true});
  await assert.rejects(f.run(),error=>error===f.failure);
  assert.equal(f.calls.at(-1).error,f.rollbackError);
});

function readRouter(pool){
  // Router construction's pre-existing upload mkdir is not part of these tests.
  const mkdir=mock.method(fs,'mkdirSync',()=>{});
  try{return createMoodboardsRouter({pool});}finally{mkdir.mock.restore();}
}
async function route(router,method,path,params,actor=auth({rol:'edicion'})){
  const handler=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
  const res={code:200,status(value){this.code=value;return this;},json(value){this.body=value;return this;},end(){return this;}};
  await handler({params,auth:actor},res,error=>{throw error;});return res;
}

test('actual board-task and linked-task read SQL share predicate + board/client membership; invalid IDs never query',async()=>{
  const calls=[],router=readRouter({query:async(sql,values)=>{calls.push({sql,values});return{rows:[]}}});
  for(const path of ['/boards/:id/tasks','/boards/:id/references']){
    for(const actor of [auth({rol:'edicion'}),auth(),auth({id:null})]){
      const result=await route(router,'get',path,{id:'90'},actor);assert.equal(result.code,200);
      const query=calls.at(-1),predicate=buildMoodboardTaskReadPredicate(actor);
      assert.ok(query.sql.includes(predicate.sql));
      assert.deepEqual(query.values,predicate.value===null?[90]:[90,7]);
      if(path.endsWith('/references')){
        assert.match(query.sql,/LEFT JOIN tareas t ON t.id = rt.tarea_id AND/);
        assert.match(query.sql,/bc.board_id=r.board_id AND bc.cliente_id=t.cliente_id/);
        assert.match(query.sql,/FILTER \(WHERE t.id IS NOT NULL\)/);
      }else assert.match(query.sql,/bc.cliente_id = t.cliente_id/);
      assert.doesNotMatch(query.sql,/\b(?:INSERT|UPDATE|DELETE)\b/);
    }
    const count=calls.length;assert.equal((await route(router,'get',path,{id:'90\n'})).code,400);assert.equal(calls.length,count);
  }
});

test('actual POST and DELETE routes use guarded transaction and safe status mapping',async()=>{
  for(const method of ['post','delete']){
    const f=fixture({boardMember:false}),router=readRouter(f.pool);
    const result=await route(router,method,'/references/:id/tasks/:taskId',{id:'1',taskId:'12'});
    assert.equal(result.code,404);assert.deepEqual(result.body,{error:'Tarea o referencia no disponible.'});
    const before=f.calls.length;
    assert.equal((await route(router,method,'/references/:id/tasks/:taskId',{id:'1',taskId:'12x'})).code,400);
    assert.equal(f.calls.length,before);
  }
});
