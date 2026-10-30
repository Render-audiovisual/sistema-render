import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalHarness,request,fixturePassword} from '../scripts/render2-local-test.js';
test('client logos persist across owners and staff reads; employee, stale and invalid writes are rejected',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
 const f=await startLocalHarness({port:55723});t.after(()=>f.cleanup());
 const api=(path,token,method='GET',body)=>request(f.base,`/api${path}`,{token,method,body});
 const login=async usuario=>(await api('/login',null,'POST',{usuario,password:fixturePassword})).body.token;
 const owner=await login('qa_franco'),other=await login('qa_agustin'),staff=await login('qa_luciano');
 const created=await api('/clientes',owner,'POST',{creation_mode:'basic',nombre:'Logo fixture'});
 assert.equal(created.status,201,JSON.stringify(created.body));
 const id=created.body.id;
 const read=async token=>(await api('/clientes',token)).body.find(row=>row.id===id);
 const before=await read(owner),logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 const patch=(token,value,revision)=>api(`/clientes/${id}`,token,'PATCH',{logo:value,expected_revision:revision});
 assert.equal((await patch(staff,logo,before.agreement_revision)).status,403);
 assert.equal((await patch(owner,'https://example.com/a.svg',before.agreement_revision)).status,400);
 const saved=await patch(owner,logo,before.agreement_revision);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.logo,logo);
 assert.notEqual(saved.body.agreement_revision,before.agreement_revision);
 assert.equal((await read(other)).logo,logo);assert.equal((await read(staff)).logo,logo);
 assert.equal((await patch(other,null,before.agreement_revision)).status,409);
 assert.equal((await read(other)).logo,logo);
 assert.equal((await patch(other,null,saved.body.agreement_revision)).status,200);
 assert.equal((await read(owner)).logo,null);
 const [events]=await f.query("SELECT count(*)::int AS n FROM integracion_auditoria WHERE integracion='client_branding'");assert.equal(events.n,2);
});
