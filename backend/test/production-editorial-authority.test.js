import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerProductionEditorialRoutes} from '../src/production-editorial.js';

const params={id:'11111111-1111-4111-8111-111111111111',videoId:'22222222-2222-4222-8222-222222222222'};
function body(empty){return {expected_revision:3,tarea_id:7,expected_tarea_revision:9,...(empty?{objetivo_pieza_id:11,expected_objetivo_updated_at:'2026-10-01T00:00:00Z',fecha_programada:'2026-10-20'}:{publicacion_id:13,expected_publicacion_updated_at:'2026-10-01T00:00:00Z'})}}
function fixture(transaction){
 const routes=new Map(),pool={};
 registerProductionEditorialRoutes({get(){},post(path,handler){routes.set(path,handler)}},{pool,handle:handler=>handler,transaction});
 const response={statusCode:200,status(value){this.statusCode=value;return this},json(value){this.value=value;return this}};
 return {pool,response,route:empty=>routes.get(`/:id/videos/:videoId/${empty?'vincular-objetivo':'vincular-pieza'}`)};
}
for(const empty of [false,true]){
 test(`editorial ${empty?'objective':'piece'} POST forwards exact auth and admin requirement to authority transaction`,async()=>{
  let args;const result={created:empty,visita:{id:params.id}},f=fixture(async(...received)=>{args=received;return result});
  const auth={id:17,rol:'admin',session_version:4};
  await f.route(empty)({auth,params,body:body(empty)},f.response);
  assert.equal(args.length,4);assert.equal(args[0],f.pool);assert.equal(args[1],auth);assert.equal(args[2],true);assert.equal(typeof args[3],'function');
  assert.equal(f.response.statusCode,empty?201:200);assert.equal(f.response.value,result);
 });
 test(`editorial ${empty?'objective':'piece'} authority rejection cannot acknowledge mutation`,async()=>{
  const denied=Object.assign(new Error('Revoked'),{status:401});let calls=0;
  const f=fixture(async()=>{calls++;throw denied});
  await assert.rejects(f.route(empty)({auth:{id:17,rol:'admin'},params,body:body(empty)},f.response),error=>error===denied);
  assert.equal(calls,1);assert.equal(f.response.value,undefined);
 });
 test(`editorial ${empty?'objective':'piece'} preserves early role, ID and revision validation`,async()=>{
  let calls=0;const f=fixture(async()=>{calls++});
  for(const request of [{auth:{id:17,rol:'produccion'},params,body:body(empty)}, {auth:{id:17,rol:'admin'},params:{...params,id:'bad'},body:body(empty)}, {auth:{id:17,rol:'admin'},params,body:{...body(empty),expected_revision:0}}]){
   await assert.rejects(f.route(empty)(request,f.response),error=>[400,403].includes(error.status));
  }
  assert.equal(calls,0);
 });
}
test('authority wrapper retains original actor, IDs, body and empty-slot association callback',()=>{
 const source=readFileSync(new URL('../src/production-editorial.js',import.meta.url),'utf8');
 assert.match(source,/transaction\(pool,req.auth,true,db => associateProductionEditorial\(db,req.params.id,req.params.videoId,req.body,req.auth.id,deps,emptySlot\)\)/);
 assert.doesNotMatch(source,/transaction\(pool,db =>/);
});
