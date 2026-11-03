import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProductionCatalog} from '../src/production-catalog.js';
const auth={id:17,rol:'admin',session_version:3};
test('production references use one current-actor-bound query and explicit minimal fields',async()=>{
 const calls=[];const result=await loadProductionCatalog({query:async(sql,values)=>{calls.push({sql,values});return{rows:[{...auth,activo:true,usuarios:[{id:17,nombre:'QA',rol:'admin',activo:true}],clientes:[{id:2,nombre:'QA client',activo:true}]}]};}},auth);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].values.slice(0,3),[17,'admin',3]);
 assert.match(calls[0].sql,/a.activo IS TRUE AND a.rol=\$2 AND a.session_version=\$3/);
 assert.match(calls[0].sql,/FROM usuarios u WHERE u.activo IS TRUE/);
 assert.doesNotMatch(calls[0].sql,/email|password|abono|sueldo|salario|foto|logo|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
 assert.deepEqual(Object.keys(result),['usuarios','clientes']);
});
test('revoked, replaced, inactive or unknown actors cannot receive catalogs',async()=>{
 for(const row of [null,{...auth,activo:false},{...auth,activo:true,session_version:4},{...auth,activo:true,rol:'diseno'}])
  await assert.rejects(loadProductionCatalog({query:async()=>({rows:row?[row]:[]})},auth),{status:401});
 const other={...auth,rol:'unknown'};
 await assert.rejects(loadProductionCatalog({query:async()=>({rows:[{...other,activo:true}]})},other),{status:403});
});
test('real local HTTP production catalog excludes private fields and is read-only',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
 const {startLocalHarness,request,fixturePassword}=await import('../scripts/render2-local-test.js');
 const f=await startLocalHarness({port:55841});t.after(()=>f.cleanup());
 for(const usuario of ['qa_franco','qa_luciano']){
  const login=await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}});assert.equal(login.status,200);
  const data=await request(f.base,'/api/producciones/catalogos',{token:login.body.token});assert.equal(data.status,200);
  assert.deepEqual(Object.keys(data.body).sort(),['clientes','usuarios']);
  for(const user of data.body.usuarios){assert.deepEqual(Object.keys(user).sort(),['activo','id','nombre','rol']);assert.equal(user.activo,true);}
  for(const client of data.body.clientes)assert.deepEqual(Object.keys(client).sort(),['activo','id','nombre']);
 }
 assert.equal((await request(f.base,'/api/producciones/catalogos')).status,401);
});
