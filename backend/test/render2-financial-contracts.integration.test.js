import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('financial contract identity, atomic CAS, permissions and durable history use actual principal PostgreSQL',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
  const f=await startLocalHarness({port:55699});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');});
  const api=(path,token,method='GET',body)=>request(f.base,`/api${path}`,{token,method,body});
  const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
  const login=async usuario=>ok(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const owner=await login('qa_franco'),other=await login('qa_agustin'),employee=await login('qa_luciano');
  const input={nombre:'QA83 private synthetic contract',importe_mensual:'1000.25',inicia_el:'2026-09-01',finaliza_el:null};
  const created=ok(await api('/contratos',owner,'POST',input),201);
  assert.equal(created.contract_revision,`fc1:${created.id}:1`);
  const read=async(id=created.id,token=owner)=>ok(await api('/contratos',token)).find(row=>row.id===id);
  const snapshot=()=>f.query('SELECT * FROM contratos_financieros ORDER BY id');
  await t.test('second owner sees exact decimal, ID and observed version; employees see no financial DTO',async()=>{
    assert.deepEqual(await read(created.id,other),created);
    const before=await snapshot();
    for(const [path,method,body] of [['/contratos','GET',undefined],['/contratos','POST',input],
      [`/contratos/${created.id}`,'PATCH',{importe_mensual:5000,expected_revision:created.contract_revision}],
      [`/contratos/${created.id}`,'DELETE',{expected_revision:created.contract_revision}],['/sueldos?periodo=2026-10','GET',undefined]]){
      const denied=await api(path,employee,method,body);assert.equal(denied.status,403);assert.ok(!JSON.stringify(denied.body).includes(input.nombre));
    }
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('missing, malformed and cross-resource versions cannot mutate contracts; invalid calendar/amounts reject',async()=>{
    const before=await snapshot();
    for(const method of ['PATCH','DELETE']){
      const body=method==='PATCH'?{nombre:'Must not change'}:{};
      assert.equal((await api(`/contratos/${created.id}`,owner,method,body)).status,428);
      for(const expected_revision of [null,1,{},'fc1:0:1','fc1:1:0',`${created.contract_revision}\n`])assert.equal((await api(`/contratos/${created.id}`,owner,method,{...body,expected_revision})).status,400);
      assert.equal((await api(`/contratos/${created.id}`,owner,method,{...body,expected_revision:'fc1:2147483000:1'})).status,409);
    }
    for(const fields of [{importe_mensual:'1.234'},{importe_mensual:true},{inicia_el:'2026-02-31'},{nombre:{}},{activo:'false'},{cliente_id:1}]){
      assert.equal((await api(`/contratos/${created.id}`,owner,'PATCH',{...fields,expected_revision:created.contract_revision})).status,400);
    }
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('two independent editors sharing a version have one winner and one conflict',async()=>{
    const current=await read();
    const results=await Promise.all([owner,other].map((token,index)=>api(`/contratos/${created.id}`,token,'PATCH',{importe_mensual:2000+index,expected_revision:current.contract_revision})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const winner=results.find(r=>r.status===200).body,loser=results.find(r=>r.status===409);
    assert.equal(loser.body.code,'CONTRACT_REVISION_CONFLICT');assert.deepEqual(await read(),winner);
    const before=await snapshot();assert.equal((await api(`/contratos/${created.id}`,owner,'PATCH',{nombre:'Obsolete',expected_revision:current.contract_revision})).status,409);assert.deepEqual(await snapshot(),before);
  });
  await t.test('explicit current edits update financial summary without external provider access; no name-based client linkage',async()=>{
    const [client]=await f.query('INSERT INTO clientes(nombre) VALUES($1) RETURNING *',[input.nombre]);
    const baseline=ok(await api('/sueldos?periodo=2026-10',owner));assert.equal(baseline.exchangeRate.fallback,true);
    const current=await read();const amount=Number(current.importe_mensual)+500;
    const saved=ok(await api(`/contratos/${created.id}`,other,'PATCH',{importe_mensual:String(amount),expected_revision:current.contract_revision}));
    const next=ok(await api('/sueldos?periodo=2026-10',other));assert.equal(next.finance.facturacion-baseline.finance.facturacion,500);
    assert.equal(Number((await read()).importe_mensual),amount);assert.notEqual(saved.contract_revision,current.contract_revision);
    assert.deepEqual((await f.query('SELECT * FROM clientes WHERE id=$1',[client.id]))[0],client);
    assert.equal((await f.query('SELECT id FROM cliente_abonos WHERE cliente_id=$1',[client.id])).length,0);
  });
  await t.test('SQL ABA and no-op updates advance version, so an old observation never revives',async()=>{
    const current=await read();
    await f.query("UPDATE contratos_financieros SET nombre='QA83 transient' WHERE id=$1",[created.id]);
    await f.query('UPDATE contratos_financieros SET nombre=$2 WHERE id=$1',[created.id,current.nombre]);
    await f.query('UPDATE contratos_financieros SET nombre=nombre WHERE id=$1',[created.id]);
    const after=await read();assert.equal(after.nombre,current.nombre);assert.notEqual(after.contract_revision,current.contract_revision);
    assert.equal((await api(`/contratos/${created.id}`,owner,'PATCH',{activo:false,expected_revision:current.contract_revision})).status,409);
  });
  await t.test('soft deletion and reactivation preserve the same row and retain previous billing history',async()=>{
    const current=await read(),beforeCount=(await snapshot()).length;
    const before=ok(await api('/sueldos?periodo=2026-10',owner));
    const inactive=ok(await api(`/contratos/${created.id}`,owner,'DELETE',{expected_revision:current.contract_revision}));
    assert.equal(inactive.activo,false);assert.ok(inactive.finaliza_el);assert.equal((await snapshot()).length,beforeCount);
    const historical=ok(await api('/sueldos?periodo=2026-10',other));assert.equal(historical.finance.facturacion,before.finance.facturacion);
    assert.equal((await api(`/contratos/${created.id}`,other,'PATCH',{activo:true,expected_revision:current.contract_revision})).status,409);
    const active=ok(await api(`/contratos/${created.id}`,other,'PATCH',{activo:true,expected_revision:inactive.contract_revision}));
    assert.equal(active.activo,true);assert.equal(active.finaliza_el,null);assert.equal(active.id,created.id);
    assert.equal((await api('/contratos/2147483000',owner,'PATCH',{nombre:'Absent',expected_revision:'fc1:2147483000:1'})).status,404);
  });
});
