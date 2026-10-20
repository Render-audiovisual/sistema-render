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
test('existing editing requires an explicit one-video acknowledgement and exact observed task revision',()=>{
  const body=input(),existing_editing={task_id:8,expected_revision:2,video_ordinal:1,acknowledgement:'esta_tarea_edita_un_solo_video'};
  assert.deepEqual(validateProductionReconciliation({...body,existing_editing}).existing_editing,existing_editing);
  assert.equal(Object.hasOwn(validateProductionReconciliation(body),'existing_editing'),false,'Existing normal intent hashes keep the same shape');
  for(const patch of [{task_id:7},{task_id:'8'},{expected_revision:0},{video_ordinal:0},{video_ordinal:2},{acknowledgement:'automatico'},{editor_id:3}])
    assert.throws(()=>validateProductionReconciliation({...body,existing_editing:{...existing_editing,...patch}}));
  for(const value of [null,{},[],1])assert.throws(()=>validateProductionReconciliation({...body,existing_editing:value}));
  assert.throws(()=>validateProductionReconciliation({...body,videos:[{...body.videos[0],estado:'pendiente'}],existing_editing}));
});
test('a mapped existing child permits only matching reviewed lineage and an intact original task link',async()=>{
  const source={propiedades_extra:{produccion_registros:[{cantidad:2}]}};
  const visit={id:'visit',tarea_origen_id:7};let childRows=[{id:99}],mapped=true,reviewed=true;
  const db={async query(sql,values){
    if(sql.startsWith('SELECT id FROM tareas'))return{rows:childRows};
    if(sql.includes('FROM produccion_edicion_adopciones')){
      assert.deepEqual(values,['video','visit',7,99]);
      assert.match(sql,/adopted.tarea_edicion_id=a.tarea_edicion_id/);
      return{rows:mapped?[{tarea_edicion_id:99}]:[]};
    }
    return{rows:reviewed?[{source_history_hash:productionHistoryHash(source),adopted_task_id:99}]:[]};
  }};
  assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),true);
  mapped=false;assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false);
  mapped=true;childRows=[{id:99},{id:100}];assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false);
  childRows=[];assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false,'Removing the original child marker cannot convert an adoption into a child-free review');
  childRows=[{id:99}];reviewed=false;assert.equal(await isReconciledProductionVideo(db,visit,source,'video'),false);
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
