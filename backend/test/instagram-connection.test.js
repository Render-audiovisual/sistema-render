import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMetaConnection,EXPECTED_META_SCOPES} from '../src/instagram-connection.js';
import {readInstagramConnectionState} from '../src/instagram-panel.js';
const token='FAKE_TEST_ONLY_CONNECTION_TOKEN_0123456789';
const env={META_SYSTEM_USER_TOKEN:token,META_BUSINESS_ID:'1234'};
const json=(value,status=200)=>({ok:status<400,status,json:async()=>value});
function graph({info={is_valid:true,expires_at:0,scopes:[...EXPECTED_META_SCOPES]},pages,ads,error}={}){
 const calls=[];
 const fetchImpl=async(raw,options)=>{
  const url=new URL(raw);calls.push({path:url.pathname,options});
  assert.equal(url.hostname,'graph.facebook.com');assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.equal(options.redirect,'error');assert.ok(options.signal);
  if(error)throw new Error(`${token}: private diagnostic`);
  if(url.pathname.endsWith('/debug_token')){assert.equal(url.searchParams.get('input_token'),token);return json({data:info,access_token:token});}
  if(url.pathname.endsWith('/me/accounts'))return pages?pages(url):json({data:[{id:'100',name:'Cliente QA',tasks:['MESSAGING','MODERATE','ANALYZE'],instagram_business_account:{id:'900'}}]});
  if(url.pathname.endsWith('/me/adaccounts'))return ads?ads(url):json({data:[{id:'act_200',name:'Anuncios QA',account_status:1,access_token:token}]});
  if(url.pathname.endsWith('/owned_pages'))return json({data:[{id:'101',name:'Owned QA',tasks:['MESSAGING'],instagram_business_account:{id:'901'}}]});
  if(url.pathname.endsWith('/client_pages'))return json({data:[{id:'101',name:'Owned QA',tasks:['MODERATE']},{id:'102',name:'Shared QA',tasks:[]}]});
  throw new Error('Unexpected Graph path');
 };return{fetchImpl,calls};
}
test('valid token returns expected scopes, expiration, page tasks and advertising status',async()=>{
 const mock=graph();const result=await inspectMetaConnection(env,mock);
 assert.equal(result.valido,true);assert.equal(result.sin_vencimiento,true);assert.equal(result.vence_at,null);
 assert.deepEqual(result.scopes_faltantes,[]);assert.equal(result.scopes.length,14);
 assert.deepEqual(result.paginas,[{id:'100',nombre:'Cliente QA',tiene_instagram:true,tasks_informadas:true,tasks:['ANALYZE','MESSAGING','MODERATE']}]);
 assert.deepEqual(result.cuentas_publicitarias,[{id:'act_200',nombre:'Anuncios QA',account_status:1}]);
 assert.equal(result.paginas_estado,'ok');assert.equal(mock.calls.length,3);
});
test('missing scopes are exact and independent from page tasks; finite expiration is ISO',async()=>{
 const result=await inspectMetaConnection(env,graph({info:{is_valid:true,expires_at:1900000000,scopes:['instagram_basic','ads_read','email','email']}}));
 assert.equal(result.vence_at,new Date(1900000000000).toISOString());assert.equal(result.sin_vencimiento,false);
 assert.deepEqual(result.scopes,['ads_read','email','instagram_basic']);
 assert.deepEqual(result.scopes_faltantes,EXPECTED_META_SCOPES.filter(s=>!['ads_read','instagram_basic'].includes(s)));
 assert.equal(result.paginas.length,1);
});
test('invalid token stops without requesting account inventories',async()=>{
 const mock=graph({info:{is_valid:false}});const result=await inspectMetaConnection(env,mock);
 assert.equal(result.valido,false);assert.deepEqual(result.scopes_faltantes,[...EXPECTED_META_SCOPES]);
 assert.equal(mock.calls.length,1);assert.deepEqual(result.paginas,[]);assert.equal(result.paginas_estado,'no_consultado');
});
test('debug_token authentication rejection is reported as invalid without echoing Graph errors',async()=>{
 let calls=0;
 const result=await inspectMetaConnection(env,{fetchImpl:async()=>{calls++;return json({error:{code:190,message:`Bearer ${token}`}},401);}});
 assert.equal(calls,1);assert.equal(result.valido,false);assert.deepEqual(result.errores,['token_invalido']);
 assert.equal(JSON.stringify(result).includes(token),false);
});
test('closed response and errors never expose token, token fragments, raw URLs or Graph messages',async()=>{
 for(const mock of [graph(),graph({error:true}),graph({info:{is_valid:true,scopes:[token,token.slice(0,12),'email'],secret:token},
  pages:()=>json({data:[{id:'100',name:`name ${token}`,tasks:['MESSAGING'],instagram_business_account:{id:'900'},token}]}),
  ads:()=>json({data:[{id:'act_200',name:token.slice(-12),account_status:1,token}]})})]){
  const result=await inspectMetaConnection(env,mock),serialized=JSON.stringify(result);
  for(const secret of [token,token.slice(0,12),token.slice(-12),'Bearer ','input_token','private diagnostic'])assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('graph.facebook.com'),false);
 }
});
test('portfolio fallback reads BOTH edges and merges duplicate page task assignments',async()=>{
 const mock=graph({pages:()=>json({data:[]})}),result=await inspectMetaConnection(env,mock);
 assert.equal(result.paginas.length,2);assert.deepEqual(result.paginas[0].tasks,['MESSAGING','MODERATE']);
 assert.equal(result.paginas[1].tiene_instagram,false);
 assert.ok(mock.calls.some(c=>c.path.endsWith('/owned_pages')));assert.ok(mock.calls.some(c=>c.path.endsWith('/client_pages')));
});
test('network failure is unknown, not invalid; missing configuration never fetches; partial inventories are marked',async()=>{
 const result=await inspectMetaConnection(env,graph({error:true}));assert.equal(result.valido,null);
 assert.deepEqual(result.errores,['validacion_no_disponible']);
 const absent=await inspectMetaConnection({}, {fetchImpl:()=>{throw new Error('must not fetch');}});assert.equal(absent.configurado,false);
 const partial=await inspectMetaConnection(env,graph({ads:()=>json({error:{code:10,message:token}},403)}));
 assert.equal(partial.valido,true);assert.equal(partial.paginas_estado,'ok');assert.equal(partial.cuentas_publicitarias_estado,'error');
 assert.deepEqual(partial.cuentas_publicitarias,[]);assert.equal(JSON.stringify(partial).includes(token),false);
});
test('unsupported task field retains the page inventory without claiming verified task permissions',async()=>{
 const mock=graph({pages:url=>url.searchParams.get('fields').includes('tasks')?json({error:{code:100}},400):json({data:[{id:'100',name:'Sin tasks',instagram_business_account:{id:'900'}}]})});
 const result=await inspectMetaConnection(env,mock);
 assert.equal(result.paginas_estado,'ok');assert.equal(result.paginas.length,1);assert.equal(result.paginas[0].tasks_informadas,false);
 assert.deepEqual(result.paginas[0].tasks,[]);
});
test('diagnostic Graph reads are behind withLeaderRead: no fetch for employees, revoked or anonymous sessions',async()=>{
 for(const actor of [{id:7,rol:'diseno',activo:true,session_version:1},{id:7,rol:'admin',activo:false,session_version:1}]){
  let reads=0;const sql=[];const pool={connect:async()=>({query:async q=>{sql.push(q);return{rows:q.startsWith('SELECT id,rol')?[actor]:[]};},release(){}})};
  await assert.rejects(readInstagramConnectionState(pool,{id:7,rol:'admin',session_version:1},{env,fetchImpl:()=>{reads++;}}),{status:actor.activo?403:401});
  assert.equal(reads,0);assert.ok(sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));assert.ok(sql.includes('ROLLBACK'));
 }
 await assert.rejects(readInstagramConnectionState({},null),{status:401});
});
test('authorized leader receives the diagnostic and commits a read-only snapshot',async()=>{
 const actor={id:7,rol:'admin',activo:true,session_version:1},sql=[],mock=graph();
 const pool={connect:async()=>({query:async q=>{sql.push(q);return{rows:q.startsWith('SELECT id,rol')?[actor]:[]};},release(){}})};
 const result=await readInstagramConnectionState(pool,actor,{env,...mock});assert.equal(result.valido,true);
 assert.ok(sql.includes('COMMIT'));assert.equal(sql.some(q=>/^(INSERT|UPDATE|DELETE)/.test(q)),false);
});
