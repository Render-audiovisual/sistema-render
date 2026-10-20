import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('canonical client administration persists privately and deletes only empty locked clients', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
  const f=await startLocalHarness({port:55695});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');});
  // These legacy administration scenarios issue deliberate fresh commands.
  // The separate agreement suite holds observations to test actual stale edits;
  // this adapter is fixture preparation, never a production retry/rebase policy.
  const api=async(path,token,method='GET',body)=>{
    const match=/^\/clientes\/([1-9]\d*)(?:\/|$)/.exec(path);
    if(match&&method!=='GET'){
      const read=await request(f.base,'/api/clientes',{token});
      const observed=Array.isArray(read.body)&&read.body.find(row=>String(row.id)===match[1]);
      body={...body,expected_revision:observed?.agreement_revision||`a1:${match[1]}:1:0:0`};
    }
    return request(f.base,`/api${path}`,{token,method,body});
  };
  const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
  const login=async usuario=>ok(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const owner=await login('qa_franco'),other=await login('qa_agustin'),employee=await login('qa_luciano');
  const [clock]=await f.query("SELECT to_char(current_date,'YYYY-MM') AS period");
  const body={nombre:'QA81 admin client',rubro:'Servicios',vigente_desde:clock.period,cuota_reels:2,cuota_carruseles:1,
    dias_historias:[1,3],dias_reels:[2],dias_carruseles:[4],disenador_responsable:'Augusto',abono_mensual:817293.46};
  const created=ok(await api('/clientes',owner,'POST',body),201);
  const read=async(token,period=clock.period)=>ok(await api(`/clientes?periodo=${period}`,token));
  const snapshot=async()=>({clients:await f.query('SELECT * FROM clientes ORDER BY id'),configs:await f.query('SELECT * FROM cliente_configuraciones ORDER BY id'),fees:await f.query('SELECT * FROM cliente_abonos ORDER BY id')});
  await t.test('another owner sees durable configuration; employee cannot obtain financial fields',async()=>{
    const row=(await read(other)).find(c=>c.id===created.id);
    assert.equal(Number(row.abono_mensual),817293.46);assert.equal(row.cuota_reels,2);
    const publicRow=(await read(employee)).find(c=>c.id===created.id);
    assert.equal(publicRow.abono_mensual,undefined);assert.equal(publicRow.abono_vigente_desde,undefined);
    assert.ok(!JSON.stringify(publicRow).includes('817293.46'));
    const before=await snapshot();
    for(const [path,method,input] of [['/clientes','POST',{...body,nombre:'Forbidden'}],
      [`/clientes/${created.id}/configuraciones`,'POST',body],[`/clientes/${created.id}`,'PATCH',{activo:false}],
      [`/clientes/${created.id}/abono-proximo-mes`,'POST',{importe:123}], [`/clientes/${created.id}`,'DELETE',undefined]]){
      assert.equal((await api(path,employee,method,input)).status,403);
    }
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('configuration ACK is a delta; activation and next-month fee persist as separate operations',async()=>{
    const delta=ok(await api(`/clientes/${created.id}/configuraciones`,other,'POST',{...body,nombre:'QA81 renamed',cuota_reels:3,abono_mensual:912345.67}));
    assert.equal(delta.id,created.id);assert.equal(delta.configuracion_completa,true);assert.equal(delta.activo,undefined);
    const changed=ok(await api(`/clientes/${created.id}`,other,'PATCH',{activo:false}));assert.equal(changed.activo,false);
    const fee=ok(await api(`/clientes/${created.id}/abono-proximo-mes`,owner,'POST',{importe:765432.10}));
    assert.equal(fee.cliente_id,created.id);assert.notEqual(fee.vigente_desde.slice(0,7),clock.period);
    const current=(await read(owner)).find(c=>c.id===created.id),next=(await read(other,fee.vigente_desde.slice(0,7))).find(c=>c.id===created.id);
    assert.equal(current.nombre,'QA81 renamed');assert.equal(current.activo,false);assert.equal(current.cuota_reels,3);
    assert.equal(Number(current.abono_mensual),912345.67);assert.equal(Number(next.abono_mensual),765432.10);
  });
  await t.test('later step failure does not roll back an already committed configuration',async()=>{
    ok(await api(`/clientes/${created.id}/configuraciones`,owner,'POST',{...body,cuota_reels:4}));
    assert.equal((await api(`/clientes/${created.id}`,employee,'PATCH',{activo:true})).status,403);
    const row=(await read(other)).find(c=>c.id===created.id);assert.equal(row.cuota_reels,4);assert.equal(row.activo,false);
  });
  await t.test('an explicitly selected historical agreement ACK and read stay in that month, not the current cohort',async()=>{
    const before=(await read(owner)).find(c=>c.id===created.id);
    const delta=ok(await api(`/clientes/${created.id}/configuraciones`,other,'POST',{...body,vigente_desde:'2020-02',cuota_reels:7,abono_mensual:15001}));
    assert.equal(delta.configuracion_vigente_desde,'2020-02-01');assert.equal(delta.abono_vigente_desde,'2020-02-01');
    const historic=(await read(owner,'2020-02')).find(c=>c.id===created.id),current=(await read(other)).find(c=>c.id===created.id);
    assert.equal(historic.cuota_reels,7);assert.equal(Number(historic.abono_mensual),15001);
    assert.equal(current.cuota_reels,before.cuota_reels);assert.equal(current.abono_mensual,before.abono_mensual);
  });
  await t.test('configuration-only and fee-only history is preserved instead of cascading away',async()=>{
    const before=await snapshot();const rejected=await api(`/clientes/${created.id}`,owner,'DELETE');
    assert.equal(rejected.status,409);assert.equal(rejected.body.code,'CLIENT_HAS_HISTORY');assert.deepEqual(await snapshot(),before);
    const [feeOnly]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 fee only') RETURNING id");
    await f.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe) VALUES($1,date_trunc('month',current_date)::date,123)",[feeOnly.id]);
    const feeBefore=await snapshot();assert.equal((await api(`/clientes/${feeOnly.id}`,owner,'DELETE')).status,409);assert.deepEqual(await snapshot(),feeBefore);
  });
  await f.query('CREATE TABLE qa81_client_history(id serial PRIMARY KEY,cliente_id int REFERENCES clientes(id) ON DELETE CASCADE)');
  await t.test('newly added FK relationships are protected; truly empty clients remain removable',async()=>{
    const [linked]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 dynamic reference') RETURNING id");
    await f.query('INSERT INTO qa81_client_history(cliente_id) VALUES($1)',[linked.id]);
    assert.equal((await api(`/clientes/${linked.id}`,owner,'DELETE')).status,409);
    assert.equal((await f.query('SELECT * FROM qa81_client_history WHERE cliente_id=$1',[linked.id])).length,1);
    const [empty]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 empty disposable') RETURNING id");
    const result=ok(await api(`/clientes/${empty.id}`,owner,'DELETE'));assert.equal(result.ok,true);assert.equal(result.cliente.id,empty.id);
    assert.equal((await api(`/clientes/${empty.id}`,owner,'DELETE')).status,404);
    for(const id of ['1e0','-1','2147483648'])assert.equal((await api(`/clientes/${id}`,owner,'DELETE')).status,400);
  });
  const sleeping=async pattern=>{
    for(let attempt=0;attempt<100;attempt++){
      const [row]=await f.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND query LIKE $1) AS running",[pattern]);
      if(row.running)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('Expected live fixture PostgreSQL operation was not observed');
  };
  await t.test('parent lock waits for an earlier child insertion then rejects deletion without losing the child',async()=>{
    const [client]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 earlier writer') RETURNING id");
    const writer=f.query(`DO $qa81_writer$ BEGIN INSERT INTO qa81_client_history(cliente_id) VALUES(${client.id}); PERFORM pg_sleep(0.5); END $qa81_writer$`);
    await sleeping('%DO $qa81_writer$%');
    const rejected=await api(`/clientes/${client.id}`,owner,'DELETE');await writer;
    assert.equal(rejected.status,409);assert.equal((await f.query('SELECT id FROM clientes WHERE id=$1',[client.id])).length,1);
    assert.equal((await f.query('SELECT id FROM qa81_client_history WHERE cliente_id=$1',[client.id])).length,1);
  });
  await t.test('a child insertion after the locked inspection cannot race into a cascade deletion',async()=>{
    const [client]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 later writer') RETURNING id");
    await f.query(`CREATE FUNCTION qa81_delay_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN OLD; END $$`);
    await f.query(`CREATE TRIGGER qa81_delay_delete BEFORE DELETE ON clientes FOR EACH ROW WHEN(OLD.id=${client.id}) EXECUTE FUNCTION qa81_delay_delete()`);
    const deletion=api(`/clientes/${client.id}`,owner,'DELETE');await sleeping('%DELETE FROM public.clientes WHERE id=$1 RETURNING id,nombre%');
    const writer=f.query('INSERT INTO qa81_client_history(cliente_id) VALUES($1)',[client.id]).then(()=>({ok:true}),error=>({ok:false,error}));
    ok(await deletion);assert.equal((await writer).ok,false);
    assert.equal((await f.query('SELECT id FROM qa81_client_history WHERE cliente_id=$1',[client.id])).length,0);
  });
  await t.test('unknown composite and cross-schema relationships fail closed without erasing history',async()=>{
    const [client]=await f.query("INSERT INTO clientes(nombre) VALUES('QA81 unusual references') RETURNING id,nombre");
    await f.query('ALTER TABLE clientes ADD CONSTRAINT qa81_client_tuple UNIQUE(id,nombre)');
    await f.query('CREATE TABLE qa81_composite(cliente_id int,cliente_nombre text,FOREIGN KEY(cliente_id,cliente_nombre) REFERENCES clientes(id,nombre) ON DELETE CASCADE)');
    await f.query('INSERT INTO qa81_composite VALUES($1,$2)',[client.id,client.nombre]);
    const composite=await api(`/clientes/${client.id}`,owner,'DELETE');
    assert.equal(composite.status,409);assert.equal(composite.body.code,'CLIENT_REQUIRES_REVIEW');
    assert.equal((await f.query('SELECT * FROM qa81_composite')).length,1);
    await f.query('DROP TABLE qa81_composite');await f.query('ALTER TABLE clientes DROP CONSTRAINT qa81_client_tuple');
    await f.query('CREATE SCHEMA qa81_extra');
    await f.query('CREATE TABLE qa81_extra.notes(cliente_id int REFERENCES public.clientes(id) ON DELETE CASCADE)');
    await f.query('INSERT INTO qa81_extra.notes VALUES($1)',[client.id]);
    const outside=await api(`/clientes/${client.id}`,owner,'DELETE');
    assert.equal(outside.status,409);assert.equal(outside.body.code,'CLIENT_REQUIRES_REVIEW');
    assert.equal((await f.query('SELECT * FROM qa81_extra.notes')).length,1);
    assert.equal((await f.query('SELECT id FROM clientes WHERE id=$1',[client.id])).length,1);
  });
});
