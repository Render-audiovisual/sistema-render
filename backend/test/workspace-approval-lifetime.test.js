import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { createCapturedRequest, isSessionFailure } from '../../frontend/src/shared/session/captured-request.js';
const source=readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  const updateTask ='),source.indexOf('  const createTask ='));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture({request,read,queue}={}) {
  const session={token:'qa-session-a',usuario:{id:7,rol:'admin',activo:true}};let current=session;
  const effects=[],stale=[];const tasksRef={current:[{id:1,revision:2,estado:'en_revision'}]};
  const deps={sesion:session,getSesion:()=>current,tasksRef,updateQueuesRef:{current:new Map(queue?[[1,queue]]:[])},
    setTasks:()=>effects.push('set'),apiRequest:request,apiTaskById:read,clients:[],canRetryTaskUpdate:()=>{throw new Error('Approval must not rebase');},
    logActivity:async()=>effects.push('log'),notify:()=>effects.push('notify'),isSessionFailure,
    markReviewQueueStale:(guard,uncertain=false)=>{guard.assertCurrent();stale.push(uncertain);},
    captureRequest:()=>createCapturedRequest({session,readSession:()=>current,
      request:(url,options)=>options?.method?request(url,options):read(url,options)})};
  const update=new Function('deps',`const {sesion,getSesion,tasksRef,updateQueuesRef,setTasks,apiRequest,apiTaskById,clients,canRetryTaskUpdate,logActivity,notify,captureRequest,isSessionFailure,markReviewQueueStale}=deps;${body};return updateTask;`)(deps);
  return{update,effects,tasksRef,stale,switchSession(){current={token:'qa-session-b'};tasksRef.current=[{id:1,revision:99,owner:'new session'}];}};
}
test('late409/500 after identity switch performs no conflict GET, rollback UI or notice',async()=>{
  for(const status of [409,500]) {
    const pending=deferred(),started=deferred();let reads=0;
    const f=fixture({request:()=>{started.resolve();return pending.promise;},read:()=>{reads++;throw new Error('No new-identity read');}});
    const result=f.update(1,{estado:'aprobada'},null,2);await started.promise;assert.deepEqual(f.effects,['set']);
    f.switchSession();pending.reject(Object.assign(new Error('old failure'),{status}));await assert.rejects(result);
    assert.equal(reads,0);assert.deepEqual(f.effects,['set']);assert.equal(f.tasksRef.current[0].revision,99);
    assert.deepEqual(f.stale,[]);
  }
});
test('session switch while conflict GET is pending suppresses both inner-catch and outer effects',async()=>{
  const pending=deferred(),started=deferred();
  const f=fixture({request:async()=>{throw Object.assign(new Error('conflict'),{status:409});},read:()=>{started.resolve();return pending.promise;}});
  const result=f.update(1,{estado:'aprobada'},null,2);await started.promise;f.switchSession();pending.resolve({id:1,revision:3});
  await assert.rejects(result);assert.deepEqual(f.effects,['set']);assert.equal(f.tasksRef.current[0].revision,99);
  assert.deepEqual(f.stale,[true], 'Conflict invalidates uncertainty before the switch, never confirmed success');
});
test('queued approval cannot dispatch with a different current session',async()=>{
  const pending=deferred();let calls=0;const f=fixture({queue:pending.promise,request:async()=>{calls++;}});
  const result=f.update(1,{estado:'aprobada'},null,2);f.switchSession();pending.resolve();
  await assert.rejects(result,/sesión cambió/);assert.equal(calls,0);assert.deepEqual(f.effects,[]);
  assert.deepEqual(f.stale,[]);
});
test('queued approval cannot silently replace the observed task revision',async()=>{
  const pending=deferred();let calls=0;const f=fixture({queue:pending.promise,request:async()=>{calls++;}});
  const result=f.update(1,{estado:'aprobada'},null,2);f.tasksRef.current=[{id:1,revision:3}];pending.resolve();
  await assert.rejects(result,{status:409});assert.equal(calls,0);assert.deepEqual(f.effects,[]);
  assert.deepEqual(f.stale,[]);
});

test('actual generic approval invalidates confirmed queue only after successful observed-revision PATCH',async()=>{
  const pending=deferred(),started=deferred();let sent;
  const f=fixture({request:(_url,options)=>{sent=JSON.parse(options.body);started.resolve();return pending.promise;}});
  const result=f.update(1,{estado:'aprobada'},null,2);
  await started.promise;
  assert.equal(sent.expected_revision,2);assert.deepEqual(f.stale,[]);
  pending.resolve({id:1,revision:3,estado:'aprobada'});
  await result;
  assert.deepEqual(f.stale,[false]); assert.equal(f.tasksRef.current[0].revision,3);
});
