import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditingDeliveriesRouter} from '../src/editing-deliveries.js';
import {createEditingReviewsRouter} from '../src/editing-reviews.js';
const key='11111111-1111-4111-8111-111111111111';
for(const [name,create,path,body] of [
  ['delivery',createEditingDeliveriesRouter,'/:id/entregas',{request_id:key,expected_revision:1,url:'https://example.invalid/v1',notes:''}],
  ['review',createEditingReviewsRouter,'/:id/correcciones',{request_id:key,expected_revision:1,expected_entrega_id:key,notes:'Corregir cierre'}],
])for(const method of ['GET','POST'])for(const rollbackFails of [false,true])test(`${name} ${method}: ${rollbackFails?'failed rollback discards client':'successful rollback permits reuse'} and preserves primary failure`,async()=>{
  const routes=new Map(),calls=[],released=[];
  const primary=Object.assign(new Error('Primary domain failure'),method==='POST'?{status:409}:{}),rollback=new Error('Rollback connection failure');
  const db={async query(sql){calls.push(sql);if(sql.startsWith('BEGIN'))return{rows:[]};if(sql==='ROLLBACK'){if(rollbackFails)throw rollback;return{rows:[]};}throw primary;},release(reason){released.push(reason);}};
  const router={use(){},get(route,handler){routes.set(`GET ${route}`,handler);},post(route,handler){routes.set(`POST ${route}`,handler);}};
  create({express:{Router:()=>router},pool:{connect:async()=>db}});
  let forwarded,status,payload;const res={status(value){status=value;return this;},json(value){payload=value;}};
  // Reviews expose their GET at /revisiones, not the correction write path.
  const route=method==='GET'&&name==='review'?'/:id/revisiones':path;
  await routes.get(`${method} ${route}`)({params:{id:'8'},query:{},auth:{id:91001,rol:'admin',session_version:1,activo:true},body},res,error=>{forwarded=error;});
  assert.equal(calls.length,3);assert.match(calls[0],method==='POST'?/READ COMMITTED$/:/REPEATABLE READ READ ONLY$/);assert.equal(calls.at(-1),'ROLLBACK');
  assert.deepEqual(released,[rollbackFails?rollback:undefined]);
  if(method==='POST'){assert.equal(status,409);assert.deepEqual(payload,{error:primary.message});assert.equal(forwarded,undefined);}
  else{assert.equal(forwarded,primary);assert.equal(payload,undefined);}
});
