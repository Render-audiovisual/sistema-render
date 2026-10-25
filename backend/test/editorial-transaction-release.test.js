import test from 'node:test';
import assert from 'node:assert/strict';
import {readEditorialControl,readEditorialPieceDetail} from '../src/editorial-control.js';
import {createEditorialPublicationRouter} from '../src/editorial-publication.js';

const auth={id:91001,rol:'admin',activo:true,session_version:1};
const key='11111111-1111-4111-8111-111111111111';
function failingPool(rollbackFails,expectedStatus){
  const primary=Object.assign(new Error('Original editorial fault'),expectedStatus?{status:expectedStatus}:{});
  const rollback=new Error('Rollback transport fault'),calls=[],released=[];
  const db={async query(sql){calls.push(sql);if(sql.startsWith('BEGIN'))return{rows:[]};
    if(sql==='ROLLBACK'){if(rollbackFails)throw rollback;return{rows:[]};}throw primary;},
    release(reason){released.push(reason);}};
  return{pool:{connect:async()=>db},primary,rollback,calls,released};
}
for(const [name,read] of [
  ['control',pool=>readEditorialControl(pool,auth)],
  ['piece detail',pool=>readEditorialPieceDetail(pool,auth,'historia','8')],
])for(const rollbackFails of [false,true])test(`${name}: preserve primary error and ${rollbackFails?'discard failed rollback':'reuse clean rollback'}`,async()=>{
  const m=failingPool(rollbackFails);
  await assert.rejects(read(m.pool),error=>error===m.primary);
  assert.equal(m.calls.length,3);assert.equal(m.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(m.calls.at(-1),'ROLLBACK');assert.deepEqual(m.released,[rollbackFails?m.rollback:undefined]);
});

for(const action of [null,'confirmar','retirar'])for(const rollbackFails of [false,true])
test(`publication ${action??'GET'}: preserve response and ${rollbackFails?'discard failed rollback':'reuse clean rollback'}`,async()=>{
  const m=failingPool(rollbackFails,action?409:undefined),routes=new Map();
  const router={use(){},get(path,handler){routes.set(`GET ${path}`,handler);},post(path,handler){routes.set(`POST ${path}`,handler);}};
  createEditorialPublicationRouter({express:{Router:()=>router},pool:m.pool});
  let status,payload,forwarded;
  const res={status(value){status=value;return this;},json(value){payload=value;}};
  const body={request_id:key,expected_revision:0,...(action==='confirmar'?{occurred_at:'2026-01-01T12:00:00Z'}:{})};
  await routes.get(action?`POST /:dominio/:id/${action}`:'GET /:dominio/:id')(
    {params:{dominio:'historia',id:'8'},query:{},auth,body},res,error=>{forwarded=error;});
  assert.equal(m.calls.length,3);assert.equal(m.calls[0],action?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(m.calls.at(-1),'ROLLBACK');assert.deepEqual(m.released,[rollbackFails?m.rollback:undefined]);
  if(action){assert.equal(status,409);assert.deepEqual(payload,{error:m.primary.message});assert.equal(forwarded,undefined);}
  else{assert.equal(forwarded,m.primary);assert.equal(payload,undefined);}
});
