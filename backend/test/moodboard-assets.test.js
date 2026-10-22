import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMoodboardsRouter} from '../src/moodboards.js';

function fixture(query){
  const mkdir=mock.method(fs,'mkdirSync',()=>{});
  let router;
  try{router=createMoodboardsRouter({pool:{query}});}finally{mkdir.mock.restore();}
  const handler=router.stack.find(layer=>layer.route?.path==='/assets/:filename').route.stack[0].handle;
  return async(filename,auth={id:7,session_version:2,rol:'custom'})=>{
    const res={code:200,headers:{},set(k,v){this.headers[k]=v;return this;},sendStatus(n){this.code=n;return this;},sendFile(p){this.file=p;return this;}};
    await handler({params:{filename},auth},res,error=>{throw error;});return res;
  };
}

test('asset visibility requires a current DB account AND a surviving reference; orphan bytes are never inspected',async()=>{
  const calls=[],read=fixture(async(sql,values)=>{calls.push({sql,values});return{rows:[{allowed:false}]};});
  const exists=mock.method(fs,'existsSync',()=>{throw Error('orphan filesystem must not be consulted');});
  try{
    const res=await read('abc-123.png');assert.equal(res.code,404);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.file,undefined);
    assert.deepEqual(calls[0].values,[7,2,'custom','abc-123.png']);
    assert.match(calls[0].sql,/u\.activo IS TRUE/);assert.match(calls[0].sql,/u\.session_version=\$2 AND u\.rol=\$3/);
    assert.match(calls[0].sql,/moodboard_references r WHERE r\.archivo_nombre=\$4/);
  }finally{exists.mock.restore();}
});

test('shared existing asset keeps its configured local path without using client paths',async()=>{
  const exists=mock.method(fs,'existsSync',()=>true);
  try{
    const res=await fixture(async()=>({rows:[{allowed:true}]}))('abc-123.jpg');
    assert.equal(res.code,200);assert.match(res.file,/\/abc-123\.jpg$/);
  }finally{exists.mock.restore();}
});

test('invalid filenames or identities do not query; unavailable and failed observations never serve bytes',async()=>{
  let calls=0;const read=fixture(async()=>{calls++;return{rows:[]};});
  for(const value of ['../abc.png','abc.svg','abc.png?x','abc.png\n'])assert.equal((await read(value)).code,404);
  for(const auth of [{},{id:'7',session_version:2,rol:'admin'},{id:7,session_version:0,rol:'admin'}])assert.equal((await read('abc.png',auth)).code,401);
  assert.equal(calls,0);assert.equal((await read('abc.png')).code,404);
  const failure=Error('private SQL failure');await assert.rejects(fixture(async()=>{throw failure;})('abc.png'),error=>error===failure);
});
