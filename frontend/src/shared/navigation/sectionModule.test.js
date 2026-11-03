import test from 'node:test';
import assert from 'node:assert/strict';
import {createSectionModule} from './sectionModule.js';

test('concurrent imports share one promise; pending and healthy retry never invalidate it',async()=>{
  let calls=0,resolve;
  const Component=()=>null;
  const section=createSectionModule(()=>{calls++;return new Promise(done=>{resolve=done;});},'Page');
  const first=section.load();section.retry();assert.equal(section.load(),first);
  await Promise.resolve();assert.equal(calls,1);
  resolve({Page:Component});assert.deepEqual(await first,{default:Component});
  section.retry();assert.equal(section.load(),first);assert.equal(calls,1);
});

test('rejection remains cached until explicit retry; one new attempt is shared',async()=>{
  let calls=0;const failure=new TypeError('Failed to fetch dynamically imported module');
  const Component=()=>null;
  const section=createSectionModule(()=>{if(++calls===1)throw failure;return {Page:Component};},'Page');
  const first=section.load();await assert.rejects(first,error=>error===failure);
  assert.equal(section.load(),first);assert.equal(calls,1);
  section.retry();section.retry();const next=section.load();
  assert.notEqual(next,first);assert.equal(section.load(),next);
  assert.deepEqual(await next,{default:Component});assert.equal(calls,2);
});

test('repeated import failures never auto-retry or hide the original error',async()=>{
  let calls=0;const failure=new Error('Unable to preload CSS for /assets/page.css');
  const section=createSectionModule(()=>{calls++;return Promise.reject(failure);},'Page');
  for(let attempt=1;attempt<=2;attempt++){
    await assert.rejects(section.load(),error=>error===failure);
    assert.equal(calls,attempt);
    section.retry();
  }
});

test('missing exports and invalid contract fail closed',async()=>{
  assert.throws(()=>createSectionModule(null,'Page'),TypeError);
  assert.throws(()=>createSectionModule(()=>({}),''),TypeError);
  const section=createSectionModule(()=>({Other:()=>null}),'Page');
  await assert.rejects(section.load(),/Section export is unavailable/);
});
