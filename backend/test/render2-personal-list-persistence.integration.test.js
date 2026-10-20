import test from 'node:test';
import assert from 'node:assert/strict';
import {access}from 'node:fs/promises';
import {startLocalHarness,request,fixturePassword}from '../scripts/render2-local-test.js';

test('personal list HTTP persistence: private CAS, competing editors and reorder versions',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
  const fixture=await startLocalHarness({port:55672});
  t.after(async()=>{await fixture.cleanup();await assert.rejects(access(fixture.root),e=>e.code==='ENOENT');t.diagnostic(`Own personal-list fixture stopped and removed: ${fixture.root}`);});
  const api=(path,token,method='GET',body)=>request(fixture.base,`/api${path}`,{token,method,body});
  const ok=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.body));return result.body;};
  const login=async usuario=>ok(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const editor=await login('qa_luciano'),second=await login('qa_luciano'),foreign=await login('qa_designer');
  const page=ok(await api('/listas-personales',editor,'POST',{titulo:'QA private page',emoji:'📝',bloques:[{tipo:'texto',contenido:{texto:'Original'}},{tipo:'checklist',contenido:{titulo:'QA checklist',items:[]}}]}),201);
  const read=async token=>ok(await api('/listas-personales',token));
  const own=async()=> (await read(editor)).find(row=>row.id===page.id);
  const listPatch=(body,token=editor)=>api(`/listas-personales/${page.id}`,token,'PATCH',body);
  const blockPatch=(id,body,token=editor)=>api(`/listas-personales/bloques/${id}`,token,'PATCH',body);
  const snapshot=async()=>({pages:await fixture.query('SELECT * FROM listas_personales ORDER BY id'),blocks:await fixture.query('SELECT * FROM lista_bloques ORDER BY id')});
  const text=page.bloques.find(row=>row.tipo==='texto');
  await t.test('private rows are absent to other users; expected_version is mandatory and strictly typed',async()=>{
    assert.equal((await read(foreign)).some(row=>row.id===page.id),false);
    const before=await snapshot();
    for(const expected_version of [undefined,null,'1',0,-1,1.5,2147483648]){
      ok(await listPatch({titulo:'Must not save',expected_version}),400);
      ok(await blockPatch(text.id,{tipo:'texto',contenido:{texto:'Must not save'},expected_version}),400);
    }
    ok(await listPatch({titulo:'Foreign',expected_version:page.version},foreign),404);
    ok(await blockPatch(text.id,{tipo:'texto',contenido:{texto:'Foreign'},expected_version:text.version},foreign),404);
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('metadata changes retain ID and increment once; another session cannot overwrite an observed stale version',async()=>{
    const first=ok(await listPatch({titulo:'QA renamed page',expected_version:page.version}));
    assert.equal(first.id,page.id);assert.equal(first.version,page.version+1);
    const before=await snapshot();ok(await listPatch({emoji:'🚀',expected_version:page.version},second),409);assert.deepEqual(await snapshot(),before);
    const updated=ok(await listPatch({emoji:'✅',expected_version:first.version},second));
    const reread=await own();assert.equal(reread.titulo,'QA renamed page');assert.equal(reread.emoji,'✅');assert.equal(reread.version,updated.version);
  });
  await t.test('competing block writes serialize with one success/one conflict, preserving the winning exact content',async()=>{
    const revision=text.version;
    const [a,b]=await Promise.all(['First browser','Second browser'].map((value,index)=>blockPatch(text.id,{tipo:'texto',contenido:{texto:value},expected_version:revision},index?second:editor)));
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    const winner=a.status===200?a.body:b.body;
    let row=(await own()).bloques.find(block=>block.id===text.id);assert.equal(row.version,revision+1);assert.deepEqual(row.contenido,winner.contenido);
    const before=await snapshot();ok(await blockPatch(text.id,{tipo:'texto',contenido:winner.contenido,expected_version:revision}),409);assert.deepEqual(await snapshot(),before,'CAS retry is not an idempotency receipt or permission to overwrite');
    const next=ok(await blockPatch(text.id,{tipo:'texto',contenido:{texto:'Latest explicit edit'},expected_version:row.version},second));
    row=(await own()).bloques.find(block=>block.id===text.id);assert.deepEqual(row.contenido,next.contenido);assert.equal(row.version,next.version);
  });
  await t.test('BIGSERIAL string identities remain exact through nesting, CAS and reorder',async()=>{
    await fixture.query("SELECT setval(pg_get_serial_sequence('listas_personales','id'),9007199254740991)");
    await fixture.query("SELECT setval(pg_get_serial_sequence('lista_bloques','id'),9007199254740991)");
    const create=title=>api('/listas-personales',editor,'POST',{titulo:title,bloques:[{tipo:'texto',contenido:{texto:title}}]});
    const a=ok(await create('Big A'),201),b=ok(await create('Big B'),201);
    assert.equal(a.id,'9007199254740992');assert.equal(b.id,'9007199254740993');
    const rows=await read(editor);
    for(const page of [a,b])assert.deepEqual(rows.find(row=>row.id===page.id).bloques.map(row=>row.id),page.bloques.map(row=>row.id));
    const block=b.bloques[0];
    ok(await blockPatch(block.id,{tipo:'texto',contenido:{texto:'Big B saved'},expected_version:block.version}));
    const order=ok(await api('/listas-personales/orden/reordenar',editor,'PATCH',{tipo:'listas',ids:[b.id,a.id]}));
    assert.deepEqual(order.ids,[b.id,a.id]);
    const reloaded=await read(await login('qa_luciano'));
    assert.equal(reloaded.find(row=>row.id===b.id).bloques[0].contenido.texto,'Big B saved');
    assert.equal(reloaded.find(row=>row.id===a.id).bloques[0].contenido.texto,'Big A');
  });
  await t.test('reorder exposes fresh versions; stale autosave conflicts rather than undoing order or content',async()=>{
    const before=await own(),ids=before.bloques.map(row=>row.id).reverse();
    ok(await api('/listas-personales/orden/reordenar',editor,'PATCH',{tipo:'bloques',parent_id:page.id,ids}));
    const fresh=await own();assert.deepEqual(fresh.bloques.map(row=>row.id),ids);
    for(const block of fresh.bloques)assert.equal(block.version,before.bloques.find(row=>row.id===block.id).version+1);
    const old=before.bloques.find(row=>row.id===text.id),snapshotBefore=await snapshot();
    ok(await blockPatch(text.id,{tipo:'texto',contenido:{texto:'Stale after reorder'},expected_version:old.version}),409);assert.deepEqual(await snapshot(),snapshotBefore);
    const current=fresh.bloques.find(row=>row.id===text.id);ok(await blockPatch(text.id,{tipo:'texto',contenido:{texto:'Saved after fresh reorder read'},expected_version:current.version}));
    const reloaded=(await read(await login('qa_luciano'))).find(row=>row.id===page.id);
    assert.equal(reloaded.bloques.find(row=>row.id===text.id).contenido.texto,'Saved after fresh reorder read');
    assert.deepEqual(reloaded.bloques.map(row=>row.id),ids);
  });
});
