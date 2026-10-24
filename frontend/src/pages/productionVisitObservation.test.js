import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionVisitObserver,newestProductionVisit, reconcileProductionVisitList} from './productionVisitObservation.js';

const visit = (id, revision, overrides = {}) => ({id,revision,cliente_id:7,fecha:'2026-10-24',titulo:`Visit ${id}/${revision}`,videos:[],...overrides});
const context = {month:'2026-10',clientId:'7'};

test('opaque token changes on admitted content, not identical clones or rejected older snapshots',()=>{
  const observer=createProductionVisitObserver(()=>1),empty=observer.token,current=visit('a',3);
  observer.observe(current);const admitted=observer.token;assert.notEqual(admitted,empty);
  observer.observe(structuredClone(current));assert.equal(observer.token,admitted);
  observer.observe(visit('a',2));assert.equal(observer.token,admitted);
  observer.observe(visit('a',3,{tarea_estado:'finalizada'}));assert.notEqual(observer.token,admitted);
});

test('reading the token invalidates a previous context even before another visit is observed',()=>{
  let epoch=1;
  const observer=createProductionVisitObserver(()=>epoch),first=observer.token;
  epoch++;assert.notEqual(observer.token,first);
  const next=observer.token;assert.equal(observer.token,next);
  assert.equal(typeof next,'symbol');
});

test('context-bound observer retains the newest verified aggregate even before React publishes state',()=>{
  let epoch=1;
  const observer=createProductionVisitObserver(()=>epoch),fresh=visit('a',3),old=visit('a',2);
  assert.equal(observer.observe(fresh),fresh);
  assert.equal(observer.observe(old),fresh);
  assert.equal(observer.observe(visit('b',1)).revision,1);
  epoch=2;
  assert.equal(observer.observe(old),old,'A different client/month/navigation observation has no inherited floor');
  const equal=visit('a',2,{tarea_estado:'finalizada'});
  assert.equal(observer.observe(equal),equal,'Equal revision permits fresh derived state');
});

test('separate observers isolate page/session lifetimes and never donate another client aggregate',()=>{
  const a=createProductionVisitObserver(()=>1),b=createProductionVisitObserver(()=>1),fresh=visit('a',9),old=visit('a',1);
  a.observe(fresh);assert.equal(b.observe(old),old);
  const other=visit('a',1,{cliente_id:8});assert.equal(a.observe(other),other);
});

test('newest whole aggregate wins without merging fields or mutating either input',()=>{
  const old=visit('a',2,{videos:[{id:'old'}]}),fresh=visit('a',3,{videos:[{id:'new'}]}),before=structuredClone([old,fresh]);
  assert.equal(newestProductionVisit(fresh,old),fresh);
  assert.equal(newestProductionVisit(old,fresh),fresh);
  assert.deepEqual([old,fresh],before);
});

test('equal revision may refresh derived editing state; another ID/client cannot donate data',()=>{
  const previous=visit('a',3),equal=visit('a',3,{tarea_estado:'finalizada'});
  assert.equal(newestProductionVisit(previous,equal),equal);
  for(const candidate of [visit('b',2),visit('a',2,{cliente_id:8}),visit('a',undefined),visit('a','2')])
    assert.equal(newestProductionVisit(previous,candidate),candidate);
});

test('collection retains newer rows but incoming snapshot owns membership and order',()=>{
  const a=visit('a',3),b=visit('b',2),gone=visit('gone',9);
  const incoming=[visit('b',3),visit('a',2),visit('new',1)],before=structuredClone([[a,b,gone],incoming]);
  const result=reconcileProductionVisitList([a,b,gone],incoming,context);
  assert.deepEqual(result.map(v=>[v.id,v.revision]),[['b',3],['a',3],['new',1]]);
  assert.equal(result[1],a);assert.equal(result[0],incoming[0]);
  assert.deepEqual([[a,b,gone],incoming],before);
  assert.deepEqual(reconcileProductionVisitList([a,b,gone],[],context),[]);
});

test('newer rescheduled row is omitted from old month, never replaced by its older date',()=>{
  const moved=visit('a',4,{fecha:'2026-11-01'}),old=visit('a',3);
  assert.deepEqual(reconcileProductionVisitList([moved],[old],context),[]);
  assert.deepEqual(reconcileProductionVisitList([old],[moved],{...context,month:'2026-11'}),[moved]);
});

test('filter never retains another client; unfiltered context still honors month',()=>{
  const a=visit('a',1),b=visit('b',1,{cliente_id:8}),outside=visit('c',1,{fecha:'2026-09-30'});
  assert.deepEqual(reconcileProductionVisitList([], [b,a,outside],context),[a]);
  assert.deepEqual(reconcileProductionVisitList([], [b,a,outside],{...context,clientId:''}),[b,a]);
  assert.deepEqual(reconcileProductionVisitList([visit('a',3,{cliente_id:8})],[visit('a',2)],context),[]);
});
