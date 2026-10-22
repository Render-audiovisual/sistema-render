import test from 'node:test';
import assert from 'node:assert/strict';
import {moodboardReferenceAliasInput,moodboardReferenceAliasBody} from '../src/moodboard-reference-compat.js';

test('reference aliases preserve intent and omission without generating preconditions',()=>{
  assert.deepEqual(moodboardReferenceAliasInput('create',{params:{id:'7'},body:{title:'User',note:'Original',category_id:2}}),{action:'create',board_id:7,fields:{title:'User',note:'Original',category_id:2}});
  assert.deepEqual(moodboardReferenceAliasInput('edit',{params:{id:'9'},body:{request_id:'held',board_id:7,expected_revision:0,status:'aprobada'}}),{action:'edit',request_id:'held',expected_revision:0,reference_id:9,board_id:7,fields:{status:'aprobada'}});
  assert.deepEqual(moodboardReferenceAliasInput('delete',{params:{id:'9'}}),{action:'delete',reference_id:9});
});

test('reference aliases reject unknown business fields, target substitutions and query coercions',()=>{
  for(const action of ['create','edit','delete']){
    for(const body of [{actor_id:1},{reference_id:9},{action:'delete'},{revision:0},{feedback:{}},[]])assert.throws(()=>moodboardReferenceAliasInput(action,{params:{id:'9'},body}),e=>e.status===400);
    for(const query of [{force:'true'},[],{permanente:'true'}])assert.throws(()=>moodboardReferenceAliasInput(action,{params:{id:'9'},query}),e=>e.status===400);
    for(const value of ['0','01','2147483648','1e2','1\n',9])assert.throws(()=>moodboardReferenceAliasInput(action,{params:{id:value}}),e=>e.status===400);
  }
});

test('reference aliases expose current replay or tombstone without fabricating a surviving row',()=>{
  const operation={request_id:'held',action:'create',reference_id:9,result_revision:0,replayed:true};
  assert.deepEqual(moodboardReferenceAliasBody({body:{reference:null,operation}}),{id:9,unavailable:true,operation});
  const reference={id:9,revision:4};
  assert.deepEqual(moodboardReferenceAliasBody({body:{reference,operation}}),{...reference,operation});
  const deletion={...operation,action:'delete'};
  assert.deepEqual(moodboardReferenceAliasBody({body:{reference:null,operation:deletion}}),{ok:true,reference:null,operation:deletion});
});
