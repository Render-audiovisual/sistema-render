import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { parseTaskBoardOrderInput, normalizeTaskBoardOrder, moveTaskBoardOrder,
  reorderTaskBoard, createTaskBoardOrderRouter, TASK_BOARD_ELIGIBILITY_SQL } from '../src/task-board-order.js';

const requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const request=changes=>({request_id:requestId,task_id:2,expected_revision:1,before_id:1,expected_before_revision:1,expected_order_revision:'1',...changes});
const auth=changes=>({id:7,session_version:2,rol:'admin',...changes});
const task=(id,changes={})=>({id,revision:1,estado:'pendiente',propiedades_extra:{workspace:'render_os'},...changes});

test('closed DTO uses exact UUID, canonical bigint string and explicit positive task/anchor revisions',()=>{
  assert.deepEqual(parseTaskBoardOrderInput(request({request_id:requestId.toUpperCase()})),request());
  for(const expected_order_revision of [1,0,null,'0','01','1.0','1\n',' 1','9223372036854775808',{},[]])
    assert.throws(()=>parseTaskBoardOrderInput(request({expected_order_revision})),{status:400});
  assert.equal(parseTaskBoardOrderInput(request({expected_order_revision:'9223372036854775807'})).expected_order_revision,'9223372036854775807');
  for(const request_id of [null,requestId+'\n',' '+requestId,12,[]])assert.throws(()=>parseTaskBoardOrderInput(request({request_id})),{status:400});
  for(const change of [{task_ids:[1,2]},{scope:'historical'},{task_id:'2'},{task_id:0},{expected_revision:'1'},
    {before_id:2},{before_id:'1'},{before_id:0},{before_id:null},{expected_before_revision:null}])
    assert.throws(()=>parseTaskBoardOrderInput(request(change)),{status:400});
  assert.equal(parseTaskBoardOrderInput(request({before_id:null,expected_before_revision:null})).before_id,null);
  const missing=request();delete missing.before_id;assert.throws(()=>parseTaskBoardOrderInput(missing),{status:400});
});

test('global normalization preserves ranked eligible IDs then complete canonical fallback, including children',()=>{
  const rows=[{id:3},{id:2},{id:1},{id:4,tarea_padre_id:2}],stored=[1,99,3];
  assert.deepEqual(normalizeTaskBoardOrder(stored,rows),[1,3,2,4]);
  assert.deepEqual(stored,[1,99,3]);assert.equal(rows[3].tarea_padre_id,2);
  assert.throws(()=>normalizeTaskBoardOrder([1,1],rows));
  assert.throws(()=>normalizeTaskBoardOrder([],Array.from({length:100001},(_,i)=>({id:i+1}))),{status:413});
});

test('one splice preserves every other task relative order; no-op and tail are exact',()=>{
  const order=[1,2,3,4,5];
  assert.deepEqual(moveTaskBoardOrder(order,4,2),[1,4,2,3,5]);
  assert.deepEqual(moveTaskBoardOrder(order,4,2).filter(id=>id!==4),order.filter(id=>id!==4));
  assert.deepEqual(moveTaskBoardOrder(order,2,3),order);
  assert.deepEqual(moveTaskBoardOrder(order,2,null),[1,3,4,5,2]);
  assert.throws(()=>moveTaskBoardOrder(order,2,2),{status:400});
  assert.deepEqual(order,[1,2,3,4,5]);
});

function fixture({role='edicion',member=true,inactive=false,epoch=2,missingActor=false,metaMissing=false,
  order=[1,2,3,4],orderRevision='1',tasks=[task(1),task(2),task(3),task(4,{tarea_padre_id:2})],
  eligibleRows=[{id:3},{id:2},{id:1},{id:4}],failAt=null,rollbackFails=false}={}){
  let state={meta:{revision:orderRevision,task_ids:[...order]},receipts:[]},baseline;
  const calls=[],failure=new Error('Synthetic storage failure'),rollbackError=new Error('Synthetic rollback failure');
  const db={release(error){calls.push({stage:'release',error});},async query(sql,values=[]){
    let stage;
    if(sql.startsWith('BEGIN'))stage='begin';else if(sql==='COMMIT')stage='commit';else if(sql==='ROLLBACK')stage='rollback';
    else if(sql.startsWith('SELECT id,rol,activo,session_version'))stage='actor';
    else if(sql.startsWith('SELECT revision::text'))stage='scope';
    else if(sql.includes('FROM task_board_order_receipts'))stage='receipt';
    else if(sql.startsWith('SELECT t.id,t.revision'))stage='tasks';
    else if(sql.startsWith('SELECT t.id FROM tareas t WHERE t.id=$1'))stage='permission';
    else if(sql.startsWith('SELECT t.id FROM tareas t WHERE'))stage='eligible';
    else if(sql.startsWith('UPDATE task_board_order SET'))stage='update';
    else if(sql.startsWith('INSERT INTO task_board_order_receipts'))stage='insert';
    else assert.fail(`Unexpected SQL ${sql}`);
    calls.push({stage,sql,values:structuredClone(values)});
    if(stage===failAt)throw failure;
    if(stage==='begin'){baseline=structuredClone(state);return{rows:[]};}
    if(stage==='rollback'){if(rollbackFails)throw rollbackError;if(baseline)state=baseline;return{rows:[]};}
    if(stage==='commit')return{rows:[]};
    if(stage==='actor')return{rows:missingActor?[]:[{id:values[0],rol:role,activo:!inactive,session_version:epoch}]};
    if(stage==='scope')return{rows:metaMissing?[]:[structuredClone(state.meta)]};
    if(stage==='receipt')return{rows:state.receipts.filter(row=>row.actor_user_id===values[0]&&row.request_id===values[1])};
    if(stage==='tasks')return{rows:tasks.filter(row=>values[0].includes(row.id)).sort((a,b)=>a.id-b.id).map(row=>structuredClone(row))};
    if(stage==='permission')return{rows:member||!sql.includes('tarea_asignaciones')?[{id:values[0]}]:[]};
    if(stage==='eligible')return{rows:structuredClone(eligibleRows)};
    if(stage==='update'){
      state.meta={revision:String(BigInt(state.meta.revision)+1n),task_ids:[...values[1]]};return{rows:[{revision:state.meta.revision}]};
    }
    if(stage==='insert'){
      state.receipts.push({actor_user_id:values[0],request_id:values[1],payload_hash:values[2],task_id:values[3],before_id:values[4],order_revision:values[5],changed:values[6]});
      return{rows:[]};
    }
  }};
  return{calls,tasks,failure,rollbackError,pool:{connect:async()=>db},get state(){return state;},
    setMember(value){member=value;},setRole(value){role=value;},
    run:(input=request(),actor=auth())=>reorderTaskBoard({connect:async()=>db},actor,input)};
}

test('actual move locks actor then singleton then sorted tasks, rechecks ID ACL, updates order/receipt only',async()=>{
  const f=fixture(),beforeTasks=structuredClone(f.tasks);
  assert.deepEqual(await f.run(),{task_id:2,before_id:1,order_revision:'2',replayed:false,changed:true});
  assert.deepEqual(f.state.meta,{revision:'2',task_ids:[2,1,3,4]});
  assert.deepEqual(f.tasks,beforeTasks);
  assert.deepEqual(f.calls.map(call=>call.stage),['begin','actor','scope','receipt','tasks','permission','eligible','update','insert','commit','release']);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.match(f.calls.find(call=>call.stage==='actor').sql,/FOR SHARE/);
  assert.match(f.calls.find(call=>call.stage==='scope').sql,/FOR UPDATE/);
  assert.match(f.calls.find(call=>call.stage==='tasks').sql,/ORDER BY t.id FOR SHARE OF t/);
  assert.deepEqual(f.calls.find(call=>call.stage==='tasks').values,[[1,2]]);
  assert.deepEqual(f.calls.find(call=>call.stage==='permission').values,[2,7]);
  const eligible=f.calls.find(call=>call.stage==='eligible');
  assert.ok(eligible.sql.includes(TASK_BOARD_ELIGIBILITY_SQL));assert.match(eligible.sql,/LIMIT 100001/);
  assert.doesNotMatch(eligible.sql,/tarea_asignaciones|tarea_padre_id/);
  assert.ok(f.calls.filter(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql||'')).every(call=>/task_board_order/.test(call.sql)));
  const result=f.state.receipts[0];assert.match(result.payload_hash,/^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(result).sort(),['actor_user_id','request_id','payload_hash','task_id','before_id','order_revision','changed'].sort());
});

test('no-op records receipt with current bigint revision but performs no order UPDATE',async()=>{
  const f=fixture({orderRevision:'9007199254740993'});
  const result=await f.run(request({task_id:1,before_id:2,expected_order_revision:'9007199254740993'}));
  assert.equal(result.changed,false);assert.equal(result.order_revision,'9007199254740993');
  assert.equal(f.calls.some(call=>call.stage==='update'),false);assert.equal(f.state.receipts.length,1);
});

test('tail move includes child tasks and preserves other relative order',async()=>{
  const f=fixture();await f.run(request({task_id:4,before_id:1}));
  assert.deepEqual(f.state.meta.task_ids,[4,1,2,3]);
  const g=fixture();await g.run(request({before_id:null,expected_before_revision:null}));
  assert.deepEqual(g.state.meta.task_ids,[1,3,4,2]);
});

test('same key uppercase replay returns original result despite changed order/task versions and missing old anchor',async()=>{
  const f=fixture();const original=await f.run();
  f.state.meta.revision='9';f.tasks.find(row=>row.id===2).revision=8;
  f.tasks.splice(f.tasks.findIndex(row=>row.id===1),1);
  const start=f.calls.length,before=structuredClone(f.state);
  assert.deepEqual(await f.run(request({request_id:requestId.toUpperCase()})),{...original,replayed:true});
  assert.deepEqual(f.state,before);
  const calls=f.calls.slice(start);assert.deepEqual(calls.find(call=>call.stage==='tasks').values,[[2]]);
  assert.equal(calls.some(call=>['eligible','update','insert'].includes(call.stage)),false);
});

test('receipt mismatch returns generic409 and never changes order or exposes stored digest',async()=>{
  const f=fixture();await f.run();const before=structuredClone(f.state);
  await assert.rejects(f.run(request({expected_order_revision:'2'})),error=>{
    assert.equal(error.status,409);assert.ok(!error.message.includes(f.state.receipts[0].payload_hash));return true;
  });
  assert.deepEqual(f.state,before);
});

test('actor scoping prevents another identity from replaying a committed receipt',async()=>{
  const f=fixture();await f.run();
  await assert.rejects(f.run(request(),auth({id:8})),{status:409});
  assert.equal(f.state.receipts.length,1);
  assert.deepEqual(f.calls.filter(call=>call.stage==='receipt').at(-1).values,[8,requestId]);
});

test('stale order/task/anchor and different canonical columns deny atomically',async()=>{
  const cases=[{input:request({expected_order_revision:'2'})},{input:request({expected_revision:2})},
    {input:request({expected_before_revision:2})},{options:{tasks:[task(1,{estado:'en_progreso'}),task(2),task(3),task(4)]}}];
  for(const item of cases){const f=fixture(item.options),before=structuredClone(f.state);
    await assert.rejects(f.run(item.input),{status:409});assert.deepEqual(f.state,before);
    assert.equal(f.calls.some(call=>['eligible','update','insert'].includes(call.stage)),false);
  }
  const f=fixture({tasks:[task(1,{estado:'finalizada'}),task(2,{estado:'publicada'}),task(3),task(4)]});
  assert.equal((await f.run()).changed,true,'legacy publicada shares only the finalized task column');
});

test('unavailable/noneligible scopes and revoked membership deny404 without business or order mutation',async()=>{
  for(const changes of [{propiedades_extra:{workspace:'historical'}},{propiedades_extra:{workspace:'render_os',archivada_render_os:true}},
    {propiedades_extra:{workspace:'render_os',papelera_render_os:'true'}},{estado:'programada'}]){
    const f=fixture({tasks:[task(1),task(2,changes)]}),before=structuredClone(f.state);
    await assert.rejects(f.run(),{status:404});assert.deepEqual(f.state,before);
  }
  const f=fixture({member:false,role:'diseno'});await assert.rejects(f.run(),{status:404});
  assert.equal(f.calls.some(call=>call.stage==='update'),false);
  const g=fixture({member:false,role:'admin'});assert.equal((await g.run()).changed,true,'only current DB admin bypasses ID membership');
});

test('current actor revalidation precedes singleton/receipt access, including stale cached admin',async()=>{
  for(const options of [{inactive:true},{epoch:3},{missingActor:true}]){
    const f=fixture(options);await assert.rejects(f.run(),{status:401});
    assert.deepEqual(f.calls.map(call=>call.stage),['begin','actor','rollback','release']);
  }
  await assert.rejects(reorderTaskBoard({connect:()=>assert.fail('No DB')},auth({id:'7'}),request()),{status:401});
});

test('receipt replay still requires current moved-task membership and eligibility',async()=>{
  const f=fixture();await f.run();f.tasks[1].propiedades_extra.archivada_render_os=true;
  await assert.rejects(f.run(),{status:404});assert.equal(f.state.receipts.length,1);
  const g=fixture();await g.run();g.setMember(false);g.setRole('diseno');
  await assert.rejects(g.run(),{status:404});assert.equal(g.state.receipts.length,1);
  const start=g.calls.length;g.setRole('admin');assert.equal((await g.run()).replayed,true);
  assert.equal(g.calls.slice(start).some(call=>['update','insert'].includes(call.stage)),false);
});

test('global overflow never truncates or commits; bigint exhaustion fails closed only for changed moves',async()=>{
  const f=fixture({eligibleRows:Array.from({length:100001},(_,i)=>({id:i+1}))});
  await assert.rejects(f.run(),{status:413});assert.equal(f.state.receipts.length,0);assert.equal(f.state.meta.revision,'1');
  const g=fixture({orderRevision:'9223372036854775807'});
  await assert.rejects(g.run(request({expected_order_revision:'9223372036854775807'})),{status:409});
  assert.equal(g.state.receipts.length,0);
});

for(const stage of ['begin','actor','scope','receipt','tasks','permission','eligible','update','insert','commit'])
  test(`${stage} storage failure rolls back order+receipt and releases without retry`,async()=>{
    const f=fixture({failAt:stage}),before=structuredClone(f.state);
    await assert.rejects(f.run(),error=>error===f.failure);assert.deepEqual(f.state,before);
    assert.equal(f.calls.at(-2).stage,'rollback');assert.equal(f.calls.at(-1).stage,'release');
  });

test('rollback failure preserves original failure and discards pooled client',async()=>{
  const f=fixture({failAt:'insert',rollbackFails:true});await assert.rejects(f.run(),error=>error===f.failure);
  assert.equal(f.calls.at(-1).error,f.rollbackError);
});

test('actual injected endpoint returns exact minimal result or safe400 without acquiring DB',async()=>{
  const f=fixture(),router=createTaskBoardOrderRouter({express,pool:f.pool});
  const handler=router.stack.find(layer=>layer.route?.path==='/').route.stack[0].handle;
  const run=async body=>{const res={code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
    await handler({auth:auth(),body},res,error=>{throw error});return res;};
  assert.deepEqual((await run(request())).body,{task_id:2,before_id:1,order_revision:'2',replayed:false,changed:true});
  const count=f.calls.length;assert.equal((await run({...request(),task_ids:[2,1]})).code,400);assert.equal(f.calls.length,count);
});

test('migration creates only constrained singleton presentation and minimal receipts, without task cascade or business backfill',()=>{
  const sql=readFileSync(new URL('../migrations/076_task_board_order.sql',import.meta.url),'utf8');
  assert.match(sql,/scope TEXT PRIMARY KEY CHECK \(scope = 'render_os'\)/);
  assert.match(sql,/revision BIGINT NOT NULL DEFAULT 1 CHECK \(revision > 0\)/);
  assert.match(sql,/cardinality\(ids\) > 100000/);assert.match(sql,/count\(DISTINCT item\)/);
  assert.match(sql,/item IS NULL OR item <= 0/);assert.match(sql,/array_ndims\(ids\) = 1/);
  assert.match(sql,/INSERT INTO task_board_order\(scope\) VALUES \('render_os'\)/);
  assert.match(sql,/PRIMARY KEY \(actor_user_id,request_id\)/);
  assert.doesNotMatch(sql,/REFERENCES tareas|UPDATE tareas|INSERT INTO tareas|DELETE FROM tareas|JSONB|CREATE TRIGGER/i);
});
