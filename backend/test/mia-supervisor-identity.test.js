import test from 'node:test';
import assert from 'node:assert/strict';
import { runMiaSupervisor, recordSupervisorReply, recordSupervisorBlockerReply, supervisorNotificationDeliverable, createMiaSupervisorRouter, acceptSupervisorDeadline } from '../src/mia-supervisor.js';
import { fingerprint, proposalSnapshot } from '../src/mia-supervisor-policy.js';

const now = new Date('2026-10-02T13:00:00Z');
const env = { MIA_SUPERVISOR_ENABLED:'true' };
const task = { id:10,titulo:'Design',asignado_a:'Alex',estado:'pendiente',fecha_vencimiento:null,
  propiedades_extra:{workspace:'render_os',colaboradores:['Alex']},asignado_a_id:999,colaborador_ids:[999] };
const users = [{id:1,nombre:'Alex',usuario:'alex',rol:'diseno',activo:true},
  {id:2,nombre:'Alex',usuario:'alex2',rol:'diseno',activo:true}];

function fakeDb({ bindings = [], actor = users[0], followup = null, tasks = [task], proposal = null, cachedReply = null } = {}) {
  const queries = [];
  const db = {
    queries,
    async query(sql, params = []) {
      queries.push({sql,params});
      if (sql.includes('FROM tarea_asignaciones')) return {rows:bindings};
      if (sql.includes('FROM mia_supervisor_replies WHERE actor_hash=$1')) return {rows:cachedReply ? [cachedReply] : []};
      if (sql.includes('FROM mia_supervisor_proposals WHERE id=$1')) return {rows:proposal ? [proposal] : []};
      if (sql.includes('FROM tareas t')) return {rows:tasks};
      if (sql.includes('FROM usuarios WHERE id=$1')) {
        assert.match(sql,/activo IS TRUE/);
        return {rows:actor?.activo === false || !actor ? [] : [actor]};
      }
      if (sql.includes('FROM usuarios WHERE activo IS TRUE')) return {rows:users};
      if (sql.includes('FROM mia_supervisor_followups f JOIN usuarios')) {
        assert.match(sql,/u.activo IS TRUE/);
        return {rows:followup ? [followup] : []};
      }
      return {rows:[]};
    },
    async connect() { return db; },
    release() {},
  };
  return db;
}
const binding = (id, tipo = 'responsable') => ({tarea_id:10,usuario_id:id,tipo});

test('background snapshot plans only normalized members, not matching historical names or DTO guesses', async () => {
  for (const [bindings, expected] of [[[],[]],[[binding(2)],[2]],[[binding(1),binding(2,'colaborador')],[1,2]]]) {
    const db = fakeDb({bindings});
    const result = await runMiaSupervisor(db,{now,env});
    assert.deepEqual(result.proposals[0].responsible_ids,expected);
    assert.equal(db.queries.filter(q=>q.sql.includes('FROM tarea_asignaciones')).length,1);
    assert.ok(db.queries.every(q=>/^SELECT/.test(q.sql)),'dry run performs only SELECTs');
  }
});

test('HTTP context filters homonyms by annotated IDs; rename works and removed binding revokes access', async () => {
  const routes = new Map();
  const router = {get:(path,handler)=>routes.set(path,handler),post:()=>{}};
  for (const [bindings,actor,expected] of [
    [[binding(2)],users[0],[]],
    [[binding(1)],{...users[0],nombre:'Renamed',usuario:'renamed'},[10]],
    [[],users[0],[]],
  ]) {
    const db = fakeDb({bindings,actor});
    createMiaSupervisorRouter({express:{Router:()=>router},pool:db,isSystemActor:()=>false,env});
    const result = await new Promise((resolve,reject)=>{
      routes.get('/contexto')({wilson:{privateChat:true,userId:actor.id,actorId:'qa'}},{json:resolve,status:()=>({json:reject})},reject);
    });
    assert.deepEqual(result.tasks.map(t=>t.id),expected);
  }
});

test('transaction task load authorizes only normalized IDs and rejects disabled actors', async () => {
  const actor = {privateChat:true,userId:1,actorId:'qa'};
  for (const bindings of [[],[binding(2)]]) {
    await assert.rejects(recordSupervisorReply(fakeDb({bindings}),{actor,taskId:10,messageId:'qa',input:{texto:'ok'},now,env}),{status:403});
  }
  const allowed = await recordSupervisorReply(fakeDb({bindings:[binding(1)],actor:{...users[0],nombre:'Renamed'}}),
    {actor,taskId:10,messageId:'qa',input:{texto:'ok'},now,env});
  assert.equal(allowed.needs_more,true,'report validation remains intact after authorization');
  await assert.rejects(recordSupervisorReply(fakeDb({bindings:[binding(1)],actor:{...users[0],activo:false}}),
    {actor,taskId:10,messageId:'qa',input:{texto:'ok'},now,env}),{status:403});
});

test('delivery uses followup usuario_id (not followup id) and revokes removed collaborators', async () => {
  const datedTask = {...task,fecha_vencimiento:'2026-09-30'};
  // Obtain the cycle from the existing protocol, not from names.
  const followup = {id:88,usuario_id:2,nombre:'Alex',estado:'waiting',tipo:'overdue',attempts:0,
    cycle_key:fingerprint([10,2,'2026-09-30'])};
  const notice = {tarea_id:10,supervisor_followup_id:88,supervisor_attempt:1,detalles:{supervisor:true,message_version:2}};
  const run = bindings => supervisorNotificationDeliverable(fakeDb({bindings,followup,tasks:[datedTask]}),notice,{env,now,ignoreContact:true});
  assert.equal(await run([binding(1),binding(2,'colaborador')]),true);
  assert.equal(await run([binding(1)]),false);
  assert.equal(await run([binding(88)]),false,'followup primary key never grants task access');
});

test('deadline acceptance rejects a proposal after membership changes with unchanged labels', async () => {
  const proposal = {id:'11111111-1111-4111-8111-111111111111',fecha:'2026-10-05',
    snapshot_hash:proposalSnapshot({...task,asignado_a_id:1,colaborador_ids:[2]})};
  const db = fakeDb({bindings:[binding(1)],proposal});
  await assert.rejects(acceptSupervisorDeadline(db,{actor:{privateChat:true,userId:1,actorId:'qa'},
    taskId:10,proposalId:proposal.id,messageId:'stale-membership',now,env}),{status:409});
  assert.equal(db.queries.some(q=>q.sql.startsWith('UPDATE tareas')),false);
});

const proposalId = '11111111-1111-4111-8111-111111111111';
const replayCases = [
  { name:'record_reply', run:recordSupervisorReply, args:{input:{texto:'Estoy editando'}}, payload:{texto:'Estoy editando'} },
  { name:'accept_deadline', run:acceptSupervisorDeadline, args:{proposalId}, payload:{proposalId,date:undefined} },
  { name:'blocker_reply', run:recordSupervisorBlockerReply, args:{input:{texto:'Envié el material'}}, payload:{texto:'Envié el material'} },
];
function cachedFor(operation, overrides = {}) {
  return {usuario_id:1,tarea_id:10,payload_hash:fingerprint([operation.name,10,operation.payload]),
    resultado:{recorded:true,tarea_id:10,message:'Private cached result'},...overrides};
}
function replay(operation, db) {
  return operation.run(db,{actor:{privateChat:true,userId:1,actorId:'same-whatsapp'},taskId:10,
    messageId:'same-message',now,env,...operation.args});
}
const blockerTask = {...task,propiedades_extra:{...task.propiedades_extra,supervisor_bloqueo:{usuario_id:1}}};

for (const operation of replayCases) {
  test(`${operation.name}: relinking actor hash cannot disclose old account result even when new user owns task`, async () => {
    const db = fakeDb({actor:users[1],bindings:[binding(2)],tasks:[blockerTask],cachedReply:cachedFor(operation)});
    await assert.rejects(replay(operation,db),{status:403});
    assert.equal(db.queries.some(q=>q.sql==='COMMIT'),false);
  });

  test(`${operation.name}: replay rechecks current membership or blocker authorization`, async () => {
    const db = fakeDb({bindings:[binding(2)],cachedReply:cachedFor(operation)});
    await assert.rejects(replay(operation,db),{status:403});
    assert.ok(db.queries.some(q=>q.sql.includes('FROM tarea_asignaciones')));
    assert.equal(db.queries.some(q=>q.sql==='COMMIT'),false);
  });

  test(`${operation.name}: same authorized user can replay completed task without writes`, async () => {
    const db = fakeDb({bindings:[binding(1)],tasks:[{...blockerTask,estado:'publicada'}],cachedReply:cachedFor(operation)});
    const result = await replay(operation,db);
    assert.equal(result.idempotent,true);
    assert.equal(result.message,'Private cached result');
    assert.ok(db.queries.some(q=>q.sql==='COMMIT'));
    assert.equal(db.queries.some(q=>/^(INSERT|UPDATE|DELETE)/.test(q.sql)),false);
  });

  test(`${operation.name}: replay rejects disabled accounts, hidden tasks and mismatched task IDs`, async () => {
    const inactive = fakeDb({actor:{...users[0],activo:false},bindings:[binding(1)],cachedReply:cachedFor(operation)});
    await assert.rejects(replay(operation,inactive),{status:403});
    for (const field of ['archivada_render_os','papelera_render_os']) {
      const db = fakeDb({bindings:[binding(1)],cachedReply:cachedFor(operation),
        tasks:[{...blockerTask,estado:'publicada',propiedades_extra:{...blockerTask.propiedades_extra,[field]:true}}]});
      await assert.rejects(replay(operation,db),{status:404});
    }
    await assert.rejects(replay(operation,fakeDb({bindings:[binding(1)],cachedReply:cachedFor(operation,{tarea_id:11})})),{status:409});
  });
}

test('reply and blocker routes cannot reuse each other message even with identical payload', async () => {
  const ordinary = replayCases[0];
  const db = fakeDb({bindings:[binding(1)],tasks:[blockerTask],cachedReply:cachedFor(ordinary)});
  await assert.rejects(recordSupervisorBlockerReply(db,{actor:{privateChat:true,userId:1,actorId:'same-whatsapp'},
    taskId:10,messageId:'same-message',now,env,input:ordinary.payload}),{status:409});
});

test('legacy unscoped replay hashes fail closed, not guessed from payload shape', async () => {
  const operation = replayCases[0];
  const db = fakeDb({bindings:[binding(1)],cachedReply:cachedFor(operation,{payload_hash:fingerprint([10,operation.payload])})});
  await assert.rejects(replay(operation,db),{status:409});
});

test('blocker replay needs current blocker permission even if user is still task owner', async () => {
  const db = fakeDb({bindings:[binding(1)],cachedReply:cachedFor(replayCases[2])});
  await assert.rejects(replay(replayCases[2],db),{status:403});
});

test('new replies persist operation-scoped fingerprint and current mapped user ID', async () => {
  const operation = replayCases[0];
  const db = fakeDb({bindings:[binding(1)]});
  await replay(operation,db);
  const insert = db.queries.find(q=>q.sql.startsWith('INSERT INTO mia_supervisor_replies('));
  assert.equal(insert.params[0],1);
  assert.equal(insert.params[4],fingerprint([operation.name,10,operation.payload]));
});
