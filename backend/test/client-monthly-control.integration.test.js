import test from 'node:test';
import assert from 'node:assert/strict';
import {startOwnerProfilesFixture,ownerProfileHttp,ownerSessionFromResponse,loginOwnerFixture} from './helpers/owner-profiles-local-fixture.js';

test('monthly controls: real cookie roles, persistence, CAS, shared quotas, reset and unrelated-data preservation',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
 const f=await startOwnerProfilesFixture({pgPort:55630});t.after(()=>f.cleanup());
 const root=await loginOwnerFixture(f.base),employee=await loginOwnerFixture(f.base,'qa_luciano'),otherAdmin=await loginOwnerFixture(f.base,'qa_agustin');
 const http=(route,options)=>ownerProfileHttp(f.base,route,options);
 const checked=(response,status=200)=>{assert.equal(response.status,status,JSON.stringify(response.body));return response.body;};
 const [client]=await f.query("INSERT INTO clientes(nombre,activo,fecha_inicio,cuota_reels,cuota_carruseles) VALUES('QA monthly controls',true,'2026-10-01',8,2) RETURNING id");
 await f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,dias_reels,dias_carruseles,disenador_responsable,abono_mensual)
 VALUES($1,'2026-10-01',8,2,ARRAY[1]::smallint[],ARRAY[2]::smallint[],ARRAY[3]::smallint[],'QA',123456.78)`,[client.id]);
 const key=`cliente-${client.id}`,base=`/api/clientes/${key}`,period='2026-11';
 const read=async(session=root)=>checked(await http(`${base}/control-mensual?periodo=${period}`,{session}));
 const before={};for(const table of ['tareas','tarea_asignaciones','publicaciones','cliente_abonos','instagram_media'])before[table]=await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${table} t`);
 await t.test('only mapped owners may read/edit; CSRF and payload validation remain active',async()=>{
  for(const session of [employee,otherAdmin]){
   checked(await http(`${base}/control-mensual?periodo=${period}`,{session}),403);
   checked(await http(`${base}/contenido-realizado`,{session,method:'PUT',body:{period,mode:'manual',reels:3,carruseles:1,expected_revision:'cm1:'+'a'.repeat(64)}}),403);
   checked(await http(`/api/clientes/${client.id}`,{session,method:'PATCH',body:{cuota_reels:99}}),403);
   checked(await http(`/api/clientes/${client.id}/configuraciones`,{session,method:'POST',body:{}}),403);
   checked(await http(`/api/clientes/${client.id}/acuerdo-mensual/iniciar`,{session,method:'POST',body:{}}),403);
  }
  const snapshot=await read();
  checked(await http(`${base}/contenido-realizado`,{session:root,method:'PUT',headers:{'x-render-csrf':''},body:{period,mode:'manual',reels:3,carruseles:1,expected_revision:snapshot.revision}}),403);
  for(const reels of [-1,1.5,'3',true,10001])checked(await http(`${base}/contenido-realizado`,{session:root,method:'PUT',body:{period,mode:'manual',reels,carruseles:1,expected_revision:snapshot.revision}}),400);
 });
 let manual;
 await t.test('manual zero persists across reload and is projected to catalog without inventing posts',async()=>{
  const snapshot=await read();manual=checked(await http(`${base}/contenido-realizado`,{session:root,method:'PUT',body:{period,mode:'manual',reels:3,carruseles:0,expected_revision:snapshot.revision}}));
  assert.deepEqual(manual.actual,{reels:3,carruseles:0});assert.equal(manual.mode,'manual');assert.notEqual(manual.revision,snapshot.revision);
  assert.deepEqual((await read()).actual,manual.actual);
  const catalog=checked(await http(`/api/clientes?periodo=${period}`,{session:employee}));const row=catalog.find(c=>c.id===client.id);
  assert.equal(row.instagram_monthly_adjustment.reels,3);assert.equal(row.instagram_monthly_adjustment.carruseles,0);assert.equal(row.abono_mensual,undefined);
  const report=checked(await http(`/api/instagram/clientes/${key}/reporte?periodo=${period}`,{session:employee}));
  assert.equal(report.format_counts.source,'owner_correction');assert.equal(report.format_counts.reels,3);assert.equal(report.format_counts.carruseles,0);assert.equal(report.piezas.length,0);
 });
 await t.test('unconfigured and shared clients can change quotas without creating financial agreements',async()=>{
  const [group]=await f.query("INSERT INTO grupos_feed(nombre,cuota_mensual,cuota_reels,cuota_carruseles) VALUES('QA monthly shared',10,8,2) RETURNING id");
  const members=await f.query("INSERT INTO clientes(nombre,activo,grupo_feed_id) VALUES('QA shared A',true,$1),('QA shared B',true,$1) RETURNING id",[group.id]);
  const groupBase=`/api/clientes/grupo-${group.id}`;
  const snapshot=checked(await http(`${groupBase}/control-mensual?periodo=${period}`,{session:root}));
  const updated=checked(await http(`${groupBase}/cuota-mensual`,{session:root,method:'PUT',body:{period,reels:5,carruseles:0,expected_revision:snapshot.revision}}));
  assert.deepEqual(updated.quota,{reels:5,carruseles:0});assert.deepEqual(updated.memberIds,members.map(c=>c.id));
  const actual=checked(await http(`${groupBase}/contenido-realizado`,{session:root,method:'PUT',body:{period,mode:'manual',reels:4,carruseles:0,expected_revision:updated.revision}}));
  assert.deepEqual(actual.actual,{reels:4,carruseles:0});
  const report=checked(await http(`/api/instagram/clientes/grupo-${group.id}/reporte?periodo=${period}`,{session:employee}));assert.equal(report.format_counts.reels,4);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM cliente_configuraciones WHERE cliente_id=ANY($1::int[])',[members.map(c=>c.id)]))[0].n,0);
 });
 await t.test('concurrent changes reject stale state rather than overwrite it',async()=>{
  const results=await Promise.all([4,5].map(reels=>http(`${base}/contenido-realizado`,{session:root,method:'PUT',body:{period,mode:'manual',reels,carruseles:1,expected_revision:manual.revision}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 });
 await t.test('quota changes preserve fee, days and independent owner profiles can edit',async()=>{
  const switched=ownerSessionFromResponse(await http('/api/sesion/perfil-dueno',{session:root,method:'POST',body:{profile:'franco'}}));
  const snapshot=await read(switched);const saved=checked(await http(`${base}/cuota-mensual`,{session:switched,method:'PUT',body:{period,reels:9,carruseles:4,expected_revision:snapshot.revision}}));
  assert.deepEqual(saved.quota,{reels:9,carruseles:4});
  const [config]=await f.query("SELECT abono_mensual,dias_reels,cuota_reels FROM cliente_configuraciones WHERE cliente_id=$1 AND vigente_desde='2026-11-01'",[client.id]);
  assert.equal(config.abono_mensual,'123456.78');assert.deepEqual(config.dias_reels,[2]);assert.equal(config.cuota_reels,9);
  const agustin=ownerSessionFromResponse(await http('/api/sesion/perfil-dueno',{session:switched,method:'POST',body:{profile:'agustin'}}));
  const current=await read(agustin);const reset=checked(await http(`${base}/contenido-realizado`,{session:agustin,method:'PUT',body:{period,mode:'automatic',expected_revision:current.revision}}));
  assert.equal(reset.mode,'automatic');assert.deepEqual(reset.actual,reset.automatic);
  assert.equal((await read(agustin)).mode,'automatic');
 });
 for(const table of Object.keys(before))assert.deepEqual(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${table} t`),before[table],`${table} untouched`);
});
