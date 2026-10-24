import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeRelatedTasks } from "../../frontend/src/features/render-os/utils/task-state.js";
import {createCapturedRequest,isSessionFailure} from '../../frontend/src/shared/session/captured-request.js';
import {observeWorkspaceBrief} from './helpers/workspace-brief-fixture.js';

const source = readFileSync(new URL("../../frontend/src/pages/WorkspaceReadOnly.jsx",import.meta.url),"utf8");
const section = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const handlers = section("  const productionTaskSnapshot =", "  const approveTask =");
const task = {id:10,revision:2,asignado_a_id:1,colaborador_ids:[2],cliente_nombre:"Client",updated_at:"same-ms"};
const latest = {...task,revision:5};
const updated = {...latest,revision:6,asignado_a_id:3,colaborador_ids:[4]};
const conflict = Object.assign(new Error("stale"),{status:409});

function setup({request = async()=>updated,refresh = async()=>updated,snapshot = latest} = {}) {
  const tasksRef = {current:[snapshot]};
  let tasks = [snapshot];
  const notices = [], requests = [], refreshes = [], stale = [];
  let session={token:'synthetic-production',usuario:{id:1,rol:'admin',activo:true}};
  const transport=async(url,options={})=>{
    assert.equal(new Headers(options.headers).get('Authorization'),'Bearer synthetic-production');
    if(!options.method || options.method==='GET') {
      const id=Number(url.match(/\/tareas\/(\d+)/)[1]); refreshes.push(id); return refresh(id);
    }
    requests.push({url,...options,body:JSON.parse(options.body)}); return request(url,options);
  };
  const context = {tasksRef,setTasks:fn=>{tasks=fn(tasks);},mergeRelatedTasks,
    markReviewQueueStale:(guard,uncertain=false)=>{guard.assertCurrent();stale.push({guard,uncertain});},
    captureRequest:()=>createCapturedRequest({session,readSession:()=>session,request:transport}),isSessionFailure,
    notify:(...args)=>notices.push(args)};
  const result = new Function(...Object.keys(context),`${handlers}\nreturn {registerProduction,correctProduction,confirmProduction};`)(...Object.values(context));
  return {...result,tasksRef,notices,requests,refreshes,stale,get tasks(){return tasks;},changeSession:()=>{session={...session,token:'synthetic-B',usuario:{...session.usuario,id:2}};}};
}
const operations = [
  {name:"add",call:(h,visible=task)=>h.registerProduction(visible,2,"2026-10-19",false),method:"POST",suffix:"/registros?workspace=render_os"},
  {name:"correct",call:(h,visible=task)=>h.correctProduction(visible,{id:99,cantidad:1},2),method:"PATCH",suffix:"/registros/99?workspace=render_os"},
  {name:"confirm",call:(h,visible=task)=>h.confirmProduction(visible),method:"POST",suffix:"/confirmar?workspace=render_os"},
];

for (const operation of operations) {
  test(`${operation.name} sends visible snapshot revision and preserves returned IDs/revision`,async()=>{
    const h = setup({request:async()=>operation.name === "confirm" ? {task:updated,editing_task:{id:11,revision:1,asignado_a_id:7,colaborador_ids:[8]},created:true} : updated});
    await operation.call(h);
    assert.deepEqual(h.stale.map(call=>call.uncertain),[false]);
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].method,operation.method);
    assert.ok(h.requests[0].url.endsWith(operation.suffix));
    assert.equal(h.requests[0].body.expected_revision,2);
    for (const list of [h.tasks,h.tasksRef.current]) {
      assert.equal(list.find(t=>t.id===10).revision,6);
      assert.equal(list.find(t=>t.id===10).asignado_a_id,3);
      assert.deepEqual(list.find(t=>t.id===10).colaborador_ids,[4]);
    }
    if (operation.name === "confirm") {
      assert.equal(h.tasksRef.current.find(t=>t.id===11).revision,1);
      assert.deepEqual(h.tasks.find(t=>t.id===11).colaborador_ids,[8]);
    }
  });

  test(`${operation.name} conflict refreshes IDs/revision once, never retries mutation`,async()=>{
    const h = setup({request:async()=>{throw conflict;}});
    await assert.rejects(operation.call(h),error=>error===conflict);
    assert.equal(h.requests.length,1);
    assert.deepEqual(h.refreshes,[10]);
    assert.deepEqual(h.stale.map(call=>call.uncertain),[true]);
    assert.equal(h.tasks[0].revision,6);
    assert.equal(h.tasksRef.current[0].asignado_a_id,3);
    assert.deepEqual(h.tasksRef.current[0].colaborador_ids,[4]);
    assert.match(h.notices[0][0],/conservamos tus datos ingresados/);
  });

  test(`${operation.name} failed conflict refresh preserves snapshot and never retries`,async()=>{
    const h = setup({request:async()=>{throw conflict;},refresh:async()=>{throw Error("offline");}});
    await assert.rejects(operation.call(h),{status:409});
    assert.equal(h.requests.length,1);
    assert.equal(h.tasksRef.current[0].revision,5);
    assert.equal(h.tasks[0].revision,5);
    assert.deepEqual(h.stale.map(call=>call.uncertain),[true]);
    assert.match(h.notices[0][0],/no se pudo recargar/);
  });

  test(`${operation.name} rejects invalid snapshot revisions locally`,async()=>{
    for (const revision of [undefined,null,"5",0,-1,1.5,NaN,Infinity]) {
      const h = setup({snapshot:{...latest,revision}});
      await assert.rejects(operation.call(h,{...task,revision}),/revisión actual/);
      assert.equal(h.requests.length,0);
      assert.ok(h.stale.every(call=>call.uncertain), 'Local validation must never claim a confirmed write');
    }
  });
}

test("next intentional action uses the returned visible task revision",async()=>{
  let revision=5;
  const h=setup({request:async()=>({...updated,revision:++revision})});
  const returned = await h.registerProduction(task,2,"2026-10-19");
  await h.correctProduction(returned,{id:99,cantidad:1},3);
  assert.deepEqual(h.requests.map(r=>r.body.expected_revision),[2,6]);
  assert.equal(h.tasksRef.current[0].revision,7);
  assert.deepEqual(h.stale.map(call=>call.uncertain),[false,false]);
});

for (const operation of operations) {
  test(`${operation.name} stale visible revision 7 is not rebased to ref 8; explicit retry uses refreshed visible 8`,async()=>{
    const visible = {...task,revision:7};
    const refreshed = {...updated,revision:8};
    let attempts=0;
    const h=setup({snapshot:refreshed,refresh:async()=>refreshed,request:async()=>{
      if (++attempts === 1) throw conflict;
      return operation.name === "confirm" ? {task:{...refreshed,revision:9}} : {...refreshed,revision:9};
    }});
    await assert.rejects(operation.call(h,visible),{status:409});
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].body.expected_revision,7);
    await operation.call(h,h.tasks[0]);
    assert.deepEqual(h.requests.map(r=>r.body.expected_revision),[7,8]);
    assert.deepEqual(h.stale.map(call=>call.uncertain),[true,false]);
  });
}

test("detail add conflict retains amount/date, clears busy state, and does not leak rejection",async()=>{
  const body=section("  const registerProduction = async (finish", "  const confirmProduction = async ()");
  let amount=4;
  const busy=[];
  const context={canRegisterProduction:true,registeringProduction:false,metadata:{},task,productionAmount:amount,
    captureRequest:()=>createCapturedRequest({session:{token:'synthetic-detail',usuario:{id:1,rol:'admin'}},readSession:()=>({token:'synthetic-detail',usuario:{id:1,rol:'admin'}})}),isSessionFailure,
    productionDate:"2026-10-19",setRegisteringProduction:v=>busy.push(v),setProductionAmount:v=>{amount=v;},
    onRegisterProduction:async()=>{throw conflict;}};
  const run=new Function(...Object.keys(context),`${body}\nreturn registerProduction;`)(...Object.values(context));
  await run(false);
  assert.equal(amount,4);
  assert.deepEqual(busy,[true,false]);
});

test("correction prompt retains failed input for explicit resubmission",async()=>{
  const body=section("  const correctProduction = async (record)","  const approveForOriana =");
  let corrections={};
  const defaults=[];
  let calls=0;
  const run=()=>{
    const context={task,canRegisterProduction:true,productionCorrections:corrections,setProductionCorrections:fn=>{corrections=fn(corrections);},
      captureRequest:()=>createCapturedRequest({session:{token:'synthetic-detail',usuario:{id:1,rol:'admin'}},readSession:()=>({token:'synthetic-detail',usuario:{id:1,rol:'admin'}})}),isSessionFailure,
      window:{prompt:(_label,value)=>{defaults.push(value);return "7";}},
      onCorrectProduction:async()=>{calls++;throw conflict;}};
    return new Function(...Object.keys(context),`${body}\nreturn correctProduction;`)(...Object.values(context))({id:99,cantidad:1});
  };
  await run();
  await run();
  assert.deepEqual(defaults,["1","7"]);
  assert.equal(calls,2,'second request requires a second explicit invocation');
  assert.equal(corrections[99],"7");
});

test("editor protection tracks revisions even if timestamps share the same millisecond",()=>{
  assert.match(source,/\[task\?\.updated_at, task\?\.revision\]/);
  const baseline = {...task,titulo:'Original',aclaraciones:'Original brief'};
  const remote = {...baseline,revision:3,titulo:'Remote'};
  const draft = {...baseline,aclaraciones:'Unsaved brief'};
  assert.deepEqual(observeWorkspaceBrief(source,{task:remote,baseline,draft}),{baseline,writes:[]});
  assert.deepEqual(observeWorkspaceBrief(source,{task:remote,baseline,draft:baseline}),{baseline:remote,writes:[remote]});
  assert.deepEqual(observeWorkspaceBrief(source,{task:baseline,baseline:remote,draft:remote}),{baseline:remote,writes:[]});
  assert.match(source,/<DiscardChangesDialog open=\{discardDialogOpen\} busy=\{taskWriteBusy\}/);
});

for(const operation of operations) test(`${operation.name} late A result after B cannot publish task IDs, notify or refresh as B`,async()=>{
  let resolve;
  const h=setup({request:()=>new Promise(done=>{resolve=done;})});
  const pending=operation.call(h);
  const rejected=assert.rejects(pending,error=>error.code==='session_binding_obsolete');
  assert.equal(h.requests.length,1); h.changeSession();
  resolve(operation.name==='confirm' ? {task:updated,editing_task:{id:11,revision:1}} : updated);
  await rejected;
  assert.deepEqual(h.tasks,[latest]); assert.deepEqual(h.tasksRef.current,[latest]);
  assert.deepEqual(h.refreshes,[]); assert.deepEqual(h.notices,[]);
  assert.deepEqual(h.stale,[]);
});

test('typed session failure does not enter ordinary production conflict refresh or notification path',async()=>{
  const error=Object.assign(new Error('Synthetic session failure'),{name:'BrowserSessionError',code:'browser_response_unverified',status:409});
  const h=setup({request:async()=>{throw error;}});
  await assert.rejects(h.confirmProduction(task),caught=>caught===error);
  assert.deepEqual(h.refreshes,[]); assert.deepEqual(h.notices,[]); assert.deepEqual(h.tasks,[latest]);
  assert.deepEqual(h.stale,[]);
});

for(const operation of operations) test(`${operation.name} marks confirmed stale only after ACK; denied writes never invalidate as success`,async()=>{
  let resolve;
  const h=setup({request:()=>new Promise(done=>{resolve=done;})});
  const pending=operation.call(h);
  assert.equal(h.requests.length,1); assert.deepEqual(h.stale,[]);
  resolve(operation.name==='confirm'?{task:updated}:updated);
  await pending;
  assert.deepEqual(h.stale.map(call=>call.uncertain),[false]);
  for(const status of [400,401,403,500]) {
    const error=Object.assign(new Error('Synthetic rejected write'),{status});
    const denied=setup({request:async()=>{throw error;}});
    await assert.rejects(operation.call(denied),caught=>caught===error);
    assert.deepEqual(denied.stale.map(call=>call.uncertain),status===500?[true]:[]);
    assert.deepEqual(denied.tasks,[latest]); assert.deepEqual(denied.refreshes,[]);
  }
});

test('actual production mutation and conflict read use captured guard, not raw API helpers',()=>{
  assert.match(handlers,/await guard\.request\(`\/api\/tareas\/\$\{task.id\}\?workspace=render_os`\)/);
  assert.match(handlers,/await guard\.request\(`\/api\/tareas\/\$\{task.id\}\/produccion\/registros\?workspace=render_os`/);
  assert.match(handlers,/!guard\.current\(\) \|\| isSessionFailure\(reason\)/);
  assert.doesNotMatch(handlers,/await apiRequest\(|await apiTaskById\(/);
});
