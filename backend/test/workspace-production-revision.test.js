import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeRelatedTasks } from "../../frontend/src/features/render-os/utils/task-state.js";

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
  const notices = [], requests = [], refreshes = [];
  const context = {tasksRef,setTasks:fn=>{tasks=fn(tasks);},mergeRelatedTasks,
    apiRequest:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return request(url,options);},
    apiTaskById:async(id)=>{refreshes.push(id);return refresh(id);},notify:(...args)=>notices.push(args)};
  const result = new Function(...Object.keys(context),`${handlers}\nreturn {registerProduction,correctProduction,confirmProduction};`)(...Object.values(context));
  return {...result,tasksRef,notices,requests,refreshes,get tasks(){return tasks;}};
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
    assert.match(h.notices[0][0],/no se pudo recargar/);
  });

  test(`${operation.name} rejects invalid snapshot revisions locally`,async()=>{
    for (const revision of [undefined,null,"5",0,-1,1.5,NaN,Infinity]) {
      const h = setup({snapshot:{...latest,revision}});
      await assert.rejects(operation.call(h,{...task,revision}),/revisión actual/);
      assert.equal(h.requests.length,0);
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
  });
}

test("detail add conflict retains amount/date, clears busy state, and does not leak rejection",async()=>{
  const body=section("  const registerProduction = async (finish", "  const confirmProduction = async ()");
  let amount=4;
  const busy=[];
  const context={canRegisterProduction:true,registeringProduction:false,metadata:{},task,productionAmount:amount,
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
  assert.match(source,/editing \|\| \(previous && \(current.titulo !== previous.titulo/);
  assert.match(source,/<DiscardChangesDialog open=\{discardDialogOpen\} busy=\{taskWriteBusy\}/);
});
