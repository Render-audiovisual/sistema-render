import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskCommentCreation} from './taskCommentCreation.js';
import {mergeTaskComments} from './taskCommentCollection.js';
const key='11111111-2222-4333-8444-555555555555';
const row=()=>({id:1,tarea_id:9,autor:'Display alias',contenido:'A',created_at:'2026-10-25T12:00:00.000Z',actor_usuario_id:7});
test('creation retains only the validated actor ID and rejects wrong/missing actor for the captured author',async()=>{
  for(const value of [7,8,null,undefined,'7',0]) {
    const response={...row(),creation_request_id:key,actor_usuario_id:value,private_finance:'CANARY'};
    const model=createTaskCommentCreation({randomUUID:()=>key,capture:()=>({current:()=>true,request:async()=>response})});
    assert.equal(await model.start({taskId:9,actorId:7,autor:'Display alias',contenido:'A',generation:0,validateAuthor:true}),value===7);
    if(value===7){assert.equal(model.snapshot.comment.actor_usuario_id,7);assert.ok(!Object.hasOwn(model.snapshot.comment,'private_finance'));}
    else {assert.equal(model.snapshot.phase,'uncertain');assert.equal(model.snapshot.locked,true);}
  }
});
test('uncertain creation verifies the original actor without a second POST',async()=>{
  const calls=[];
  const model=createTaskCommentCreation({randomUUID:()=>key,capture:()=>({current:()=>true,request:async(url,options)=>{
    calls.push([url,options.method]);if(options.method==='POST')throw Error('ACK lost');return {...row(),creation_request_id:key};
  }})});
  assert.equal(await model.start({taskId:9,actorId:7,autor:'Display alias',contenido:'A',generation:0}),false);
  assert.equal(await model.verify(),true);assert.equal(model.snapshot.comment.actor_usuario_id,7);
  assert.deepEqual(calls.map(([,method])=>method),['POST','GET']);
});
test('historical null/missing authors remain unknown but conflicting actor observations reject the whole merge',()=>{
  assert.equal(mergeTaskComments([{...row(),actor_usuario_id:null}],[],9)[0].actor_usuario_id,null);
  const {actor_usuario_id,...historical}=row();assert.deepEqual(mergeTaskComments([historical],[],9),[historical]);
  for(const value of [8,null,undefined])assert.throws(()=>mergeTaskComments([row()],[{...row(),actor_usuario_id:value}],9),/verificar/);
  for(const value of [0,-1,'7',true,1.5,2147483648])assert.throws(()=>mergeTaskComments([{...row(),actor_usuario_id:value}],[],9),/verificar/);
});
test('a captured invalid actor never dispatches a creation request',async()=>{
  for(const actorId of [null,'7',0,2147483648]){
    const model=createTaskCommentCreation({randomUUID:()=>key,capture:()=>({current:()=>true,request:()=>assert.fail('No dispatch')})});
    assert.equal(await model.start({taskId:9,actorId,autor:'Display alias',contenido:'A',generation:0}),false);
    assert.equal(model.snapshot.locked,false);
  }
});
