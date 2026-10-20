import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionReconciliation } from '../src/production-reconciliation.js';
import { productionHistoryHash, isReconciledProductionVideo } from '../src/production-history.js';
const input=()=>({request_id:'11111111-1111-4111-8111-111111111111',source_task_id:7,expected_source_revision:3,
  acknowledgement:'videos_identificados_manualmente',titulo:'Visita revisada',participante_ids:[2,1],
  videos:[{titulo:'Video identificado',estado:'grabado',guion:'Guion exacto\n'}]});

test('manual inventory is explicit, closed and normalized without quantity splitting or generated editing',()=>{
  const value=validateProductionReconciliation(input());
  assert.deepEqual(value.participante_ids,[1,2]);assert.equal(value.videos.length,1);
  assert.equal(value.videos[0].guion,'Guion exacto\n');assert.equal(value.videos[0].material_url,'');
  for(const patch of [{cantidad:3},{editor_id:7},{rol:'admin'},{request_id:'bad'},{source_task_id:'7'},
    {expected_source_revision:0},{acknowledgement:'automatico'},{participante_ids:null},{observaciones:null},
    {participante_ids:[1,1]},{videos:[]},{videos:Array(51).fill(input().videos[0])}])assert.throws(()=>validateProductionReconciliation({...input(),...patch}));
  for(const patch of [{estado:'publicada'},{titulo:''},{guion:null},{material_url:'javascript:alert(1)'},
    {material_url:'https://user:secret@example.invalid'},{tarea_id:3}]) {
    const value=input();Object.assign(value.videos[0],patch);assert.throws(()=>validateProductionReconciliation(value));
  }
});
test('history fingerprints are canonical and ignore ordinary title/priority/private metadata changes',()=>{
  const a={titulo:'Original',propiedades_extra:{produccion_registros:[{cantidad:2,nota:'A'}],salary:123}};
  const b={titulo:'Changed',prioridad:'alta',propiedades_extra:{salary:456,produccion_registros:[{nota:'A',cantidad:2}]}};
  assert.equal(productionHistoryHash(a),productionHistoryHash(b));
  b.propiedades_extra.produccion_registros[0].cantidad=3;assert.notEqual(productionHistoryHash(a),productionHistoryHash(b));
});
test('provenance requires exact reviewed video/source/visit and no aggregate child; unknown IDs do not grant access',async()=>{
  const source={propiedades_extra:{produccion_registros:[{cantidad:2}]}};
  const visit={id:'visit',tarea_origen_id:7};let child=false,hash=productionHistoryHash(source);const calls=[];
  const db={async query(sql,values){calls.push({sql,values});return{rows:sql.includes("origen_visita_id")?(child?[{id:99}]:[]):hash?[{source_history_hash:hash}]:[]};}};
  assert.equal(await isReconciledProductionVideo(db,visit,source,null),false);assert.equal(calls.length,0);
  assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),true);
  assert.deepEqual(calls.at(-1).values,['video','visit',7]);
  hash='changed';assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false);
  hash=null;assert.equal(await isReconciledProductionVideo(db,visit,source,'other'),false);
  child=true;assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false);
});
