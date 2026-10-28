import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPreparationRevision, goalPreparationRevision, lockGoalPreparer, parseGoalPreparation } from '../src/goal-preparation.js';
import { GOAL_QUOTA_SOURCE } from '../src/goal-quota-review.js';

const client = {clave:'grupo-4',reels:2,carruseles:1,cuentas:[{id:1},{id:2}]};
Object.defineProperty(client,GOAL_QUOTA_SOURCE,{value:[[1,1,4,1,0,0,2,1],[2,1,4,1,0,0,2,1]]});
const formats = {video:[{id:7,nombre:'Original'},{id:8}],carrusel:[{id:8}]};
const accounts = {1:[{id:8}],2:[{id:9}]};
const objective = {id:11,reels:2,carruseles:1,cuentas:client.cuentas};
const pieces = [{id:20,tipo:'video',numero:1,tarea_id:30,estado:'pendiente',quota_piece_version:'1',tarea_revision:1}];
const token = (...args) => goalPreparationRevision(...args);
const observed = () => token(client,objective,pieces,'2026-10',formats,accounts);
const request = () => ({periodo:'2026-10',clave:'grupo-4',responsables:[7,8,9],responsables_por_formato:{video:[7,8],carrusel:[8,9]},responsables_por_cuenta:{1:[8],2:[9]},expected_preparation_revision:observed()});

test('preparation fingerprint is canonical by IDs, not names, order or duplicate display entries',()=>{
  assert.match(observed(),/^[a-f0-9]{64}$/);
  assert.equal(observed(),token(client,objective,pieces,'2026-10',{video:[{id:8},{id:7,nombre:'Renamed'},{id:7}],carrusel:[{id:8}]},{2:[{id:9}],1:[{id:8}]}));
  assert.equal(token(null,objective,pieces,'2026-10',formats,accounts),null);
});
test('quota, source version ABA, membership, piece/task revision, period and assignment changes invalidate observation',()=>{
  const changes = [
    [{...client,reels:3},objective,pieces,'2026-10',formats,accounts],
    [{...client,cuentas:[{id:1}]},objective,pieces,'2026-10',formats,accounts],
    [client,{...objective,id:12},pieces,'2026-10',formats,accounts],
    [client,objective,[{...pieces[0],tarea_revision:2}],'2026-10',formats,accounts],
    [client,objective,[{...pieces[0],quota_piece_version:'2'}],'2026-10',formats,accounts],
    [client,objective,[{...pieces[0],preparation_membership:[[7,'responsable']]}],'2026-10',formats,accounts],
    [client,objective,pieces,'2026-11',formats,accounts],
    [client,objective,pieces,'2026-10',{...formats,video:[{id:9}]},accounts],
    [client,objective,pieces,'2026-10',formats,{...accounts,2:[{id:7}]}],
    [client,undefined,[],'2026-10',formats,accounts],
  ];
  for (const input of changes) assert.notEqual(token(...input),observed());
  const changed={...client}; Object.defineProperty(changed,GOAL_QUOTA_SOURCE,{value:[[1,3,4,1,0,0,2,1],[2,1,4,1,0,0,2,1]]});
  assert.notEqual(token(changed,objective,pieces,'2026-10',formats,accounts),observed());
});
test('HTTP preparation accepts only an explicit closed observation contract',()=>{
  assert.deepEqual(parseGoalPreparation(request()),{period:'2026-10',key:'grupo-4',responsibleIds:[7,8,9],responsibleByType:{video:[7,8],carrusel:[8,9]},responsibleByAccount:{1:[8],2:[9]}});
  for (const body of [null,[],{...request(),actor:'admin'},{...request(),preparation:{}},{...request(),clave:'grupo-4\n'},{...request(),clave:'cliente-2147483648'}]) assert.throws(()=>parseGoalPreparation(body),{status:400});
  const missing=request();delete missing.expected_preparation_revision;assert.throws(()=>parseGoalPreparation(missing),{status:428});
  for (const value of [null,'','A'.repeat(64),'a'.repeat(64)+'\n',[],7]) assert.throws(()=>assertPreparationRevision(value),{status:400});
});
test('current actor ID, epoch and exact role are verified under a held user row, never by names',async()=>{
  for (const role of ['admin','community']) {
    const calls=[],auth={id:7,rol:role,session_version:2,nombre:'Forged'};
    const db={query:async(sql,values)=>{calls.push([sql,values]);return {rows:[{id:7,rol:role,session_version:2,activo:true,nombre:'Current'}]};}};
    assert.equal((await lockGoalPreparer(db,auth)).nombre,'Current');assert.match(calls[0][0],/FOR SHARE/);assert.deepEqual(calls[0][1],[7]);
  }
  const auth={id:7,rol:'admin',session_version:2};
  for (const patch of [null,{activo:false},{session_version:3},{rol:'community'},{id:8}]) {
    const db={query:async()=>({rows:patch===null?[]:[{...auth,activo:true,...patch}]})};
    await assert.rejects(lockGoalPreparer(db,auth),{status:401});
  }
  await assert.rejects(lockGoalPreparer({query:async()=>({rows:[{id:7,rol:'edicion',session_version:2,activo:true}]})},{...auth,rol:'edicion'}),{status:403});
  await assert.rejects(lockGoalPreparer({query:()=>assert.fail('No query with missing authority')},{nombre:'Franco'}),{status:401});
});
test('transaction structure guards BEFORE assignment writes and uses one client-before-user lock order',()=>{
  const src=readFileSync(new URL('../src/client-goals.js',import.meta.url),'utf8');
  const prepare=src.slice(src.indexOf('export async function prepareGoal('),src.indexOf('export async function inheritedGoalResponsibles'));
  assert.ok(prepare.indexOf('await lockClientAdministration(db)')<prepare.indexOf('await lockGoalPreparer(db'));
  assert.ok(prepare.indexOf('await lockClientAdministration(db)')<prepare.indexOf('await lockGoalQuotaReviewer(db'));
  assert.ok(prepare.indexOf('preparation?.expected ?? automaticObservation')<prepare.indexOf('DELETE FROM cliente_objetivo_responsables'));
  assert.ok(prepare.indexOf('ORDER BY id FOR SHARE')<prepare.indexOf("hashtext('vinculo-objetivo-mensual')"));
  assert.match(prepare,/ORDER BY id FOR UPDATE/);
  const route=src.slice(src.indexOf("router.post('/preparar'"),src.indexOf("router.post('/reconciliar'"));
  assert.match(route,/parseGoalPreparation\(req.body\)/);assert.match(route,/auth:req.auth/);
  assert.doesNotMatch(route,/auth:\{id:req.auth.id/,'Do not discard opaque delegation in the route');
  assert.ok(prepare.indexOf('bindCapturedOwnerProfileAuthority(preparation?.auth')<prepare.indexOf('await pool.connect()'));
  assert.ok(prepare.indexOf('bindCapturedOwnerProfileAuthority(quotaReview?.auth')<prepare.indexOf('await pool.connect()'));
  assert.doesNotMatch(route,/actor: req.auth.nombre/);
});
