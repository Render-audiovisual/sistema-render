import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function confirmProductionVisit('),source.indexOf('\nrouter.post("/tareas/:id/produccion/confirmar"'));
function fixture({external=false,failSave=false}={}) {
  const calls=[];
  const original={id:10,revision:3,estado:'en_revision',tipo_tarea:'produccion',propiedades_extra:{workspace:'render_os',produccion_registros:[{cantidad:3}],guiones:'Guion original'}};
  let task=structuredClone(original),before;
  const db={release(){calls.push('release');},async query(sql,args){
    calls.push(sql);
    if(sql==='BEGIN ISOLATION LEVEL READ COMMITTED'){before=structuredClone(task);return{rows:[]};}
    if(sql==='ROLLBACK'){task=before;return{rows:[]};}
    if(sql==='COMMIT')return{rows:[]};
    if(sql.includes('SELECT id,revision'))return{rows:[structuredClone(task)]};
    if(sql.includes('UPDATE tareas SET estado=')){
      if(failSave)throw Error('injected write failure');
      task={...task,revision:task.revision+1,propiedades_extra:JSON.parse(args[1])};return{rows:[structuredClone(task)]};
    }
    throw Error(`Unexpected query ${sql}`);
  }};
  const forbidden=()=>{throw Error('No implicit editing, assignment or notification allowed');};
  const context={pool:{connect:async()=>db},isProductionVisitTask:()=>true,rejectMixedProductionRecording:async()=>{},validateProductionHandoff:()=>null,
    captureLegacyProductionActor:auth=>Object.freeze({...auth}),
    retainLegacyProductionActor:async()=>({id:7,nombre:'Owner',rol:'admin'}),
    retainIntegrationProductionLeader:async()=>({id:7,nombre:'Owner',rol:'admin'}),
    getTaskActor:auth=>auth.nombre,
    annotateTaskAssignments:async(_db,rows)=>rows,crearTareaEdicionDesdeVisita:forbidden,notificarAsignacionSinInterrumpir:forbidden};
  const confirm=new Function(...Object.keys(context),`${fn};return confirmProductionVisit;`)(...Object.values(context));
  return {calls,original,get task(){return task;},run:(revision=3)=>confirm(10,'Owner',{expectedRevision:revision,actorId:7,...(external?{db}:{auth:{id:7,rol:'admin',session_version:1}})})};
}
test('actual confirmation callback records filming without any task creation, inferred editor or delivery date',async()=>{
  for(const external of [false,true]) {
    const f=fixture({external});const result=await f.run();
    assert.equal(result.created,false);assert.equal(result.editing_task,null);
    assert.equal(result.task.revision,4);
    assert.equal(result.task.propiedades_extra.produccion_confirmada_por_id,7);
    assert.deepEqual(result.task.propiedades_extra.produccion_registros,f.original.propiedades_extra.produccion_registros);
    assert.equal(result.task.propiedades_extra.guiones,'Guion original');
    assert.equal(f.calls.some(sql=>/INSERT|tarea_asignaciones|fecha_vencimiento\s*=/.test(sql)),false);
    assert.equal(f.calls.includes('COMMIT'),!external);
    assert.equal(f.calls.includes('release'),!external);
  }
});
test('confirmation stale revision and failed save do not commit; owned transaction rolls back',async()=>{
  const stale=fixture();await assert.rejects(stale.run(2),{status:409});
  assert.deepEqual(stale.task,stale.original);assert.ok(stale.calls.includes('ROLLBACK'));
  const failed=fixture({failSave:true});await assert.rejects(failed.run(),/injected/);
  assert.deepEqual(failed.task,failed.original);assert.ok(failed.calls.includes('ROLLBACK'));
  assert.equal(failed.calls.includes('COMMIT'),false);
});
