import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionResult, productionResultSummary, productionResultDto } from '../src/production-visit-results.js';
import { startLocalHarness } from '../scripts/render2-local-test.js';
const id='10000000-0000-4000-8000-000000000001';
const visit={id,cliente_id:1,tarea_origen_id:7,fecha:'2026-10-29',titulo:'Visita',participante_ids:[7,8],drive_url:'https://drive.google.com/qa',observaciones:'Foto de producto salió mal',saldo:999};
const video=estado=>({id:'v',video_origen_id:null,titulo:'Idea',guion:'Guion a conservar',estado,material_url:'https://drive.google.com/video',observaciones:'Repetir luz',salario:999});
test('deferred result migration is allowed only for a cluster-only upgrade rehearsal',async()=>{
  await assert.rejects(startLocalHarness({deferProductionResultsMigration:true}),/cluster-only/);
  await assert.rejects(startLocalHarness({clusterOnly:true,deferProductionResultsMigration:'true'}),/cluster-only/);
});
test('result intent is closed, normalized and immutable; caller cannot supply counts, actor, scripts or history',()=>{
  assert.deepEqual(validateProductionResult({request_id:id.toUpperCase(),expected_revision:3}),{request_id:id,expected_revision:3});
  assert.equal(Object.isFrozen(validateProductionResult({request_id:id,expected_revision:3})),true);
  for(const value of [null,[],{}, {request_id:id,expected_revision:'3'}, {request_id:id,expected_revision:0},
    {request_id:id,expected_revision:2147483647},{request_id:id,expected_revision:3,actor_id:99},
    {request_id:id,expected_revision:3,resumen:{videos_grabados:100}}])assert.throws(()=>validateProductionResult(value),{status:400});
});
test('partial summary preserves identified scripts, photo types and material, never counts pending as recorded',()=>{
  const input=[...Array(4).fill(null).map(()=>video('grabado')),video('pendiente'),video('repetir')];
  const before=JSON.stringify({visit,input});
  const summary=productionResultSummary(visit,input,[{id:'photo',tipo:'Productos',estado:'repetir',drive_url:'https://drive.google.com/fotos',observaciones:'Borrosas',abono:999}],6);
  assert.equal(summary.parcial,true);assert.equal(summary.videos[4].guion,'Guion a conservar');
  assert.deepEqual(summary.conteos,{videos_grabados:4,videos_pendientes:1,videos_repetir:1,fotos_realizadas:0,fotos_pendientes:0,fotos_repetir:1});
  assert.equal(summary.fotos[0].tipo,'Productos');assert.equal(summary.fotos[0].drive_url,'https://drive.google.com/fotos');
  assert.equal(JSON.stringify(summary).includes('999'),false);assert.equal(JSON.stringify({visit,input}),before);
});
test('results require an accounted plan and pending scripts, but do not require that any media succeeded',()=>{
  for(const [videos,photos,planned] of [[[],[],0],[[video('planificado')],[],1],[[{...video('pendiente'),guion:''}],[],1],[[video('grabado')],[],2]])
    assert.throws(()=>productionResultSummary(visit,videos,photos,planned),{status:400});
  assert.equal(productionResultSummary(visit,[video('pendiente')],[],1).parcial,true);
  assert.equal(productionResultSummary(visit,[],[{id:'p',tipo:'Equipo',estado:'pendiente'}],0).parcial,true);
  assert.equal(productionResultSummary(visit,[video('grabado')],[],1).parcial,false);
});
test('journal DTO retains its stored snapshot, computes freshness from result revision and excludes receipt internals',()=>{
  const row={id,visita_id:id,visita_revision:3,revision_resultante:4,registrado_por_id:7,registrado_at:'2026-10-29',
    resumen:productionResultSummary(visit,[video('pendiente')],[],1),payload_hash:'secret',request_id:id,salary:999};
  const dto=productionResultDto(row,4);assert.equal(dto.vigente,true);assert.equal(productionResultDto(row,5).vigente,false);
  assert.equal(dto.resumen.videos[0].estado,'pendiente');assert.equal(Object.hasOwn(dto,'payload_hash'),false);
  assert.equal(Object.hasOwn(dto,'request_id'),false);assert.equal(Object.hasOwn(dto,'salary'),false);
});
