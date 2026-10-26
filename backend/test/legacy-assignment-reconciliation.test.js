import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { planLegacyAssignments, applyLegacyAssignments } from '../src/legacy-assignment-reconciliation.js';

// Synthetic query doubles only: no database, real roster or name inference.
const identity = { database:'reconciliation_unit', username:'unit', address:'127.0.0.1', port:55401 };
const options = () => ({ environment:'test', expectedIdentity:{...identity} });
const choices = () => [
  {task_id:9,owner_id:21,collaborator_ids:[23,22]},
  {task_id:2,owner_id:22,collaborator_ids:[]},
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function mock() {
  const queries=[], releases=[], committed=[];
  const state={identity:{...identity},universe:[2,9],tasks:[{id:2,source_hash:'a'.repeat(32)},{id:9,source_hash:'b'.repeat(32)}],
    users:[21,22,23].map(id=>({id,usuario:`unit_${id}`,nombre:'Same synthetic label',rol:'edicion',activo:true,session_version:1})),
    existing:[],pending:[],connects:0,fail:null,onConnect:null,rowCount:null};
  const client={release:value=>releases.push(value),async query(sql,params){
    queries.push({sql,params:structuredClone(params)});
    if(state.fail){const error=state.fail(sql);if(error)throw error;}
    if(sql.includes('current_database()'))return {rows:[structuredClone(state.identity)]};
    if(sql==='SELECT id FROM public.tareas ORDER BY id')return {rows:state.universe.map(id=>({id}))};
    if(sql.startsWith('SELECT t.id,md5('))return {rows:structuredClone(state.tasks)};
    if(sql.startsWith('SELECT id,usuario,nombre,rol,activo,session_version FROM usuarios'))return {rows:structuredClone(state.users)};
    if(sql.startsWith('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones'))return {rows:structuredClone(state.existing.filter(row=>params[0].includes(row.tarea_id)))};
    if(sql.startsWith('INSERT INTO tarea_asignaciones')){
      assert.match(sql,/unnest\(\$1::int\[\],\$2::int\[\],\$3::text\[\]\)/);
      state.pending=params[0].map((tarea_id,i)=>({tarea_id,usuario_id:params[1][i],tipo:params[2][i]}));
      return {rows:structuredClone(state.pending),rowCount:state.rowCount??state.pending.length};
    }
    if(sql==='COMMIT'){committed.push(...state.pending);state.pending=[];return {rows:[]};}
    if(sql==='ROLLBACK'){state.pending=[];return {rows:[]};}
    if(sql==='LOCK TABLE public.tarea_asignaciones IN SHARE ROW EXCLUSIVE MODE')return {rows:[]};
    if(sql==='LOCK TABLE public.tareas IN SHARE MODE')return {rows:[]};
    if(/^BEGIN|^SET LOCAL|^SELECT pg_advisory_xact_lock/.test(sql))return {rows:[]};
    throw Error('Unexpected SQL in isolated double');
  }};
  return {state,queries,releases,committed,pool:{async connect(){state.connects++;state.onConnect?.();return client;}}};
}
const writes=m=>m.queries.filter(q=>/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(q.sql));
async function reviewed(m){const plan=await planLegacyAssignments(m.pool,choices(),options());m.queries.length=0;return plan;}
const apply=(m,plan,extra={})=>applyLegacyAssignments(m.pool,plan,{...options(),approvedPlanHash:plan.plan_hash,...extra});

test('dry-run is RR read-only with exact identity, full-task SQL hash and ID-only snapshots',async()=>{
  const m=mock(), original=choices(), frozen=structuredClone(original);
  const plan=await planLegacyAssignments(m.pool,original,options());
  assert.deepEqual(original,frozen);assert.equal(plan.version,2);assert.equal(plan.environment,'test');
  assert.deepEqual(plan.identity,identity);
  assert.deepEqual(plan.choices,[{task_id:2,owner_id:22,collaborator_ids:[]},{task_id:9,owner_id:21,collaborator_ids:[22,23]}]);
  assert.deepEqual(plan.exceptions,[]);
  assert.deepEqual(plan.snapshot,{task_universe_ids:[2,9],tasks:m.state.tasks,users:m.state.users,exception_assignments:[]});
  const {plan_hash,...body}=plan;assert.equal(plan_hash,hash(body));
  assert.equal(m.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(m.queries.find(q=>q.sql.startsWith('SELECT t.id,md5(')).sql,/md5\(to_jsonb\(t\)::text\).*source_hash/s);
  assert.deepEqual(m.queries.find(q=>q.sql.includes('FROM usuarios')).params,[[21,22,23]]);
  assert.ok(m.queries.every(q=>!/FOR UPDATE|FOR SHARE|WHERE\s+nombre|OR\s+nombre/i.test(q.sql)));
  assert.deepEqual(writes(m),[]);assert.deepEqual(m.committed,[]);assert.deepEqual(m.releases,[undefined]);
});

test('closed choices reject malformed/duplicate/out-of-range IDs before leasing',async()=>{
  const c={task_id:2,owner_id:21,collaborator_ids:[]};
  const invalid=[null,{},[],Array(10001).fill(c),[null],[{...c,label:'not authority'}],[{task_id:2,owner_id:21}],
    [c,c],[{...c,collaborator_ids:[22,22]}],[{...c,collaborator_ids:[21]}],[{...c,collaborator_ids:null}],
    [{...c,collaborator_ids:Array(101).fill(22)}],...['2',0,-1,1.5,2147483648,Number.MAX_SAFE_INTEGER,NaN].flatMap(id=>
      [[{...c,task_id:id}],[{...c,owner_id:id}],[{...c,collaborator_ids:[id]}]])];
  for(const input of invalid){const m=mock();await assert.rejects(planLegacyAssignments(m.pool,input,options()));assert.equal(m.state.connects,0);}
});

test('production, remote and malformed expected identities reject before leasing in both entry points',async()=>{
  const valid=await reviewed(mock());
  for(const config of [{...options(),environment:'production'},{...options(),environment:'unknown'},
    ...[{...identity,address:'remote.example'},{...identity,port:'55401'},{...identity,port:65536},
      {...identity,database:''},{...identity,username:''}].map(expectedIdentity=>({...options(),expectedIdentity}))]){
    const m=mock();await assert.rejects(planLegacyAssignments(m.pool,choices(),config));
    await assert.rejects(applyLegacyAssignments(m.pool,valid,{...config,approvedPlanHash:valid.plan_hash}));
    assert.equal(m.state.connects,0);
  }
});

test('actual identity mismatch rolls back before domain reads or inserts',async()=>{
  for(const change of [{database:'other'},{username:'other'},{address:'192.0.2.1'},{port:55402}]){
    const m=mock();Object.assign(m.state.identity,change);
    await assert.rejects(planLegacyAssignments(m.pool,choices(),options()));
    assert.ok(m.queries.some(q=>q.sql==='ROLLBACK'));assert.deepEqual(writes(m),[]);
    assert.ok(!m.queries.some(q=>q.sql.includes('FROM tareas')));
  }
});

test('apply preflight rejects a changed actual identity before BEGIN or any write-path lock',async()=>{
  const plan=await reviewed(mock());
  for(const change of [{database:'other'},{username:'other'},{address:'192.0.2.1'},{port:55402}]){
    const m=mock();Object.assign(m.state.identity,change);
    await assert.rejects(apply(m,plan));
    assert.equal(m.queries.length,2);
    assert.match(m.queries[0].sql,/^SELECT current_database\(\)/);
    assert.equal(m.queries[1].sql,'ROLLBACK');
    assert.ok(!m.queries.some(q=>/^BEGIN|^LOCK TABLE|pg_advisory|FROM tareas|FROM usuarios/.test(q.sql)));
    assert.deepEqual(writes(m),[]);assert.deepEqual(m.committed,[]);
    assert.deepEqual(m.releases,[undefined]);
  }
});

test('plan rejects any existing membership, missing task, invalid hash or inactive/missing selected user',async()=>{
  for(const mutate of [m=>m.state.existing.push({tarea_id:2,usuario_id:21,tipo:'responsable'}),
    m=>m.state.tasks.pop(),m=>m.state.tasks[0].source_hash='not-md5',m=>m.state.users.pop(),
    m=>m.state.users[0].activo=false,m=>m.state.users[0].session_version=0]){
    const m=mock();mutate(m);await assert.rejects(planLegacyAssignments(m.pool,choices(),options()),e=>e.status===409);
    assert.deepEqual(writes(m),[]);assert.ok(m.queries.some(q=>q.sql==='ROLLBACK'));
  }
});

test('exact approved hash is mandatory; closed/tampered plans reject without a lease',async()=>{
  const plan=await reviewed(mock());
  for(const mutate of [p=>{p.version=1;},p=>{p.extra=true;},p=>{delete p.snapshot;},p=>{p.choices[0].owner_id=23;},
    p=>{p.snapshot.tasks[0].source_hash='c'.repeat(32);},p=>{p.snapshot.users[0].nombre='Changed';},
    p=>{p.identity.database='other';},p=>{p.environment='sandbox';}]){
    const m=mock(),bad=structuredClone(plan);mutate(bad);await assert.rejects(apply(m,bad));assert.equal(m.state.connects,0);
  }
  for(const approvedPlanHash of [undefined,'', '0'.repeat(64)]){
    const m=mock();await assert.rejects(apply(m,plan,{approvedPlanHash}));assert.equal(m.state.connects,0);
  }
});

test('apply serializes, locks sorted IDs, rechecks then makes one bulk membership INSERT only',async()=>{
  const m=mock(),plan=await reviewed(m),before=structuredClone({tasks:m.state.tasks,users:m.state.users});
  const result=await apply(m,plan);
  assert.deepEqual(result,{version:2,plan_hash:plan.plan_hash,tasks:2,assignments:4});
  assert.match(m.queries[0].sql,/^SELECT current_database\(\)/);
  assert.equal(m.queries[1].sql,'BEGIN ISOLATION LEVEL SERIALIZABLE');
  const tableLock=m.queries.findIndex(q=>q.sql==='LOCK TABLE public.tarea_asignaciones IN SHARE ROW EXCLUSIVE MODE');
  const universeLock=m.queries.findIndex(q=>q.sql==='LOCK TABLE public.tareas IN SHARE MODE');
  const gate=m.queries.findIndex(q=>q.sql.includes('pg_advisory_xact_lock'));
  const task=m.queries.findIndex(q=>q.sql.includes('FROM tareas'));
  const user=m.queries.findIndex(q=>q.sql.includes('FROM usuarios'));
  assert.ok(tableLock>1&&tableLock<gate&&gate<task&&gate<user);
  assert.equal(m.queries.filter(q=>q.sql.startsWith('LOCK TABLE')).length,2);
  assert.ok(universeLock>1&&universeLock<tableLock);
  assert.ok(m.queries.slice(2,tableLock).every(q=>q.sql.startsWith('SET LOCAL')||q.sql==='LOCK TABLE public.tareas IN SHARE MODE'),
    'No SELECT may establish a serializable snapshot before both table locks');
  assert.match(m.queries[task].sql,/ORDER BY t\.id FOR UPDATE OF t/);assert.deepEqual(m.queries[task].params,[[2,9]]);
  assert.match(m.queries[user].sql,/ORDER BY id FOR SHARE/);assert.deepEqual(m.queries[user].params,[[21,22,23]]);
  assert.equal(writes(m).length,1);
  assert.deepEqual(writes(m)[0].params,[[2,9,9,9],[22,21,22,23],['responsable','responsable','colaborador','colaborador']]);
  assert.deepEqual(m.committed,[{tarea_id:2,usuario_id:22,tipo:'responsable'},
    {tarea_id:9,usuario_id:21,tipo:'responsable'},{tarea_id:9,usuario_id:22,tipo:'colaborador'},{tarea_id:9,usuario_id:23,tipo:'colaborador'}]);
  assert.deepEqual({tasks:m.state.tasks,users:m.state.users},before);
  assert.equal(m.queries.at(-1).sql,'COMMIT');
});

test('stale task or any selected identity observation aborts the whole batch without writes',async()=>{
  const mutations=[m=>m.state.tasks[1].source_hash='c'.repeat(32),m=>m.state.tasks.pop(),
    ...Object.entries({usuario:'renamed_login',nombre:'Renamed label',rol:'admin',activo:false,session_version:2})
      .map(([key,value])=>m=>{m.state.users[0][key]=value;}),
    m=>m.state.existing.push({tarea_id:9,usuario_id:23,tipo:'colaborador'})];
  for(const mutate of mutations){const m=mock(),plan=await reviewed(m);mutate(m);
    await assert.rejects(apply(m,plan),e=>e.status===409);assert.deepEqual(writes(m),[]);
    assert.deepEqual(m.committed,[]);assert.equal(m.queries.at(-1).sql,'ROLLBACK');}
});

test('lease-time caller mutation cannot change captured choices, snapshots or target approval',async()=>{
  const m=mock(),selected=choices(),config=options();
  m.state.onConnect=()=>{selected[0].owner_id=999;selected[0].collaborator_ids.push(998);config.expectedIdentity.database='wrong';};
  const plan=await planLegacyAssignments(m.pool,selected,config);
  assert.equal(plan.choices[1].owner_id,21);assert.deepEqual(plan.identity,identity);
  m.state.onConnect=null;m.queries.length=0;
  m.state.onConnect=()=>{plan.choices[1].owner_id=999;plan.snapshot.tasks[0].source_hash='c'.repeat(32);plan.identity.database='wrong';};
  const approved=plan.plan_hash;const result=await apply(m,plan);
  assert.equal(result.plan_hash,approved);assert.ok(!writes(m)[0].params[1].includes(999));
});

test('short INSERT result rolls back all pending relations, never partial success',async()=>{
  const m=mock(),plan=await reviewed(m);m.state.rowCount=3;
  await assert.rejects(apply(m,plan),e=>e.status===409);
  assert.deepEqual(m.committed,[]);assert.deepEqual(m.state.pending,[]);assert.equal(m.queries.at(-1).sql,'ROLLBACK');
});

test('serialization/query failures never retry; rollback failure discards and preserves primary error',async()=>{
  for(const brokenRollback of [false,true]){
    const m=mock(),plan=await reviewed(m),primary=Object.assign(Error('synthetic serialization'),{code:'40001'}),rollback=Error('synthetic rollback');
    m.state.fail=sql=>sql.startsWith('INSERT INTO tarea_asignaciones')?primary:sql==='ROLLBACK'&&brokenRollback?rollback:null;
    await assert.rejects(apply(m,plan),e=>e===primary);
    assert.equal(writes(m).length,1);assert.deepEqual(m.committed,[]);
    assert.equal(m.releases.at(-1),brokenRollback?rollback:undefined);
    assert.ok(!m.queries.some(q=>q.sql==='COMMIT'));
  }
});

test('full task universe is hash-bound; a new ID outside choices invalidates an otherwise identical snapshot',async()=>{
  const m=mock(),plan=await reviewed(m),selected=structuredClone(plan.snapshot.tasks);
  m.state.universe.push(50);
  await assert.rejects(apply(m,plan),error=>error.status===409&&/universo/.test(error.message));
  assert.deepEqual(m.state.tasks,selected);assert.deepEqual(writes(m),[]);assert.deepEqual(m.committed,[]);
  assert.equal(m.queries.at(-1).sql,'ROLLBACK');
});

test('deleting or replacing an outside-choice exception ID also invalidates universe',async()=>{
  for(const mutate of [ids=>ids.pop(),ids=>{ids[2]=70;}]){
    const m=mock();m.state.universe.push(50);
    const plan=await planLegacyAssignments(m.pool,choices(),{...options(),exceptions:[{task_id:50,reason:'Deferred by explicit review'}]});
    m.queries.length=0;mutate(m.state.universe);
    await assert.rejects(apply(m,plan),error=>error.status===409);assert.deepEqual(writes(m),[]);
  }
});

test('coverage is exhaustive: omitted IDs fail, explicit closed exceptions are sorted and approved',async()=>{
  const m=mock();m.state.universe.push(50,70);
  await assert.rejects(planLegacyAssignments(m.pool,choices(),options()),error=>error.status===409);
  assert.deepEqual(writes(m),[]);
  const exceptions=[{task_id:70,reason:' Out of scope; no implicit reassignment '},{task_id:50,reason:'Already assigned; preserve'}];
  m.state.existing=[{tarea_id:50,usuario_id:23,tipo:'responsable'},{tarea_id:70,usuario_id:22,tipo:'colaborador'}];
  const before=structuredClone({tasks:m.state.tasks,users:m.state.users,existing:m.state.existing});
  const plan=await planLegacyAssignments(m.pool,choices(),{...options(),exceptions});
  assert.deepEqual(plan.exceptions,[{task_id:50,reason:'Already assigned; preserve'},{task_id:70,reason:'Out of scope; no implicit reassignment'}]);
  assert.deepEqual(plan.snapshot.task_universe_ids,[2,9,50,70]);assert.deepEqual(plan.snapshot.exception_assignments,m.state.existing);
  m.queries.length=0;const result=await apply(m,plan);assert.equal(result.assignments,4);
  assert.deepEqual(writes(m)[0].params[0],[2,9,9,9]);assert.deepEqual({tasks:m.state.tasks,users:m.state.users,existing:m.state.existing},before);
  assert.ok(!m.committed.some(row=>[50,70].includes(row.tarea_id)));
});

test('exception membership drift is rejected without overwriting existing relations',async()=>{
  const m=mock();m.state.universe.push(50);m.state.existing=[{tarea_id:50,usuario_id:23,tipo:'responsable'}];
  const plan=await planLegacyAssignments(m.pool,choices(),{...options(),exceptions:[{task_id:50,reason:'Preserve known normalized assignment'}]});
  m.state.existing[0].usuario_id=22;m.queries.length=0;
  await assert.rejects(apply(m,plan),error=>error.status===409);assert.deepEqual(writes(m),[]);assert.equal(m.state.existing[0].usuario_id,22);
});

test('exceptions reject unreviewed shapes, controls, duplicate IDs and choice overlap before leasing',async()=>{
  for(const exceptions of [null,{},[{task_id:50}], [{task_id:50,reason:'ok',owner_id:21}],
    [{task_id:50,reason:''}],[{task_id:50,reason:'   '}],[{task_id:50,reason:'x'.repeat(501)}],
    [{task_id:50,reason:'bad\nreason'}],[{task_id:50,reason:'bad\0reason'}],
    [{task_id:'50',reason:'ok'}],[{task_id:0,reason:'ok'}],[{task_id:50,reason:'ok'},{task_id:50,reason:'other'}],
    [{task_id:2,reason:'Cannot be both selected and excepted'}]]){
    const m=mock();await assert.rejects(planLegacyAssignments(m.pool,choices(),{...options(),exceptions}));assert.equal(m.state.connects,0);
  }
});

test('nonexistent exception IDs cannot satisfy coverage and malformed universe results fail closed',async()=>{
  for(const universe of [[2,9],[2,2,9],[9,2],['2',9],[0,2,9]]){
    const m=mock();m.state.universe=universe;
    await assert.rejects(planLegacyAssignments(m.pool,choices(),{...options(),exceptions:[{task_id:50,reason:'Not a live task'}]}),error=>error.status===409);
    assert.deepEqual(writes(m),[]);
  }
});

test('v1 plans are rejected before leasing; universe, exceptions and their observations cannot be tampered',async()=>{
  const valid=await reviewed(mock());
  const legacy={...valid,version:1};delete legacy.exceptions;delete legacy.snapshot.task_universe_ids;delete legacy.snapshot.exception_assignments;
  const old=mock();await assert.rejects(apply(old,legacy));assert.equal(old.state.connects,0);
  for(const mutate of [p=>{p.snapshot.task_universe_ids.push(99);},p=>{delete p.snapshot.task_universe_ids;},
    p=>{p.exceptions.push({task_id:99,reason:'Late decision'});},p=>{p.snapshot.exception_assignments.push({tarea_id:99,usuario_id:21,tipo:'responsable'});}]){
    const m=mock(),plan=await reviewed(m);mutate(plan);m.state.connects=0;
    await assert.rejects(apply(m,plan));assert.equal(m.state.connects,0);assert.deepEqual(writes(m),[]);
  }
});

test('choices and exceptions are captured before lease; queued mutations do not change the reviewed scope',async()=>{
  const m=mock();m.state.universe.push(50);const exceptions=[{task_id:50,reason:'Keep task unchanged'}];
  m.state.onConnect=()=>{exceptions[0].task_id=999;exceptions[0].reason='Changed while queued';};
  const plan=await planLegacyAssignments(m.pool,choices(),{...options(),exceptions});
  assert.deepEqual(plan.exceptions,[{task_id:50,reason:'Keep task unchanged'}]);
  m.state.onConnect=()=>{plan.exceptions[0].task_id=999;plan.snapshot.task_universe_ids.push(999);};
  const result=await apply(m,plan);assert.equal(result.assignments,4);assert.ok(!m.committed.some(row=>row.tarea_id===999));
});

test('task-table wait precedes the first serial snapshot so a newly committed outside ID rejects',async()=>{
  const m=mock(),plan=await reviewed(m);let injected=false;
  m.state.fail=sql=>{if(sql==='LOCK TABLE public.tareas IN SHARE MODE'){m.state.universe.push(50);injected=true;}return null;};
  await assert.rejects(apply(m,plan),error=>error.status===409);assert.equal(injected,true);assert.deepEqual(writes(m),[]);
  const begin=m.queries.findIndex(query=>query.sql.startsWith('BEGIN'));
  const universe=m.queries.findIndex(query=>query.sql==='SELECT id FROM public.tareas ORDER BY id');
  const parentLock=m.queries.findIndex(query=>query.sql==='LOCK TABLE public.tareas IN SHARE MODE');
  const assignmentLock=m.queries.findIndex(query=>query.sql.startsWith('LOCK TABLE public.tarea_asignaciones'));
  assert.ok(begin<parentLock&&parentLock<assignmentLock&&assignmentLock<universe);
  assert.ok(m.queries.slice(begin+1,assignmentLock).every(query=>!query.sql.startsWith('SELECT')));
});

test('338 explicit owners plus 12 collaborators still produce exactly 350 bindings with source rows untouched',async()=>{
  const m=mock();m.state.universe=Array.from({length:338},(_,index)=>index+1);
  m.state.tasks=m.state.universe.map(id=>({id,source_hash:'a'.repeat(32)}));m.state.users=m.state.users.filter(user=>[21,22].includes(user.id));
  const selected=m.state.universe.map((task_id,index)=>({task_id,owner_id:21,collaborator_ids:index<12?[22]:[]}));
  const before=structuredClone({tasks:m.state.tasks,users:m.state.users});
  const plan=await planLegacyAssignments(m.pool,selected,options());m.queries.length=0;
  const result=await apply(m,plan);assert.equal(result.tasks,338);assert.equal(result.assignments,350);assert.equal(m.committed.length,350);
  assert.equal(m.committed.filter(row=>row.tipo==='responsable').length,338);assert.equal(m.committed.filter(row=>row.tipo==='colaborador').length,12);
  assert.deepEqual({tasks:m.state.tasks,users:m.state.users},before);assert.equal(writes(m).length,1);
});
