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
  const state={identity:{...identity},tasks:[{id:2,source_hash:'a'.repeat(32)},{id:9,source_hash:'b'.repeat(32)}],
    users:[21,22,23].map(id=>({id,usuario:`unit_${id}`,nombre:'Same synthetic label',rol:'edicion',activo:true,session_version:1})),
    existing:[],pending:[],connects:0,fail:null,onConnect:null,rowCount:null};
  const client={release:value=>releases.push(value),async query(sql,params){
    queries.push({sql,params:structuredClone(params)});
    if(state.fail){const error=state.fail(sql);if(error)throw error;}
    if(sql.includes('current_database()'))return {rows:[structuredClone(state.identity)]};
    if(sql.startsWith('SELECT t.id,md5('))return {rows:structuredClone(state.tasks)};
    if(sql.startsWith('SELECT id,usuario,nombre,rol,activo,session_version FROM usuarios'))return {rows:structuredClone(state.users)};
    if(sql.startsWith('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones'))return {rows:structuredClone(state.existing)};
    if(sql.startsWith('INSERT INTO tarea_asignaciones')){
      assert.match(sql,/unnest\(\$1::int\[\],\$2::int\[\],\$3::text\[\]\)/);
      state.pending=params[0].map((tarea_id,i)=>({tarea_id,usuario_id:params[1][i],tipo:params[2][i]}));
      return {rows:structuredClone(state.pending),rowCount:state.rowCount??state.pending.length};
    }
    if(sql==='COMMIT'){committed.push(...state.pending);state.pending=[];return {rows:[]};}
    if(sql==='ROLLBACK'){state.pending=[];return {rows:[]};}
    if(sql==='LOCK TABLE public.tarea_asignaciones IN SHARE ROW EXCLUSIVE MODE')return {rows:[]};
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
  assert.deepEqual(original,frozen);assert.equal(plan.version,1);assert.equal(plan.environment,'test');
  assert.deepEqual(plan.identity,identity);
  assert.deepEqual(plan.choices,[{task_id:2,owner_id:22,collaborator_ids:[]},{task_id:9,owner_id:21,collaborator_ids:[22,23]}]);
  assert.deepEqual(plan.snapshot,{tasks:m.state.tasks,users:m.state.users});
  const {plan_hash,...body}=plan;assert.equal(plan_hash,hash(body));
  assert.equal(m.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(m.queries.find(q=>q.sql.includes('FROM tareas')).sql,/md5\(to_jsonb\(t\)::text\).*source_hash/s);
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
  for(const mutate of [p=>{p.version=2;},p=>{p.extra=true;},p=>{delete p.snapshot;},p=>{p.choices[0].owner_id=23;},
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
  assert.deepEqual(result,{version:1,plan_hash:plan.plan_hash,tasks:2,assignments:4});
  assert.match(m.queries[0].sql,/^SELECT current_database\(\)/);
  assert.equal(m.queries[1].sql,'BEGIN ISOLATION LEVEL SERIALIZABLE');
  const tableLock=m.queries.findIndex(q=>q.sql==='LOCK TABLE public.tarea_asignaciones IN SHARE ROW EXCLUSIVE MODE');
  const gate=m.queries.findIndex(q=>q.sql.includes('pg_advisory_xact_lock'));
  const task=m.queries.findIndex(q=>q.sql.includes('FROM tareas'));
  const user=m.queries.findIndex(q=>q.sql.includes('FROM usuarios'));
  assert.ok(tableLock>1&&tableLock<gate&&gate<task&&gate<user);
  assert.equal(m.queries.filter(q=>q.sql.startsWith('LOCK TABLE')).length,1);
  assert.ok(m.queries.slice(2,tableLock).every(q=>q.sql.startsWith('SET LOCAL')),
    'No SELECT may establish a serializable snapshot before the assignment-table lock');
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
